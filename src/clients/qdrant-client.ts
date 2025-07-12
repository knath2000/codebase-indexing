import { QdrantClient } from '@qdrant/js-client-rest';
import { EmbeddingVector, EmbeddingPayload, SearchQuery, SearchResult, CodeChunk } from '../types.js';

export class QdrantVectorClient {
  private client: QdrantClient;
  private collectionName: string;
  private embeddingDimension: number;

  constructor(url: string, apiKey?: string, collectionName: string = 'codebase', embeddingDimension: number = 1536) {
    const clientConfig = apiKey ? { url, apiKey } : { url };
    this.client = new QdrantClient(clientConfig);
    this.collectionName = collectionName;
    this.embeddingDimension = embeddingDimension;
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
    } catch (error) {
      throw new Error(`Failed to recreate collection: ${error}`);
    }
  }

  /**
   * Store embedding vectors in Qdrant
   */
  async storeEmbeddings(embeddings: EmbeddingVector[]): Promise<void> {
    console.log(`🚀 [Qdrant] Starting to store ${embeddings.length} embeddings`);
    
    try {
      // Test connection first
      console.log(`🔗 [Qdrant] Testing connection before storage...`);
      const isConnected = await this.testConnection();
      if (!isConnected) {
        throw new Error('Qdrant connection test failed');
      }
      console.log(`✅ [Qdrant] Connection test successful`);

      // Log collection info
      console.log(`📊 [Qdrant] Getting collection info...`);
      const collectionInfo = await this.getCollectionInfo();
      console.log(`📊 [Qdrant] Collection info:`, {
        name: collectionInfo.config?.params?.vectors?.size || 'unknown',
        points: collectionInfo.points_count || 0,
        status: collectionInfo.status || 'unknown'
      });

      // Prepare points data
      console.log(`🔄 [Qdrant] Preparing ${embeddings.length} points for upsert...`);
      const points = embeddings.map((embedding, index) => {
        if (index === 0) {
          // Log first embedding structure for debugging
          console.log(`📝 [Qdrant] First embedding structure:`, {
            id: embedding.id,
            vectorLength: embedding.vector?.length || 0,
            payloadKeys: Object.keys(embedding.payload || {}),
            payloadPreview: {
              filePath: embedding.payload?.filePath || 'missing',
              chunkType: embedding.payload?.chunkType || 'missing',
              startLine: embedding.payload?.startLine || 'missing'
            }
          });
        }
        
        return {
          id: embedding.id,
          vector: embedding.vector,
          payload: embedding.payload as Record<string, unknown>
        };
      });

      console.log(`💾 [Qdrant] Calling upsert with wait=false...`);
      const startTime = Date.now();
      
      // Change wait to false to avoid timeouts, and add timeout handling
      const upsertPromise = this.client.upsert(this.collectionName, {
        wait: false,  // Don't wait for indexing to complete
        points
      });

      // Add manual timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Upsert operation timed out after 30 seconds')), 30000);
      });

      await Promise.race([upsertPromise, timeoutPromise]);
      
      const duration = Date.now() - startTime;
      console.log(`✅ [Qdrant] Upsert completed successfully in ${duration}ms`);
      
      // Verify points were stored
      console.log(`🔍 [Qdrant] Verifying storage...`);
      const updatedInfo = await this.getCollectionInfo();
      console.log(`📊 [Qdrant] Updated collection points count: ${updatedInfo.points_count || 0}`);
      
    } catch (error) {
      console.error(`❌ [Qdrant] Storage failed:`, error);
      throw new Error(`Failed to store embeddings: ${error}`);
    }
  }

  /**
   * Store a single embedding vector
   */
  async storeEmbedding(embedding: EmbeddingVector): Promise<void> {
    return this.storeEmbeddings([embedding]);
  }

  /**
   * Search for similar vectors
   */
  async searchSimilar(
    query: SearchQuery,
    queryVector: number[]
  ): Promise<SearchResult[]> {
    try {
      const searchParams: any = {
        vector: queryVector,
        limit: query.limit || 10,
        score_threshold: query.threshold || 0.7
      };

      // Add filters based on query parameters
      const filters: any = {};
      if (query.language) {
        filters.language = { match: { value: query.language } };
      }
      if (query.filePath) {
        filters.filePath = { match: { value: query.filePath } };
      }
      if (query.chunkType) {
        filters.chunkType = { match: { value: query.chunkType } };
      }

      if (Object.keys(filters).length > 0) {
        searchParams.filter = { must: Object.entries(filters).map(([key, value]) => ({ key, match: (value as any).match })) };
      }

      const searchResult = await this.client.search(this.collectionName, searchParams);

      return searchResult.map(result => ({
        id: result.id as string,
        score: result.score,
        chunk: this.payloadToCodeChunk(result.payload as unknown as EmbeddingPayload),
        snippet: this.createSnippet(result.payload as unknown as EmbeddingPayload),
        context: query.includeMetadata ? JSON.stringify(result.payload) : undefined
      }));
    } catch (error) {
      throw new Error(`Search failed: ${error}`);
    }
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
   * Test connection to Qdrant
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch (error) {
      console.error('Qdrant connection test failed:', error);
      return false;
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
} 