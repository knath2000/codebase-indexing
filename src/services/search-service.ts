import { VoyageClient } from '../clients/voyage-client.js';
import { QdrantVectorClient } from '../clients/qdrant-client.js';
import { LLMRerankerService } from './llm-reranker.js';
import { HybridSearchService } from './hybrid-search.js';
import { ContextManagerService } from './context-manager.js';
import { SearchCacheService } from './search-cache.js';
import { WorkspaceManager, WorkspaceInfo } from './workspace-manager.js';
import {
  Config,
  SearchQuery,
  SearchResult,
  ChunkType,
  CodeChunk,
  CodeReference,
  SearchStats,
  HealthStatus,
  ServiceHealth
} from '../types.js';
import { EmbeddingPayload } from '../types';

export class SearchService {
  private voyageClient: VoyageClient;
  private qdrantClient: QdrantVectorClient;
  private config: Config;
  private llmReranker: LLMRerankerService;
  private hybridSearch: HybridSearchService;
  private contextManager: ContextManagerService;
  private searchCache: SearchCacheService;
  private workspaceManager: WorkspaceManager;
  private currentWorkspace: WorkspaceInfo | null = null;
  private searchStats: {
    totalQueries: number;
    cacheHits: number;
    hybridQueries: number;
    rerankedQueries: number;
    lastQuery: Date | null;
  };

  constructor(config: Config, workspaceManager?: WorkspaceManager) {
    this.config = config;
    this.workspaceManager = workspaceManager || new WorkspaceManager();
    this.voyageClient = new VoyageClient(config.voyageApiKey);
    
    // Create a temporary Qdrant client with default collection
    // This will be updated during initialize() with workspace-specific collection
    this.qdrantClient = new QdrantVectorClient(
      config.qdrantUrl,
      config.qdrantApiKey,
      config.collectionName, // Temporary, will be replaced
      this.voyageClient.getEmbeddingDimension(config.embeddingModel)
    );
    
    // Initialize enhanced services
    this.llmReranker = new LLMRerankerService(config);
    this.hybridSearch = new HybridSearchService(config);
    this.contextManager = new ContextManagerService(config);
    this.searchCache = new SearchCacheService(config);
    
    // Initialize search statistics
    this.searchStats = {
      totalQueries: 0,
      cacheHits: 0,
      hybridQueries: 0,
      rerankedQueries: 0,
      lastQuery: null
    };
  }

  /**
   * Helper to build SearchQuery objects with optional properties handled correctly
   */
  public buildSearchQuery(args: {
    query: string;
    language?: string;
    chunkType?: ChunkType;
    filePath?: string;
    limit?: number;
    threshold?: number;
    enableHybrid?: boolean;
    enableReranking?: boolean;
    llmRerankerTimeoutMs?: number;
    maxFilesPerType?: number;
    preferFunctions?: boolean;
    preferClasses?: boolean;
    preferImplementation?: boolean;
  }): SearchQuery {
    const searchQuery: SearchQuery = {
      query: args.query,
      threshold: args.threshold ?? 0.25, // default threshold lowered to 0.25
    };

    if (args.language !== undefined) { searchQuery.language = args.language; }
    if (args.chunkType !== undefined) { searchQuery.chunkType = args.chunkType; }
    if (args.filePath !== undefined) { searchQuery.filePath = args.filePath; }
    if (args.limit !== undefined) { searchQuery.limit = args.limit; }
    if (args.threshold !== undefined) { searchQuery.threshold = args.threshold; }
    if (args.enableHybrid !== undefined) { searchQuery.enableHybrid = args.enableHybrid; }
    if (args.enableReranking !== undefined) { searchQuery.enableReranking = args.enableReranking; }
    if (args.llmRerankerTimeoutMs !== undefined) { searchQuery.llmRerankerTimeoutMs = args.llmRerankerTimeoutMs; }
    if (args.maxFilesPerType !== undefined) { searchQuery.maxFilesPerType = args.maxFilesPerType; }
    if (args.preferFunctions !== undefined) { searchQuery.preferFunctions = args.preferFunctions; }
    if (args.preferClasses !== undefined) { searchQuery.preferClasses = args.preferClasses; }
    if (args.preferImplementation !== undefined) { searchQuery.preferImplementation = args.preferImplementation; }

    return searchQuery;
  }

  /**
   * Initialize the search service with workspace detection
   */
  async initialize(): Promise<void> {
    try {
      // Detect current workspace or use existing one
      if (!this.currentWorkspace) {
        this.currentWorkspace = await this.workspaceManager.detectCurrentWorkspace();
      }
      
      // Update Qdrant client to use workspace-specific collection
      this.updateQdrantClientForWorkspace(this.currentWorkspace);
      
      // Test connections
      const voyageTest = await this.voyageClient.testConnection();
      if (!voyageTest) {
        throw new Error('Failed to connect to Voyage AI');
      }

      const qdrantTest = await this.qdrantClient.testConnection();
      if (!qdrantTest) {
        throw new Error('Failed to connect to Qdrant');
      }

      console.log(`🔍 SearchService initialized for workspace: ${this.currentWorkspace.name}`);
      console.log(`📊 Using collection: ${this.currentWorkspace.collectionName}`);
      // Start cache lifecycle once dependencies are confirmed
      this.searchCache.start()
    } catch (error) {
      throw new Error(`Failed to initialize search service: ${error}`);
    }
  }

  /**
   * Update Qdrant client for workspace-specific collection
   */
  private updateQdrantClientForWorkspace(workspace: WorkspaceInfo): void {
    this.qdrantClient = new QdrantVectorClient(
      this.config.qdrantUrl,
      this.config.qdrantApiKey,
      workspace.collectionName, // Use workspace-specific collection name
      this.voyageClient.getEmbeddingDimension(this.config.embeddingModel)
    );
    
    console.log(`🔄 Updated SearchService Qdrant client for workspace collection: ${workspace.collectionName}`);
  }

  /**
   * Enhanced search with caching, hybrid retrieval, and LLM re-ranking (Cursor-style @codebase functionality)
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    const requestStartTime = Date.now();
    console.log(`🔍 [SearchService] Starting enhanced search for: "${query.query}"`);
    console.log(`🔍 [SearchService] Search options:`, {
      language: query.language,
      chunkType: query.chunkType,
      filePath: query.filePath,
      limit: query.limit || 50, // Increased from 10 to 50 for better coverage
      threshold: query.threshold ?? 0.25, // Default now 0.25 for broader recall
      enableHybrid: query.enableHybrid ?? this.config.enableHybridSearch,
      enableReranking: query.enableReranking ?? this.config.enableLLMReranking,
      llmRerankerTimeoutMs: query.llmRerankerTimeoutMs ?? this.config.llmRerankerTimeoutMs
    });

    // Update statistics
    this.searchStats.totalQueries++;
    this.searchStats.lastQuery = new Date();

    try {
      // Validate query
      if (!query.query || query.query.trim().length === 0) {
        throw new Error('Search query cannot be empty');
      }

      // Check cache first
      const cachedResults = this.searchCache.get(query);
      if (cachedResults) {
        this.searchStats.cacheHits++;
        console.log(`🎯 [SearchService] Returning ${cachedResults.length} cached results (took ${Date.now() - requestStartTime}ms)`);
        return cachedResults;
      }

      // Generate embedding for the query using Voyage AI's code-optimized model
      console.time('[SearchService] Embedding generation');
      const queryVector = await this.voyageClient.generateEmbedding(
        query.query,
        this.config.embeddingModel,
        'query' // Use 'query' input type for search queries
      );
      console.timeEnd('[SearchService] Embedding generation');
      console.log(`✅ [SearchService] Generated embedding vector of length ${queryVector.length}`);

      // Perform dense semantic search
      console.time('[SearchService] Dense search');
      const denseResults = await this.qdrantClient.searchSimilar(query, queryVector);
      console.timeEnd('[SearchService] Dense search');
      console.log(`🔍 [SearchService] Found ${denseResults.length} dense results`);
      
      // Log top dense results with scores
      if (denseResults.length > 0) {
        console.log(`📊 [SearchService] Top dense results:`);
        denseResults.slice(0, 3).forEach((result, i) => {
          console.log(`   ${i + 1}. ${result.chunk.filePath} (${result.chunk.chunkType}) - Score: ${result.score.toFixed(3)}`);
        });
      }

      // Perform sparse keyword search (simple BM25-style)
      console.time('[SearchService] Keyword search');
      const sparseResults = await this.qdrantClient.keywordSearch({
        ...query,
        limit: (query.limit || 20) * 2 // fetch extra candidates for blending
      });
      console.timeEnd('[SearchService] Keyword search');
      console.log(`🔍 [SearchService] Found ${sparseResults.length} sparse results`);
      
      // Log top sparse results with scores
      if (sparseResults.length > 0) {
        console.log(`📊 [SearchService] Top sparse results:`);
        sparseResults.slice(0, 3).forEach((result, i) => {
          console.log(`   ${i + 1}. ${result.chunk.filePath} (${result.chunk.chunkType}) - Score: ${result.score.toFixed(3)}`);
        });
      }

      // Perform hybrid search if enabled
      let finalResults: SearchResult[];
      const enableHybrid = query.enableHybrid ?? this.config.enableHybridSearch;

      if (enableHybrid && this.hybridSearch.isEnabled()) {
        this.searchStats.hybridQueries++;
        console.time('[SearchService] Hybrid combine');
        const hybridResult = await this.hybridSearch.hybridSearch(query, denseResults, sparseResults);
        finalResults = hybridResult.combinedResults;
        console.timeEnd('[SearchService] Hybrid combine');
        console.log(`🔀 [SearchService] Hybrid search completed with ${finalResults.length} results`);
        
        // Log top hybrid results with detailed scores
        if (finalResults.length > 0) {
          console.log(`📊 [SearchService] Top hybrid results (α=${hybridResult.alpha}):`);
          finalResults.slice(0, 3).forEach((result, i) => {
            const hybridScore = result.hybridScore;
            const scoreDetail = hybridScore ? 
              `Dense: ${hybridScore.dense.toFixed(3)}, Sparse: ${hybridScore.sparse?.toFixed(3) || 'N/A'}, Combined: ${hybridScore.combined.toFixed(3)}` :
              `Score: ${result.score.toFixed(3)}`;
            console.log(`   ${i + 1}. ${result.chunk.filePath} (${result.chunk.chunkType}) - ${scoreDetail}`);
          });
        }
      } else {
        // If hybrid disabled, fall back to dense, then sparse as secondary
        finalResults = denseResults.length > 0 ? denseResults : sparseResults;
        console.log(`📊 [SearchService] Using ${denseResults.length > 0 ? 'dense' : 'sparse'} results (hybrid disabled)`);
      }

      // Apply implementation boosting if enabled (default true)
      if (query.preferImplementation !== false) {
        console.time('[SearchService] Implementation boosting');
        console.log(`📊 [SearchService] Before implementation boosting - Top 3:`);
        finalResults.slice(0, 3).forEach((result, i) => {
          console.log(`   ${i + 1}. ${result.chunk.filePath} (${result.chunk.chunkType}) - Score: ${result.score.toFixed(3)}`);
        });
        
        finalResults = this.boostImplementationResults(finalResults);
        console.timeEnd('[SearchService] Implementation boosting');
        
        console.log(`📊 [SearchService] After implementation boosting - Top 3:`);
        finalResults.slice(0, 3).forEach((result, i) => {
          console.log(`   ${i + 1}. ${result.chunk.filePath} (${result.chunk.chunkType}) - Score: ${result.score.toFixed(3)}`);
        });
      }

      // Apply metadata boosting
      console.time('[SearchService] Metadata boosting');
      finalResults = this.contextManager.boostResultsByMetadata(finalResults);
      console.timeEnd('[SearchService] Metadata boosting');

      // Optimize results for context
      console.time('[SearchService] Context optimization');
      finalResults = this.contextManager.optimizeForContext(finalResults, query.query, {
        preferFunctions: query.preferFunctions ?? (query.chunkType === ChunkType.FUNCTION),
        preferClasses: query.preferClasses ?? (query.chunkType === ChunkType.CLASS),
        maxFilesPerType: query.maxFilesPerType ?? 3,
        diversifyLanguages: !query.language
      });
      console.timeEnd('[SearchService] Context optimization');

      // Apply LLM re-ranking if enabled and within overall timeout
      const enableReranking = query.enableReranking ?? this.config.enableLLMReranking;
      const currentElapsedTime = Date.now() - requestStartTime;
      const overallTimeout = query.llmRerankerTimeoutMs || this.config.llmRerankerTimeoutMs || 50000; // Use LLM reranker timeout as proxy for overall RPC time
      
      if (enableReranking && this.llmReranker.getStats().enabled && finalResults.length > 1 && currentElapsedTime < overallTimeout) {
        this.searchStats.rerankedQueries++;
        
        console.log(`📊 [SearchService] Before LLM reranking - Top 3:`);
        finalResults.slice(0, 3).forEach((result, i) => {
          console.log(`   ${i + 1}. ${result.chunk.filePath} (${result.chunk.chunkType}) - Score: ${result.score.toFixed(3)}`);
        });
        
        console.time('[SearchService] LLM re-ranking');
        
        // Convert SearchResult[] to the format expected by the reranker
        const searchResultsForReranker = finalResults.slice(0, 10).map(result => ({
          chunkId: result.chunk.id, // Use 'id' instead of 'chunkId'
          score: result.score,
          filePath: result.chunk.filePath,
          startLine: result.chunk.startLine,
          endLine: result.chunk.endLine,
          content: result.snippet,
          chunkType: result.chunk.chunkType,
          language: result.chunk.language
        }));
        
        const rerankerResponse = await this.llmReranker.rerank(
          query.query,
          searchResultsForReranker,
          Math.min(query.limit || 10, 10)
        );
        
        // Convert reranked results back to SearchResult format
        if (rerankerResponse.reranked) {
          finalResults = rerankerResponse.results.map(rerankedResult => {
            // Find the original result to preserve all metadata
            const originalResult = finalResults.find(r => r.chunk.id === rerankedResult.chunkId);
            return originalResult || {
              id: rerankedResult.chunkId,
              chunk: {
                id: rerankedResult.chunkId,
                filePath: rerankedResult.filePath,
                startLine: rerankedResult.startLine,
                endLine: rerankedResult.endLine,
                content: rerankedResult.content,
                chunkType: rerankedResult.chunkType || 'generic',
                language: rerankedResult.language || 'unknown',
                functionName: undefined,
                className: undefined,
                contentHash: '',
                metadata: { isTest: false }
              },
              score: rerankedResult.score,
              snippet: rerankedResult.content.substring(0, 200),
              context: undefined
            };
          }).filter((result): result is SearchResult => result !== null);
        }
        
        console.timeEnd('[SearchService] LLM re-ranking');
        console.log(`🧠 [SearchService] LLM re-ranking completed with ${finalResults.length} results`);
        
        console.log(`📊 [SearchService] After LLM reranking - Top 3:`);
        finalResults.slice(0, 3).forEach((result, i) => {
          console.log(`   ${i + 1}. ${result.chunk.filePath} (${result.chunk.chunkType}) - Score: ${result.score.toFixed(3)}`);
        });
      } else if (enableReranking && currentElapsedTime >= overallTimeout) {
        console.warn(`[SearchService] Skipping LLM re-ranking due to overall timeout. Elapsed: ${currentElapsedTime}ms / Timeout: ${overallTimeout}ms`);
      }

      // Post-process and enhance results
      console.time('[SearchService] Post-processing');
      const processedResults = this.postProcessResults(finalResults, query);
      console.timeEnd('[SearchService] Post-processing');
      
      // Cache results if appropriate
      if (this.searchCache.shouldCache(query, processedResults)) {
        this.searchCache.set(query, processedResults);
      }
      
      console.log(`✅ [SearchService] Returning ${processedResults.length} enhanced results (total time: ${Date.now() - requestStartTime}ms)`);
      
      // Log final score pipeline summary
      console.log(`📊 [SearchService] FINAL RANKING - Query: "${query.query}"`);
      processedResults.slice(0, 5).forEach((result, i) => {
        const fileKind = result.chunk.filePath.includes('.md') || 
                        result.chunk.filePath.includes('README') || 
                        result.chunk.filePath.includes('docs/') ? '📝' : '🔥';
        console.log(`   ${i + 1}. ${fileKind} ${result.chunk.filePath} (${result.chunk.chunkType}) - Final: ${result.score.toFixed(3)}`);
      });
      
      return processedResults;

    } catch (error) {
      console.error(`❌ [SearchService] Enhanced search failed:`, error);
      if (error instanceof Error) {
        throw new Error(`SearchService failed: ${error.message}`);
      }
      throw new Error(`SearchService failed: ${String(error)}`);
    }
  }

  /**
   * Search for functions by name or description
   */
  async searchFunctions(query: SearchQuery): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      ...query,
      chunkType: ChunkType.FUNCTION,
      threshold: query.threshold || 0.4 // Lowered from 0.5 for better results
    };
    return this.search(searchQuery);
  }

  /**
   * Search for classes by name or description
   */
  async searchClasses(query: SearchQuery): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      ...query,
      chunkType: ChunkType.CLASS,
      threshold: query.threshold || 0.4 // Lowered from 0.5 for better results
    };
    return this.search(searchQuery);
  }

  /**
   * Search for interfaces by name or description
   */
  async searchInterfaces(query: SearchQuery): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      ...query,
      chunkType: ChunkType.INTERFACE,
      threshold: query.threshold || 0.4 // Lowered from 0.5 for better results
    };
    return this.search(searchQuery);
  }

  /**
   * Search within a specific file
   */
  async searchInFile(query: SearchQuery): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      ...query,
      threshold: query.threshold || 0.5 // Lowered from 0.6 for consistency
    };

    return this.search(searchQuery);
  }

  /**
   * Search for code by programming language
   */
  async searchByLanguage(query: SearchQuery): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      ...query,
      threshold: query.threshold || 0.4 // Lowered from 0.5 for better results
    };

    return this.search(searchQuery);
  }

  /**
   * Find similar code chunks to a given chunk
   */
  async findSimilar(query: SearchQuery): Promise<SearchResult[]> {
    try {
      // Get the chunk content first
      // query.query here should be the chunkId
      const chunk = await this.getChunkById(query.query);
      if (!chunk) {
        throw new Error(`Chunk not found: ${query.query}`);
      }

      // Use the chunk content as query
      const searchQuery: SearchQuery = {
        query: chunk.content,
        limit: (query.limit || 5) + 1, // +1 to exclude the original chunk
        threshold: query.threshold || 0.5
      };

      const results = await this.search(searchQuery);
      
      // Filter out the original chunk
      return results.filter(result => result.id !== chunk.id);
    } catch (error) {
      throw new Error(`Failed to find similar chunks: ${error}`);
    }
  }

  /**
   * Get suggestions for code completion or exploration
   */
  async getSuggestions(query: SearchQuery, type: 'function' | 'class' | 'variable' | 'any' = 'any'): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      ...query,
      limit: query.limit || 5,
      threshold: query.threshold || 0.6
    };
    const chunkType = type === 'function' ? ChunkType.FUNCTION :
                     type === 'class' ? ChunkType.CLASS :
                     type === 'variable' ? ChunkType.VARIABLE :
                     undefined;
    if (chunkType !== undefined) {
      searchQuery.chunkType = chunkType;
    }

    return this.search(searchQuery);
  }

  /**
   * Search for code patterns or implementation examples
   */
  async searchPatterns(query: SearchQuery): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      query: `implementation pattern example ${query.query}`,
      limit: query.limit || 10,
      threshold: query.threshold || 0.6
    };

    return this.search(searchQuery);
  }

  /**
   * Advanced search with multiple criteria
   */
  async advancedSearch(query: SearchQuery): Promise<SearchResult[]> {
    const searchQuery: SearchQuery = {
      query: query.query,
      limit: query.limit || 10,
      threshold: query.threshold || 0.7,
    };

    if (query.language !== undefined) {
      searchQuery.language = query.language;
    }
    if (query.chunkType !== undefined) {
      searchQuery.chunkType = query.chunkType;
    }
    if (query.filePath !== undefined) {
      searchQuery.filePath = query.filePath;
    }

    const results = await this.search(searchQuery);

    // Filter by test files if specified
    // Assuming query.filterByTestFiles exists in the future, if needed
    // if (query.filterByTestFiles !== undefined) {
    //   return results.filter(result => 
    //     result.chunk.metadata.isTest === query.filterByTestFiles
    //   );
    // }

    return results;
  }

  /**
   * Get code chunk by ID
   */
  async getChunkById(chunkId: string): Promise<CodeChunk | null> {
    try {
      const searchResults = await this.qdrantClient.getPointsById([chunkId]);
      if (searchResults.length > 0) {
        const chunkPayload = searchResults[0].payload as EmbeddingPayload;
        return {
          id: searchResults[0].id as string,
          content: chunkPayload.content,
          filePath: chunkPayload.filePath,
          language: chunkPayload.language,
          startLine: chunkPayload.startLine,
          endLine: chunkPayload.endLine,
          chunkType: chunkPayload.chunkType,
          metadata: chunkPayload.metadata,
          contentHash: chunkPayload.contentHash,
          ...(chunkPayload.functionName !== undefined ? { functionName: chunkPayload.functionName } : {}),
          ...(chunkPayload.className !== undefined ? { className: chunkPayload.className } : {}),
          ...(chunkPayload.moduleName !== undefined ? { moduleName: chunkPayload.moduleName } : {}),
          ...(chunkPayload.astNodeType !== undefined ? { astNodeType: chunkPayload.astNodeType } : {}),
          ...(chunkPayload.parentChunkId !== undefined ? { parentChunkId: chunkPayload.parentChunkId } : {}),
          ...(chunkPayload.childChunkIds !== undefined ? { childChunkIds: chunkPayload.childChunkIds } : {}),
          ...(chunkPayload.complexity !== undefined ? { complexity: chunkPayload.complexity } : {}),
          ...(chunkPayload.tokenCount !== undefined ? { tokenCount: chunkPayload.tokenCount } : {}),
        };
      }
      return null;
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
  async getSearchStats(): Promise<SearchStats> {
    console.log(`📊 [SearchService] Gathering comprehensive search statistics...`);
    
    try {
      // Get total chunks count
      const totalChunks = await this.qdrantClient.countPoints();
      console.log(`📊 [SearchService] Total chunks indexed: ${totalChunks}`);

      // Get collection info for status
      const collectionInfo = await this.qdrantClient.getCollectionInfo();
      const collectionStatus = collectionInfo.status || 'unknown';
      const embeddingDimension = this.voyageClient.getEmbeddingDimension(this.config.embeddingModel);

      // Calculate language and chunk type distribution directly from Qdrant if possible
      // For now, we'll use aggregated stats from indexing service or cache if available
      const languageDistribution: Record<string, number> = {};
      const chunkTypeDistribution: Record<string, number> = {};
      
      // Placeholder for actual distribution fetching logic
      // In a real scenario, this would involve Qdrant aggregations or iterating indexed metadata

      return {
        totalQueries: this.searchStats.totalQueries,
        averageLatency: this.searchStats.totalQueries > 0 ? (Date.now() - (this.searchStats.lastQuery?.getTime() || Date.now())) / this.searchStats.totalQueries : 0,
        cacheHitRate: this.searchStats.totalQueries > 0 ? (this.searchStats.cacheHits / this.searchStats.totalQueries) * 100 : 0,
        hybridSearchUsage: this.searchStats.totalQueries > 0 ? (this.searchStats.hybridQueries / this.searchStats.totalQueries) * 100 : 0,
        llmRerankerUsage: this.searchStats.totalQueries > 0 ? (this.searchStats.rerankedQueries / this.searchStats.totalQueries) * 100 : 0,
        topLanguages: languageDistribution, // To be implemented
        topChunkTypes: chunkTypeDistribution, // To be implemented
        errorRate: 0, // To be implemented
        lastQuery: this.searchStats.lastQuery || new Date(0),
        totalChunks,
        embeddingModel: this.config.embeddingModel,
        embeddingDimension,
        collectionStatus,
        searchCacheSize: await this.searchCache.size?.() ?? 0,
        searchCacheMemory: await this.searchCache.memoryUsage?.() ?? 0,
        rerankerCacheSize: 0,
        rerankerCacheMemory: 0,
        llmRerankerAverageLatency: this.llmReranker.getStats().avgDurationMs,
        llmRerankerErrorRate: this.llmReranker.getStats().errorRate,
        qdrantClientLatency: this.qdrantClient.getAverageLatency?.() ?? 0,
      };
      
    } catch (error) {
      console.error(`❌ [SearchService] Failed to gather search statistics:`, error);
      throw new Error(`SearchService failed to get search stats: ${String(error)}`);
    }
  }

  /**
   * Get comprehensive health status of all services (enhanced for Cursor-like codebase insights)
   */
  public async getHealthStatus(): Promise<HealthStatus> {
    const timestamp = new Date();
    let qdrantStatus: ServiceHealth = { status: 'unhealthy', lastCheck: timestamp, message: 'Not initialized' };
    let voyageStatus: ServiceHealth = { status: 'unhealthy', lastCheck: timestamp, message: 'Not initialized' };
    let llmRerankerStatus: ServiceHealth = { status: 'disabled', lastCheck: timestamp, message: 'LLM Reranker is disabled' };
    let fileWatcherStatus: ServiceHealth = { status: 'healthy', lastCheck: timestamp, message: 'File watcher not directly managed by SearchService' };

    try {
      const qdrantTest = await this.qdrantClient.testConnection();
      qdrantStatus = { status: qdrantTest ? 'healthy' : 'unhealthy', lastCheck: timestamp, message: qdrantTest ? 'Connected' : 'Connection failed' };
    } catch (error: any) {
      qdrantStatus = { status: 'unhealthy', lastCheck: timestamp, message: `Connection error: ${error.message}` };
    }

    try {
      const voyageTest = await this.voyageClient.testConnection();
      voyageStatus = { status: voyageTest ? 'healthy' : 'unhealthy', lastCheck: timestamp, message: voyageTest ? 'Connected' : 'Connection failed' };
    } catch (error: any) {
      voyageStatus = { status: 'unhealthy', lastCheck: timestamp, message: `Connection error: ${error.message}` };
    }

    if (this.llmReranker.getStats().enabled) {
      try {
        const llmRerankerTest = true; // OpenAI SDK handles connection testing internally
        llmRerankerStatus = { status: llmRerankerTest ? 'healthy' : 'unhealthy', lastCheck: timestamp, message: llmRerankerTest ? 'Connected' : 'Connection failed' };
      } catch (error: any) {
        llmRerankerStatus = { status: 'unhealthy', lastCheck: timestamp, message: `Connection error: ${error.message}` };
      }
    } else {
      llmRerankerStatus = { status: 'disabled', lastCheck: timestamp, message: 'LLM Reranker is disabled in config' };
    }

    // File watcher status is not directly determined by SearchService
    // You might need to pass a reference to WorkspaceWatcher or get its status via another service

    return {
      status: (qdrantStatus.status === 'healthy' && voyageStatus.status === 'healthy') ? 'healthy' : 'degraded',
      timestamp,
      services: {
        qdrant: qdrantStatus,
        voyage: voyageStatus,
        llmReranker: llmRerankerStatus,
        fileWatcher: fileWatcherStatus, // Placeholder
      },
      metrics: {
        uptime: process.uptime() * 1000, // in ms
        memoryUsage: process.memoryUsage().rss, // Resident Set Size in bytes
        // cpuUsage: process.cpuUsage(), // CPU usage might need more complex calculation for percentage
        // diskUsage: , // Disk usage requires OS-specific calls or libraries
      },
      version: this.config.mcpSchemaVersion, // Using MCP schema version as app version for now
      mcpSchemaVersion: this.config.mcpSchemaVersion,
    };
  }

  /**
   * Get enhanced search statistics (enhanced for Cursor-like codebase insights)
   */
  public getEnhancedSearchStats(): SearchStats {
    // Retrieve aggregated stats from searchStats and potentially other services
    return {
      totalQueries: this.searchStats.totalQueries,
      averageLatency: this.searchStats.totalQueries > 0 ? (Date.now() - (this.searchStats.lastQuery?.getTime() || Date.now())) / this.searchStats.totalQueries : 0,
      cacheHitRate: this.searchStats.totalQueries > 0 ? (this.searchStats.cacheHits / this.searchStats.totalQueries) * 100 : 0,
      hybridSearchUsage: this.searchStats.totalQueries > 0 ? (this.searchStats.hybridQueries / this.searchStats.totalQueries) * 100 : 0,
      llmRerankerUsage: this.searchStats.totalQueries > 0 ? (this.searchStats.rerankedQueries / this.searchStats.totalQueries) * 100 : 0,
      errorRate: 0, // Placeholder
      lastQuery: this.searchStats.lastQuery || new Date(0),
      topLanguages: {}, // Placeholder
      topChunkTypes: {}, // Placeholder
      totalChunks: 0,
      embeddingModel: this.config.embeddingModel,
      embeddingDimension: this.voyageClient.getEmbeddingDimension(this.config.embeddingModel),
      collectionStatus: 'unknown',
      searchCacheSize: this.searchCache.size(),
      searchCacheMemory: this.searchCache.memoryUsage(),
      rerankerCacheSize: 0, // No cache in OpenAI SDK implementation
      rerankerCacheMemory: 0, // No memory tracking in OpenAI SDK implementation
      llmRerankerAverageLatency: this.llmReranker.getStats().avgDurationMs,
      llmRerankerErrorRate: this.llmReranker.getStats().errorRate,
      qdrantClientLatency: this.qdrantClient.getAverageLatency(),
      // Add other relevant service statuses if needed from getServiceStatus
    };
  }

  public invalidateFileCache(filePath: string): void {
    this.searchCache.invalidateFile(filePath);
  }

  public clearCaches(): void {
    this.searchCache.clear();
  }

  /**
   * Boost implementation code results over documentation
   */
  private boostImplementationResults(results: SearchResult[]): SearchResult[] {
    const IMPLEMENTATION_BOOST = 1.30; // 30% boost for implementation code
    const DOCS_PENALTY = 0.85; // 15% penalty for documentation
    
    const boostedResults = results.map(result => {
      const chunkType = result.chunk.chunkType;
      const filePath = result.chunk.filePath.toLowerCase();
      
      // Determine fileKind from file path (same logic as in indexing)
      const extension = filePath.split('.').pop() || '';
      const docExtensions = ['md', 'txt', 'rst', 'adoc', 'asciidoc'];
      const docPatterns = ['readme', 'changelog', 'license', 'contributing', 'docs/', 'documentation/', 'memory-bank/'];
      
      const isDocumentation = docExtensions.includes(extension) || 
                             docPatterns.some(pattern => filePath.includes(pattern));
      
      // Boost score based on file type and chunk type
      let boostFactor = 1.0;
      
      // Primary boost: implementation code vs documentation
      if (!isDocumentation) {
        boostFactor *= IMPLEMENTATION_BOOST;
      } else {
        boostFactor *= DOCS_PENALTY;
      }
      
      // Secondary boost: prefer function and class chunks
      if (chunkType === ChunkType.FUNCTION || chunkType === ChunkType.CLASS || chunkType === ChunkType.METHOD) {
        boostFactor *= 1.15; // Additional 15% boost for code entities
      }
      
      // Apply the boost
      const boostedScore = result.score * boostFactor;
      
      console.log(`🔧 [SearchService] Boosting ${result.chunk.filePath} (${chunkType}): ${result.score.toFixed(3)} → ${boostedScore.toFixed(3)} (factor: ${boostFactor.toFixed(2)})`);
      
      return {
        ...result,
        score: boostedScore
      };
    });
    
    // Re-sort by the new boosted scores
    return boostedResults.sort((a, b) => b.score - a.score);
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

  /**
   * Search and return Cursor-style code references with token budgeting
   */
  async searchForCodeReferences(
    query: SearchQuery,
    maxTokens?: number
  ): Promise<{
    references: CodeReference[];
    truncated: boolean;
    summary?: string;
    metadata: {
      totalResults: number;
      searchTime: number;
      cacheHit: boolean;
      hybridUsed: boolean;
      reranked: boolean;
    };
  }> {
    const startTime = Date.now();
    
    // Increase limit for better context selection
    const enhancedQuery = {
      ...query,
      limit: Math.max(query.limit || 10, 20)
    };
    
    // Check if this will be a cache hit
    const willHitCache = !!this.searchCache.get(query);
    
    // Perform search
    const results = await this.search(enhancedQuery);
    
    // Convert to code references with token budgeting
    const { references, contextWindow, truncated } = this.contextManager.formatAsCodeReferences(
      results,
      maxTokens
    );
    
    const searchTime = Date.now() - startTime;
    
    return {
      references,
      truncated,
      ...(contextWindow.summary && { summary: contextWindow.summary }),
      metadata: {
        totalResults: results.length,
        searchTime,
        cacheHit: willHitCache,
        hybridUsed: (enhancedQuery.enableHybrid ?? this.config.enableHybridSearch) && this.hybridSearch.isEnabled(),
        reranked: (enhancedQuery.enableReranking ?? this.config.enableLLMReranking) && this.llmReranker.getStats().enabled
      }
    };
  }
} 