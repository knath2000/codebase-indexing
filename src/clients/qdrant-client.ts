import { QdrantClient } from '@qdrant/js-client-rest';
import { EmbeddingVector, EmbeddingPayload, SearchQuery, SearchResult, CodeChunk } from '../types.js';
import { createModuleLogger } from '../logging/logger.js'

export class QdrantVectorClient {
  private client: QdrantClient;
  private url: string;
  private apiKey: string | undefined;
  private collectionName: string;
  private embeddingDimension: number;
  private keywordTimeoutMs: number;
  private keywordMaxChunks: number;
  private requestDurations: number[] = []; // To store last N request durations
  private maxDurationsToStore: number = 100; // Store up to 100 durations
  private readonly log = createModuleLogger('qdrant-client')

  constructor(
    url: string,
    apiKey: string | undefined,
    collectionName: string,
    embeddingDimension: number,
    keywordTimeoutMs: number = 10000,
    keywordMaxChunks: number = 20000
  ) {
    this.url = url;
    this.apiKey = apiKey;
    this.collectionName = collectionName;
    this.embeddingDimension = embeddingDimension;

    const clientOptions: any = this.apiKey ? { url: this.url, apiKey: this.apiKey } : { url: this.url };
    this.client = new QdrantClient(clientOptions);
    this.keywordTimeoutMs = keywordTimeoutMs;
    this.keywordMaxChunks = keywordMaxChunks;
  }

  /**
   * Initialize the collection with proper schema
   */
  async initializeCollection(): Promise<void> {
    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const collectionExists = collections.collections.some(
        col => col.name === this.collectionName
      );

      if (!collectionExists) {
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.embeddingDimension,
            distance: 'Cosine'
          }
        });
        this.log.info({ collection: this.collectionName }, 'Created collection')
        
        // Create payload indexes for filtering capabilities
        await this.createPayloadIndexes();
      } else {
        // Check if existing collection has correct dimensions
        const collectionInfo = await this.client.getCollection(this.collectionName);
        const existingDimensions = collectionInfo.config?.params?.vectors?.size;
        
        if (existingDimensions !== this.embeddingDimension) {
          this.log.warn({ existingDimensions, expected: this.embeddingDimension, collection: this.collectionName }, 'Collection has wrong dimensions; recreating')
          await this.recreateCollection();
        } else {
          this.log.info({ dim: this.embeddingDimension, collection: this.collectionName }, 'Collection exists with correct dimensions')
          // Ensure payload indexes exist (idempotent operation)
          await this.createPayloadIndexes();
        }
      }
    } catch (error) {
      throw new Error(`Failed to initialize collection: ${error}`);
    }
  }

  /**
   * Recreate the collection with correct dimensions (deletes all existing data)
   */
  async recreateCollection(): Promise<void> {
    try {
      this.log.warn({ collection: this.collectionName }, 'Deleting existing collection')
      
      // Delete existing collection
      try {
        await this.client.deleteCollection(this.collectionName);
        this.log.info('Deleted existing collection')
      } catch (deleteError) {
        this.log.warn({ err: String(deleteError) }, 'Collection deletion failed (might not exist)')
      }

      // Wait a moment for deletion to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create new collection with correct dimensions
      this.log.info({ dim: this.embeddingDimension, collection: this.collectionName }, 'Creating new collection')
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.embeddingDimension,
          distance: 'Cosine'
        }
      });
      
      this.log.info({ collection: this.collectionName }, 'Successfully recreated collection')
      
      // Create payload indexes for filtering capabilities
      await this.createPayloadIndexes();
      
    } catch (error) {
      throw new Error(`Failed to recreate collection: ${error}`);
    }
  }

  /**
   * Create payload indexes for filtering capabilities (matching Cursor's @codebase functionality)
   */
  private async createPayloadIndexes(): Promise<void> {
    this.log.info({ collection: this.collectionName }, 'Creating payload indexes for filtering')
    
    try {
      // Index for chunkType filtering (function, class, interface, etc.)
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'chunkType',
        field_schema: 'keyword'
      });
      this.log.info('Created chunkType index')
      
      // Index for language filtering (typescript, javascript, etc.)
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'language',
        field_schema: 'keyword'
      });
      this.log.info('Created language index')
      
      // Index for filePath filtering
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'filePath',
        field_schema: 'keyword'
      });
      this.log.info('Created filePath index')
      
      // Index for fileKind filtering (code vs docs)
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'fileKind',
        field_schema: 'keyword'
      });
      this.log.info('Created fileKind index')
      
      this.log.info('All payload indexes created successfully')
      
    } catch (error) {
      // Check if indexes already exist (this is not an error)
      const errorMsg = String(error).toLowerCase();
      if (errorMsg.includes('already exists') || errorMsg.includes('conflict')) {
        this.log.info('Payload indexes already exist, skipping creation')
      } else {
        this.log.error({ err: error }, 'Failed to create payload indexes')
        throw new Error(`Failed to create payload indexes: ${error}`);
      }
    }
  }

  /**
   * Create payload indexes on existing collection (useful for upgrading existing collections)
   */
  async ensurePayloadIndexes(): Promise<void> {
    console.log(`🔧 [Qdrant] Ensuring payload indexes exist for collection: ${this.collectionName}`);
    await this.createPayloadIndexes();
  }

  /**
   * Store embedding vectors in Qdrant
   */
  async storeEmbeddings(embeddings: EmbeddingVector[]): Promise<void> {
    this.log.info({ count: embeddings.length }, 'Storing embeddings')

    // Early-exit
    if (embeddings.length === 0) {
      this.log.info('No embeddings to store – skipping')
      return;
    }

    // Verify connection once
    this.log.debug('Verifying connection')
    if (!(await this.testConnection())) {
      throw new Error('Qdrant connection test failed');
    }

    const batchSize = 256; // Safer batch size to avoid large payloads/timeouts

    // Helper to transform EmbeddingVector → Qdrant point format
    const toPoint = (emb: EmbeddingVector) => ({
      id: emb.id,
      vector: emb.vector,
      payload: emb.payload as Record<string, unknown>
    });

    try {
      let stored = 0;
      for (let i = 0; i < embeddings.length; i += batchSize) {
        const batch = embeddings.slice(i, i + batchSize).map(toPoint);

        // Defensive: ensure vectors present & correct dimension
        for (const p of batch) {
          if (!p.vector || p.vector.length !== this.embeddingDimension) {
            throw new Error(`Vector dimension mismatch for id=${p.id}`);
          }
        }

        const start = Date.now();
        await this.client.upsert(this.collectionName, {
          wait: false,
          points: batch
        });
        const dur = Date.now() - start;
        stored += batch.length;
        this.log.debug({ batch: batch.length, stored, total: embeddings.length, ms: dur }, 'Upserted batch')
      }

      // Final verification (may lag slightly because wait=false)
      const finalInfo = await this.getCollectionInfo();
      this.log.info({ points: finalInfo.points_count || 0 }, 'Collection points updated')

    } catch (err) {
      this.log.error({ err }, 'storeEmbeddings failed')
      throw err;
    }
  }

  /**
   * Store a single embedding vector
   */
  async storeEmbedding(embedding: EmbeddingVector): Promise<void> {
    return this.storeEmbeddings([embedding]);
  }

  /**
   * Search for similar vectors with enhanced error handling and logging
   */
  async searchSimilar(
    query: SearchQuery,
    queryVector: number[]
  ): Promise<SearchResult[]> {
    this.log.debug({ q: query.query, limit: query.limit || 50, threshold: query.threshold ?? 0.25, lang: query.language, filePath: query.filePath, chunkType: query.chunkType, vecLen: queryVector.length }, 'Starting dense search')

    try {
      // Validate input parameters
      if (!queryVector || queryVector.length === 0) {
        throw new Error('Query vector is empty or invalid');
      }
      
      if (queryVector.length !== this.embeddingDimension) {
        throw new Error(`Query vector dimension mismatch: expected ${this.embeddingDimension}, got ${queryVector.length}`);
      }

      const searchParams: any = {
        vector: queryVector,
        limit: query.limit || 50, // Increased from 10 to 50 for better coverage
        score_threshold: query.threshold ?? 0.25,
        with_payload: true,
        with_vector: false
      };

      // Build filters based on query parameters
      const filter = this.buildFilterFromQuery(query)
      if (filter) searchParams.filter = filter

      this.log.debug({ collection: this.collectionName }, 'Executing dense search')
      const searchResult = await this.client.search(this.collectionName, searchParams);
      
      this.log.debug({ results: searchResult.length }, 'Dense search complete')

      const results = searchResult.map(r => {
        const chunk = this.payloadToCodeChunk(r.payload as unknown as EmbeddingPayload)
        chunk.id = r.id as string
        return {
          id: r.id as string,
          score: r.score,
          chunk,
          snippet: this.createSnippet(r.payload as unknown as EmbeddingPayload),
          context: this.createContextDescription(r.payload as unknown as EmbeddingPayload)
        }
      })

      this.log.debug({ results: results.length }, 'Returning dense results')
      return results;

    } catch (error) {
      this.log.error({ err: error }, 'Dense search failed')
      if (error instanceof Error) {
        // Enhance error message with more context
        throw new Error(`Qdrant search failed: ${error.message} (Collection: ${this.collectionName}, Query: "${query.query}")`);
      }
      throw new Error(`Qdrant search failed: ${String(error)}`);
    }
  }

  /**
   * Perform a simple keyword-based search across all indexed chunks.
   * This provides a lightweight BM25-style sparse retrieval fallback that can be
   * blended with dense semantic search results for higher accuracy – similar to
   * Cursor's hybrid search pipeline.
   *
   * NOTE: This implementation scrolls the entire collection once and performs
   * in-memory scoring. For typical source-code repositories (a few thousand
   * chunks) this is fast enough and keeps the implementation dependency-free.
   * If the collection grows large, consider replacing this with Qdrant's
   * full-text payload index once it becomes generally available.
   */
  async keywordSearch(query: SearchQuery): Promise<SearchResult[]> {
    const searchText = query.query.toLowerCase();
    if (!searchText.trim()) {
      return [];
    }

    const startTime = Date.now();
    let scanned = 0;

    // Collect all chunks (streaming in pages of 1000) – this is OK for <50k chunks
    const pageLimit = 1000;
    let offset: string | undefined = undefined;
    const allPoints: { id: string | number; payload: EmbeddingPayload }[] = [];

    try {
      do {
        const page = await this.client.scroll(this.collectionName, {
          with_payload: true,
          with_vector: false,
          limit: pageLimit,
          offset: offset ?? null
        });

        page.points.forEach(point => {
          allPoints.push({ id: point.id as string | number, payload: point.payload as unknown as EmbeddingPayload });
        });
        scanned += page.points.length;
        if (Date.now() - startTime > this.keywordTimeoutMs) {
          this.log.warn({ timeoutMs: this.keywordTimeoutMs, scanned }, 'keywordSearch timeout; stopping scroll')
          break;
        }
        if (scanned >= this.keywordMaxChunks) {
          this.log.warn({ limit: this.keywordMaxChunks }, 'keywordSearch reached max chunk limit; stopping scroll')
          break;
        }
        offset = page.next_page_offset as string | undefined;
      } while (offset !== undefined);
    } catch (error) {
      this.log.error({ err: error }, 'keywordSearch scroll failed')
      return [];
    }

    // Score and sort results by relevance
    const scoredResults = allPoints
      .map(point => {
        const chunk = this.payloadToCodeChunk(point.payload);
        chunk.id = String(point.id);
        return {
          point,
          chunk,
          score: this.calculateKeywordScore(searchText, point.payload.content)
        };
      })
      .filter(result => {
        // Apply score threshold
        if (result.score <= (query.threshold ?? 0.25)) {
          return false;
        }
        
        // Apply preferImplementation filter
        if (query.preferImplementation === true && result.point.payload.fileKind !== 'code') {
          return false;
        }
        
        // Apply other query filters
        if (query.language && result.point.payload.language !== query.language) {
          return false;
        }
        
        if (query.chunkType && result.point.payload.chunkType !== query.chunkType) {
          return false;
        }
        
        if (query.filePath && result.point.payload.filePath !== query.filePath) {
          return false;
        }
        
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit || 50); // Use consistent limit

    const results: SearchResult[] = scoredResults.map(result => ({
      id: String(result.point.id),
      score: result.score,
      chunk: result.chunk,
      snippet: this.createSnippet(result.point.payload),
      context: this.createContextDescription(result.point.payload)
    }));

    return results;
  }

  /**
   * Delete embeddings by file path
   */
  async deleteByFilePath(filePath: string): Promise<void> {
    try {
      await this.client.delete(this.collectionName, {
        filter: {
          must: [{ key: 'filePath', match: { value: filePath } }]
        }
      });
    } catch (error) {
      throw new Error(`Failed to delete embeddings for file ${filePath}: ${error}`);
    }
  }

  /**
   * Delete embeddings by IDs
   */
  async deleteByIds(ids: string[]): Promise<void> {
    try {
      await this.client.delete(this.collectionName, {
        points: ids
      });
    } catch (error) {
      throw new Error(`Failed to delete embeddings by IDs: ${error}`);
    }
  }

  /**
   * Get collection info and stats
   */
  async getCollectionInfo(): Promise<any> {
    try {
      return await this.client.getCollection(this.collectionName);
    } catch (error) {
      throw new Error(`Failed to get collection info: ${error}`);
    }
  }

  /**
   * Count total points in collection
   */
  async countPoints(): Promise<number> {
    try {
      const info = await this.getCollectionInfo();
      return info.points_count || 0;
    } catch (error) {
      throw new Error(`Failed to count points: ${error}`);
    }
  }

  /**
   * Clear all data from collection
   */
  async clearCollection(): Promise<void> {
    try {
      await this.client.delete(this.collectionName, {
        filter: { must: [] }
      });
    } catch (error) {
      throw new Error(`Failed to clear collection: ${error}`);
    }
  }

  /**
   * Get points by their IDs
   */
  async getPointsById(ids: string[]): Promise<any[]> {
    try {
      const response = await this.client.retrieve(this.collectionName, {
        ids: ids,
        with_payload: true,
        with_vector: true,
      });
      return response;
    } catch (error) {
      this.log.error({ err: error }, 'Failed to retrieve points by ID')
      throw new Error(`Qdrant getPointsById failed: ${String(error)}`);
    }
  }

  /**
   * Get average request latency for Qdrant client
   */
  public getAverageLatency(): number {
    if (this.requestDurations.length === 0) {
      return 0;
    }
    const sum = this.requestDurations.reduce((a, b) => a + b, 0);
    return sum / this.requestDurations.length;
  }

  /**
   * Test connection to Qdrant
   */
  async testConnection(): Promise<boolean> {
    try {
      const startTime = Date.now();
      await this.client.getCollections();
      const duration = Date.now() - startTime;
      this.addRequestDuration(duration);
      return true;
    } catch (error) {
      this.log.error({ err: error }, 'Qdrant connection test failed')
      return false;
    }
  }

  private addRequestDuration(duration: number): void {
    this.requestDurations.push(duration);
    if (this.requestDurations.length > this.maxDurationsToStore) {
      this.requestDurations.shift(); // Remove the oldest duration
    }
  }

  /**
   * Get embeddings by file path
   */
  async getEmbeddingsByFilePath(filePath: string): Promise<EmbeddingVector[]> {
    try {
      const searchResult = await this.client.scroll(this.collectionName, {
        filter: {
          must: [{ key: 'filePath', match: { value: filePath } }]
        },
        limit: 1000,
        with_payload: true,
        with_vector: true
      });

      return searchResult.points.map(point => ({
        id: point.id as string,
        vector: point.vector as number[],
        payload: point.payload as unknown as EmbeddingPayload
      }));
    } catch (error) {
      throw new Error(`Failed to get embeddings for file ${filePath}: ${error}`);
    }
  }

  /**
   * Check if file is already indexed
   */
  async isFileIndexed(filePath: string, lastModified: number): Promise<boolean> {
    try {
      const searchResult = await this.client.scroll(this.collectionName, {
        filter: {
          must: [
            { key: 'filePath', match: { value: filePath } },
            { key: 'metadata.lastModified', match: { value: lastModified } }
          ]
        },
        limit: 1
      });

      return searchResult.points.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Convert payload to CodeChunk
   */
  private payloadToCodeChunk(payload: EmbeddingPayload): CodeChunk {
    return {
      id: '', // Will be set by the calling function
      content: payload.content,
      filePath: payload.filePath,
      language: payload.language,
      startLine: payload.startLine,
      endLine: payload.endLine,
      chunkType: payload.chunkType,
      functionName: payload.functionName,
      className: payload.className,
      moduleName: payload.moduleName,
      contentHash: payload.contentHash,
      metadata: payload.metadata
    };
  }

  /**
   * Create a snippet from the payload
   */
  private createSnippet(payload: EmbeddingPayload): string {
    const lines = payload.content.split('\n');
    const maxLines = 5;
    
    if (lines.length <= maxLines) {
      return payload.content;
    }
    
    const snippet = lines.slice(0, maxLines).join('\n');
    return snippet + '\n...';
  }

  /**
   * Create a context description for search results (similar to Cursor's @codebase format)
   */
  private createContextDescription(payload: EmbeddingPayload): string {
    const parts: string[] = [];
    
    // Add file path (relative format)
    const filePath = payload.filePath.startsWith('/app/') 
      ? payload.filePath.substring(5) 
      : payload.filePath;
    parts.push(`📁 ${filePath}`);
    
    // Add line range
    if (payload.startLine && payload.endLine) {
      parts.push(`📍 Lines ${payload.startLine}-${payload.endLine}`);
    }
    
    // Add function/class name if available
    if (payload.functionName) {
      parts.push(`🔧 Function: ${payload.functionName}`);
    } else if (payload.className) {
      parts.push(`📦 Class: ${payload.className}`);
    } else if (payload.moduleName) {
      parts.push(`📂 Module: ${payload.moduleName}`);
    }
    
    // Add chunk type
    parts.push(`🏷️  Type: ${payload.chunkType}`);
    
    // Add language
    parts.push(`💻 ${payload.language}`);
    
    return parts.join(' | ');
  }

  /**
   * Calculate keyword score for keyword search.
   * This is a very basic TF-IDF-like scoring.
   * For a real-world application, you'd need a proper tokenizer, stopwords,
   * and a more sophisticated scoring mechanism.
   */
  private calculateKeywordScore(query: string, content: string): number {
    const tokens = query.split(/\s+/).filter(Boolean);
    let score = 0;

    for (const token of tokens) {
      const occurrences = content.split(token).length - 1;
      score += occurrences;
    }
    return score;
  }

  private buildFilterFromQuery(query: SearchQuery): any | undefined {
    const must: any[] = []
    if (query.language) must.push({ key: 'language', match: { value: query.language } })
    if (query.filePath) must.push({ key: 'filePath', match: { value: query.filePath } })
    if (query.chunkType) must.push({ key: 'chunkType', match: { value: query.chunkType } })
    if (query.preferImplementation === true) must.push({ key: 'fileKind', match: { value: 'code' } })
    return must.length > 0 ? { must } : undefined
  }
} 