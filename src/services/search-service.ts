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
   * Search for code chunks using semantic similarity
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    try {
      // Generate embedding for the query
      const queryVector = await this.voyageClient.generateEmbedding(
        query.query,
        this.config.embeddingModel,
        'query'
      );

      // Search for similar vectors in Qdrant
      const results = await this.qdrantClient.searchSimilar(query, queryVector);

      // Post-process results
      return this.postProcessResults(results, query);
    } catch (error) {
      throw new Error(`Search failed: ${error}`);
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
   * Get search statistics
   */
  async getSearchStats(): Promise<{
    totalChunks: number;
    languageDistribution: Record<string, number>;
    chunkTypeDistribution: Record<string, number>;
  }> {
    const totalChunks = await this.qdrantClient.countPoints();
    
    // Get sample of chunks to calculate distributions
    const sampleQuery: SearchQuery = {
      query: 'sample',
      limit: 1000,
      threshold: 0.0
    };

    const sampleResults = await this.search(sampleQuery);
    
    const languageDistribution: Record<string, number> = {};
    const chunkTypeDistribution: Record<string, number> = {};

    sampleResults.forEach(result => {
      const lang = result.chunk.language;
      const type = result.chunk.chunkType;
      
      languageDistribution[lang] = (languageDistribution[lang] || 0) + 1;
      chunkTypeDistribution[type] = (chunkTypeDistribution[type] || 0) + 1;
    });

    return {
      totalChunks,
      languageDistribution,
      chunkTypeDistribution
    };
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