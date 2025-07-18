import { QdrantClient } from '@qdrant/js-client-rest';
import { EmbeddingVector, EmbeddingPayload, SearchQuery, SearchResult, CodeChunk } from '../types.js';

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
        console.log(`Created collection: ${this.collectionName}`);
        
        // Create payload indexes for filtering capabilities
        await this.createPayloadIndexes();
      } else {
        // Check if existing collection has correct dimensions
        const collectionInfo = await this.client.getCollection(this.collectionName);
        const existingDimensions = collectionInfo.config?.params?.vectors?.size;
        
        if (existingDimensions !== this.embeddingDimension) {
          console.log(`⚠️  Collection exists but has wrong dimensions: ${existingDimensions}, expected: ${this.embeddingDimension}`);
          console.log(`🔄 Recreating collection with correct dimensions...`);
          await this.recreateCollection();
        } else {
          console.log(`✅ Collection exists with correct dimensions: ${this.embeddingDimension}`);
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
      console.log(`🗑️  Deleting existing collection: ${this.collectionName}`);
      
      // Delete existing collection
      try {
        await this.client.deleteCollection(this.collectionName);
        console.log(`✅ Deleted existing collection`);
      } catch (deleteError) {
        console.log(`⚠️  Collection deletion failed (might not exist): ${deleteError}`);
      }

      // Wait a moment for deletion to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create new collection with correct dimensions
      console.log(`🎯 Creating new collection with ${this.embeddingDimension} dimensions`);
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.embeddingDimension,
          distance: 'Cosine'
        }
      });
      
      console.log(`✅ Successfully recreated collection: ${this.collectionName}`);
      
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
    console.log(`🔧 [Qdrant] Creating payload indexes for enhanced filtering...`);
    
    try {
      // Index for chunkType filtering (function, class, interface, etc.)
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'chunkType',
        field_schema: 'keyword'
      });
      console.log(`✅ [Qdrant] Created chunkType index for filtering by code elements`);
      
      // Index for language filtering (typescript, javascript, etc.)
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'language',
        field_schema: 'keyword'
      });
      console.log(`✅ [Qdrant] Created language index for filtering by programming language`);
      
      // Index for filePath filtering
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'filePath',
        field_schema: 'keyword'
      });
      console.log(`✅ [Qdrant] Created filePath index for file-specific searches`);
      
      // Index for fileKind filtering (code vs docs)
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'fileKind',
        field_schema: 'keyword'
      });
      console.log(`✅ [Qdrant] Created fileKind index for distinguishing code vs documentation`);
      
      console.log(`🎉 [Qdrant] All payload indexes created successfully - collection ready for @codebase-style filtered searches!`);
      
    } catch (error) {
      // Check if indexes already exist (this is not an error)
      const errorMsg = String(error).toLowerCase();
      if (errorMsg.includes('already exists') || errorMsg.includes('conflict')) {
        console.log(`ℹ️  [Qdrant] Payload indexes already exist, skipping creation`);
      } else {
        console.error(`❌ [Qdrant] Failed to create payload indexes:`, error);
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
    console.log(`🚀 [Qdrant] Starting to store ${embeddings.length} embeddings`);

    // Early-exit
    if (embeddings.length === 0) {
      console.log('ℹ️  [Qdrant] No embeddings to store – skipping');
      return;
    }

    // Verify connection once
    console.log('🔗 [Qdrant] Verifying connection...');
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
        console.log(`✅ [Qdrant] Upserted batch (${batch.length}) – total stored so far: ${stored}/${embeddings.length} in ${dur}ms`);
      }

      // Final verification (may lag slightly because wait=false)
      const finalInfo = await this.getCollectionInfo();
      console.log(`📊 [Qdrant] Collection now reports ${finalInfo.points_count || 0} points`);

    } catch (err) {
      console.error('❌ [Qdrant] storeEmbeddings failed:', err);
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
    console.log(`🔍 [Qdrant] Starting search with query: "${query.query}"`);
    console.log(`🔍 [Qdrant] Search parameters:`, {
      limit: query.limit || 50, // Increased from 10 to 50 for better coverage
      threshold: query.threshold ?? 0.25,
      language: query.language,
      filePath: query.filePath,
      chunkType: query.chunkType,
      vectorLength: queryVector.length
    });

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
      const filterConditions: any[] = [];
      
      if (query.language) {
        filterConditions.push({ key: 'language', match: { value: query.language } });
        console.log(`🔍 [Qdrant] Adding language filter: ${query.language}`);
      }
      
      if (query.filePath) {
        filterConditions.push({ key: 'filePath', match: { value: query.filePath } });
        console.log(`🔍 [Qdrant] Adding file path filter: ${query.filePath}`);
      }
      
      if (query.chunkType) {
        filterConditions.push({ key: 'chunkType', match: { value: query.chunkType } });
        console.log(`🔍 [Qdrant] Adding chunk type filter: ${query.chunkType}`);
      }

      // Add fileKind filter when preferImplementation is true
      if (query.preferImplementation === true) {
        filterConditions.push({ key: 'fileKind', match: { value: 'code' } });
        console.log(`🔍 [Qdrant] Adding fileKind filter: code (prefer implementation)`);
      }

      if (filterConditions.length > 0) {
        searchParams.filter = { must: filterConditions };
        console.log(`🔍 [Qdrant] Applied ${filterConditions.length} filter(s)`);
      }

      console.log(`🔍 [Qdrant] Executing search in collection: ${this.collectionName}`);
      const searchResult = await this.client.search(this.collectionName, searchParams);
      
      console.log(`✅ [Qdrant] Search completed successfully, found ${searchResult.length} results`);

      const results = searchResult.map(result => {
        const chunk = this.payloadToCodeChunk(result.payload as unknown as EmbeddingPayload);
        chunk.id = result.id as string; // Set the ID from the search result
        
        return {
          id: result.id as string,
          score: result.score,
          chunk,
          snippet: this.createSnippet(result.payload as unknown as EmbeddingPayload),
          context: this.createContextDescription(result.payload as unknown as EmbeddingPayload)
        };
      });

      console.log(`🔍 [Qdrant] Returning ${results.length} processed results`);
      return results;

    } catch (error) {
      console.error(`❌ [Qdrant] Search failed:`, error);
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
          console.warn(`[Qdrant] keywordSearch timeout after ${this.keywordTimeoutMs} ms, stopping scroll early (scanned ${scanned} points)`);
          break;
        }
        if (scanned >= this.keywordMaxChunks) {
          console.warn(`[Qdrant] keywordSearch reached max chunk limit (${this.keywordMaxChunks}), stopping scroll`);
          break;
        }
        offset = page.next_page_offset as string | undefined;
      } while (offset !== undefined);
    } catch (error) {
      console.error('[Qdrant] keywordSearch scroll failed:', error);
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
      console.error(`❌ [Qdrant] Failed to retrieve points by ID:`, error);
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
      console.error('Qdrant connection test failed:', error);
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
} 