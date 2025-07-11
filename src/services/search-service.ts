import { VoyageClient } from '../clients/voyage-client.js';
import { QdrantVectorClient } from '../clients/qdrant-client.js';
import {
  Config,
  SearchQuery,
  SearchResult,
  ChunkType,
  CodeChunk
} from '../types.js';

export class SearchService {
  private voyageClient: VoyageClient;
  private qdrantClient: QdrantVectorClient;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.voyageClient = new VoyageClient(config.voyageApiKey);
    this.qdrantClient = new QdrantVectorClient(
      config.qdrantUrl,
      config.qdrantApiKey,
      config.collectionName,
      this.voyageClient.getEmbeddingDimension(config.embeddingModel)
    );
  }

  /**
   * Initialize the search service
   */
  async initialize(): Promise<void> {
    try {
      // Test connections
      const voyageTest = await this.voyageClient.testConnection();
      if (!voyageTest) {
        throw new Error('Failed to connect to Voyage AI');
      }

      const qdrantTest = await this.qdrantClient.testConnection();
      if (!qdrantTest) {
        throw new Error('Failed to connect to Qdrant');
      }

      console.log('Search service initialized successfully');
    } catch (error) {
      throw new Error(`Failed to initialize search service: ${error}`);
    }
  }

  /**
   * Search for code chunks using semantic similarity (enhanced for Cursor-like @codebase functionality)
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    console.log(`🔍 [SearchService] Starting search for: "${query.query}"`);
    console.log(`🔍 [SearchService] Search options:`, {
      language: query.language,
      chunkType: query.chunkType,
      filePath: query.filePath,
      limit: query.limit || 10,
      threshold: query.threshold || 0.7
    });

    try {
      // Validate query
      if (!query.query || query.query.trim().length === 0) {
        throw new Error('Search query cannot be empty');
      }

      // Generate embedding for the query using Voyage AI's code-optimized model
      console.log(`🌐 [SearchService] Generating embedding with ${this.config.embeddingModel}`);
      const queryVector = await this.voyageClient.generateEmbedding(
        query.query,
        this.config.embeddingModel,
        'query' // Use 'query' input type for search queries
      );

      console.log(`✅ [SearchService] Generated embedding vector of length ${queryVector.length}`);

      // Search for similar vectors in Qdrant
      const results = await this.qdrantClient.searchSimilar(query, queryVector);

      console.log(`🔍 [SearchService] Found ${results.length} raw results`);

      // Post-process and enhance results
      const processedResults = this.postProcessResults(results, query);
      
      console.log(`✅ [SearchService] Returning ${processedResults.length} processed results`);
      return processedResults;

    } catch (error) {
      console.error(`❌ [SearchService] Search failed:`, error);
      if (error instanceof Error) {
        throw new Error(`SearchService failed: ${error.message}`);
      }
      throw new Error(`SearchService failed: ${String(error)}`);
    }
  }

  /**
   * Search for functions by name or description
   */
  async searchFunctions(query: string, language?: string, limit: number = 10): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      query,
      chunkType: ChunkType.FUNCTION,
      language,
      limit,
      threshold: 0.7
    };

    return this.search(searchQuery);
  }

  /**
   * Search for classes by name or description
   */
  async searchClasses(query: string, language?: string, limit: number = 10): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      query,
      chunkType: ChunkType.CLASS,
      language,
      limit,
      threshold: 0.7
    };

    return this.search(searchQuery);
  }

  /**
   * Search for interfaces by name or description
   */
  async searchInterfaces(query: string, language?: string, limit: number = 10): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      query,
      chunkType: ChunkType.INTERFACE,
      language,
      limit,
      threshold: 0.7
    };

    return this.search(searchQuery);
  }

  /**
   * Search within a specific file
   */
  async searchInFile(query: string, filePath: string, limit: number = 10): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      query,
      filePath,
      limit,
      threshold: 0.6
    };

    return this.search(searchQuery);
  }

  /**
   * Search by language
   */
  async searchByLanguage(query: string, language: string, limit: number = 10): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      query,
      language,
      limit,
      threshold: 0.7
    };

    return this.search(searchQuery);
  }

  /**
   * Find similar code chunks to a given chunk
   */
  async findSimilar(chunkId: string, limit: number = 5): Promise<SearchResult[]> {
    try {
      // Get the chunk content first
      const chunk = await this.getChunkById(chunkId);
      if (!chunk) {
        throw new Error(`Chunk not found: ${chunkId}`);
      }

      // Use the chunk content as query
      const searchQuery: SearchQuery = {
        query: chunk.content,
        limit: limit + 1, // +1 to exclude the original chunk
        threshold: 0.5
      };

      const results = await this.search(searchQuery);
      
      // Filter out the original chunk
      return results.filter(result => result.id !== chunkId);
    } catch (error) {
      throw new Error(`Failed to find similar chunks: ${error}`);
    }
  }

  /**
   * Get suggestions for code completion or exploration
   */
  async getSuggestions(context: string, type: 'function' | 'class' | 'variable' | 'any' = 'any'): Promise<SearchResult[]> {
    const chunkType = type === 'function' ? ChunkType.FUNCTION :
                     type === 'class' ? ChunkType.CLASS :
                     type === 'variable' ? ChunkType.VARIABLE :
                     undefined;

    const searchQuery: SearchQuery = {
      query: context,
      chunkType,
      limit: 5,
      threshold: 0.6
    };

    return this.search(searchQuery);
  }

  /**
   * Search for code patterns or implementation examples
   */
  async searchPatterns(pattern: string, language?: string, limit: number = 10): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      query: `implementation pattern example ${pattern}`,
      language,
      limit,
      threshold: 0.6
    };

    return this.search(searchQuery);
  }

  /**
   * Advanced search with multiple criteria
   */
  async advancedSearch(
    query: string,
    options: {
      language?: string;
      chunkType?: ChunkType;
      filePath?: string;
      minScore?: number;
      maxResults?: number;
      includeMetadata?: boolean;
      filterByTestFiles?: boolean;
    } = {}
  ): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      query,
      language: options.language,
      chunkType: options.chunkType,
      filePath: options.filePath,
      limit: options.maxResults || 10,
      threshold: options.minScore || 0.7,
      includeMetadata: options.includeMetadata || false
    };

    const results = await this.search(searchQuery);

    // Filter by test files if specified
    if (options.filterByTestFiles !== undefined) {
      return results.filter(result => 
        result.chunk.metadata.isTest === options.filterByTestFiles
      );
    }

    return results;
  }

  /**
   * Get code chunk by ID
   */
  async getChunkById(chunkId: string): Promise<CodeChunk | null> {
    try {
      // This is a simplified implementation
      // In a real system, you might want to store chunk metadata separately
      const searchQuery: SearchQuery = {
        query: chunkId,
        limit: 1,
        threshold: 0.0
      };

      const results = await this.search(searchQuery);
      return results.length > 0 ? results[0].chunk : null;
    } catch (error) {
      console.error(`Error getting chunk ${chunkId}:`, error);
      return null;
    }
  }

  /**
   * Get code context around a chunk
   */
  async getCodeContext(chunkId: string, contextLines: number = 5): Promise<{
    chunk: CodeChunk;
    context: string;
  } | null> {
    try {
      const chunk = await this.getChunkById(chunkId);
      if (!chunk) {
        return null;
      }

      // Search for chunks in the same file near the target chunk
      const contextQuery: SearchQuery = {
        query: chunk.content,
        filePath: chunk.filePath,
        limit: 10,
        threshold: 0.3
      };

      const contextChunks = await this.search(contextQuery);
      
      // Sort by line number
      const sortedChunks = contextChunks
        .map(result => result.chunk)
        .sort((a, b) => a.startLine - b.startLine);

      // Find chunks that are close to the target chunk
      const nearbyChunks = sortedChunks.filter(c => 
        Math.abs(c.startLine - chunk.startLine) <= contextLines * 10
      );

      // Combine context
      const context = nearbyChunks
        .map(c => `// Lines ${c.startLine}-${c.endLine}\n${c.content}`)
        .join('\n\n');

      return {
        chunk,
        context
      };
    } catch (error) {
      console.error(`Error getting context for chunk ${chunkId}:`, error);
      return null;
    }
  }

  /**
   * Get embeddings for a text (utility function)
   */
  async getEmbedding(text: string): Promise<number[]> {
    return this.voyageClient.generateEmbedding(text, this.config.embeddingModel, 'document');
  }

  /**
   * Get comprehensive search statistics (enhanced for Cursor-like codebase insights)
   */
  async getSearchStats(): Promise<{
    totalChunks: number;
    languageDistribution: Record<string, number>;
    chunkTypeDistribution: Record<string, number>;
    embeddingModel: string;
    embeddingDimension: number;
    collectionStatus: string;
  }> {
    console.log(`📊 [SearchService] Gathering comprehensive search statistics...`);
    
    try {
      // Get total chunks count
      const totalChunks = await this.qdrantClient.countPoints();
      console.log(`📊 [SearchService] Total chunks indexed: ${totalChunks}`);

      // Get collection info for status
      const collectionInfo = await this.qdrantClient.getCollectionInfo();
      const collectionStatus = collectionInfo.status || 'unknown';
      
      // Return immediate stats if no chunks exist
      if (totalChunks === 0) {
        return {
          totalChunks: 0,
          languageDistribution: {},
          chunkTypeDistribution: {},
          embeddingModel: this.config.embeddingModel,
          embeddingDimension: this.voyageClient.getEmbeddingDimension(this.config.embeddingModel),
          collectionStatus
        };
      }

      // Get sample of chunks to calculate distributions (use scroll instead of search for better sampling)
      console.log(`📊 [SearchService] Sampling chunks for distribution analysis...`);
      
      const languageDistribution: Record<string, number> = {};
      const chunkTypeDistribution: Record<string, number> = {};
      
      try {
        // Use a broader sample query to get diverse results
        const sampleQuery: SearchQuery = {
          query: 'function class module',
          limit: Math.min(500, totalChunks), // Sample up to 500 chunks or total chunks
          threshold: 0.0 // Very low threshold to get diverse results
        };

        const sampleResults = await this.search(sampleQuery);
        console.log(`📊 [SearchService] Analyzed ${sampleResults.length} chunks for distributions`);

        sampleResults.forEach(result => {
          const lang = result.chunk.language || 'unknown';
          const type = result.chunk.chunkType || 'unknown';
          
          languageDistribution[lang] = (languageDistribution[lang] || 0) + 1;
          chunkTypeDistribution[type] = (chunkTypeDistribution[type] || 0) + 1;
        });
        
      } catch (sampleError) {
        console.warn(`⚠️ [SearchService] Could not gather distribution data:`, sampleError);
        // Continue with empty distributions if sampling fails
      }

      const stats = {
        totalChunks,
        languageDistribution,
        chunkTypeDistribution,
        embeddingModel: this.config.embeddingModel,
        embeddingDimension: this.voyageClient.getEmbeddingDimension(this.config.embeddingModel),
        collectionStatus
      };

      console.log(`✅ [SearchService] Statistics gathered successfully:`, {
        totalChunks: stats.totalChunks,
        languages: Object.keys(stats.languageDistribution).length,
        chunkTypes: Object.keys(stats.chunkTypeDistribution).length,
        model: stats.embeddingModel,
        dimensions: stats.embeddingDimension,
        status: stats.collectionStatus
      });

      return stats;
      
    } catch (error) {
      console.error(`❌ [SearchService] Failed to gather search statistics:`, error);
      throw new Error(`Failed to get search statistics: ${error}`);
    }
  }

  /**
   * Post-process search results
   */
  private postProcessResults(results: SearchResult[], query: SearchQuery): SearchResult[] {
    // Sort by score (descending)
    const sortedResults = results.sort((a, b) => b.score - a.score);

    // Add enhanced snippets
    const enhancedResults = sortedResults.map(result => ({
      ...result,
      snippet: this.enhanceSnippet(result.chunk.content, query.query),
      context: result.context || this.generateContext(result.chunk)
    }));

    return enhancedResults;
  }

  /**
   * Enhance snippet with query highlighting
   */
  private enhanceSnippet(content: string, query: string): string {
    const lines = content.split('\n');
    const maxLines = 8;
    
    if (lines.length <= maxLines) {
      return content;
    }

    // Find lines that might be most relevant to the query
    const queryTerms = query.toLowerCase().split(/\s+/);
    const scoredLines = lines.map((line, index) => {
      const lineContent = line.toLowerCase();
      let score = 0;
      
      queryTerms.forEach(term => {
        if (lineContent.includes(term)) {
          score += 1;
        }
      });
      
      return { line, index, score };
    });

    // Sort by score and take top lines
    const topLines = scoredLines
      .sort((a, b) => b.score - a.score)
      .slice(0, maxLines)
      .sort((a, b) => a.index - b.index)
      .map(item => item.line);

    return topLines.join('\n');
  }

  /**
   * Generate context description for a chunk
   */
  private generateContext(chunk: CodeChunk): string {
    const parts: string[] = [];
    
    parts.push(`File: ${chunk.filePath}`);
    parts.push(`Lines: ${chunk.startLine}-${chunk.endLine}`);
    parts.push(`Language: ${chunk.language}`);
    parts.push(`Type: ${chunk.chunkType}`);
    
    if (chunk.functionName) {
      parts.push(`Function: ${chunk.functionName}`);
    }
    
    if (chunk.className) {
      parts.push(`Class: ${chunk.className}`);
    }
    
    if (chunk.moduleName) {
      parts.push(`Module: ${chunk.moduleName}`);
    }
    
    return parts.join(' | ');
  }
} 