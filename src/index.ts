#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Config, ChunkType, SearchResult } from './types.js';
import { IndexingService } from './services/indexing-service.js';
import { SearchService } from './services/search-service.js';
import { loadConfig, validateConfig, printConfigSummary } from './config.js';
import { WorkspaceWatcher } from './services/workspace-watcher.js';

// Server configuration
const SERVER_NAME = 'codebase-indexing-server';
const SERVER_VERSION = '1.0.0';

export const TOOL_DEFINITIONS = [
  {
    name: 'index_directory',
    description: 'Index all files in a directory recursively',
    inputSchema: {
      type: 'object',
      properties: {
        directory_path: {
          type: 'string',
          description: 'Path to the directory to index'
        }
      },
      required: ['directory_path']
    }
  },
  {
    name: 'index_file',
    description: 'Index a single file',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to index'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'search_code',
    description: 'Search for code using semantic similarity',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        language: {
          type: 'string',
          description: 'Programming language to filter by (optional)'
        },
        chunk_type: {
          type: 'string',
          description: 'Type of code chunk to search for (function, class, etc.)'
        },
        file_path: {
          type: 'string',
          description: 'File path to search within (optional)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)'
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity threshold (default: 0.7)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_functions',
    description: 'Search for functions by name or description',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Function name or description to search for'
        },
        language: {
          type: 'string',
          description: 'Programming language to filter by (optional)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_classes',
    description: 'Search for classes by name or description',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Class name or description to search for'
        },
        language: {
          type: 'string',
          description: 'Programming language to filter by (optional)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'find_similar',
    description: 'Find code chunks similar to a given chunk',
    inputSchema: {
      type: 'object',
      properties: {
        chunk_id: {
          type: 'string',
          description: 'ID of the chunk to find similar chunks for'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)'
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity threshold (default: 0.7)'
        }
      },
      required: ['chunk_id']
    }
  },
  {
    name: 'get_code_context',
    description: 'Get code context around a specific chunk',
    inputSchema: {
      type: 'object',
      properties: {
        chunk_id: {
          type: 'string',
          description: 'ID of the chunk to get context for'
        },
        context_lines: {
          type: 'number',
          description: 'Number of lines of context to include (default: 5)'
        }
      },
      required: ['chunk_id']
    }
  },
  {
    name: 'get_indexing_stats',
    description: 'Get statistics about the indexed codebase',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_search_stats',
    description: 'Get statistics about the search index',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'clear_index',
    description: 'Clear the entire search index',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'remove_file',
    description: 'Remove a file from the search index',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to remove from index'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'reindex_file',
    description: 'Re-index a single file',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to re-index'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'create_payload_indexes',
    description: 'Create payload indexes for filtering (chunkType, language, filePath) on existing collection',
    inputSchema: {
      type: 'object',
      properties: {
        force: { 
          type: 'boolean', 
          description: 'Force creation even if indexes might exist',
          default: false 
        }
      },
      required: []
    }
  },
  {
    name: 'codebase_search',
    description: 'Natural language search for codebase understanding. Handles queries like "How is user authentication handled?", "Database connection setup", "Error handling patterns", "API endpoint definitions", "Component state management". Returns relevant code snippets with file paths, line numbers, similarity scores, and navigation links.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query describing what you want to find in the codebase (e.g., "How is user authentication handled?", "Database connection setup", "Error handling patterns")'
        },
        language: {
          type: 'string',
          description: 'Programming language to filter by (optional)'
        },
        chunk_type: {
          type: 'string',
          description: 'Type of code chunk to search for (function, class, etc.)'
        },
        file_path: {
          type: 'string',
          description: 'File path to search within (optional)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)'
        },
        max_tokens: {
          type: 'number',
          description: 'Maximum tokens for context window (optional)'
        },
        enable_hybrid: {
          type: 'boolean',
          description: 'Enable hybrid search (dense + sparse)'
        },
        enable_reranking: {
          type: 'boolean',
          description: 'Enable LLM re-ranking of results'
        },
        prefer_implementation: {
          type: 'boolean',
          description: 'Prefer implementation code over documentation (default: true)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_health_status',
    description: 'Get comprehensive health status of all services',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_enhanced_stats',
    description: 'Get enhanced statistics including search cache, hybrid search, and LLM re-ranking metrics',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'clear_search_cache',
    description: 'Clear search cache and reset statistics',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'invalidate_file_cache',
    description: 'Invalidate cache entries for a specific file (useful when file is modified)',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to invalidate from cache'
        }
      },
      required: ['file_path']
    }
  }
];

// Export function to setup MCP tools (used by HTTP server)
export function setupMcpTools(server: Server, indexingService: IndexingService, searchService: SearchService): void {
  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOL_DEFINITIONS
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
      return {
        content: [{
          type: 'text',
          text: 'Error: No arguments provided'
        }],
        isError: true
      };
    }

    try {
      // Ensure services are initialized before tool execution
      if ('ensureServicesInitialized' in globalThis) {
        await (globalThis as any).ensureServicesInitialized();
      }

      switch (name) {
        case 'index_directory':
          const dirStats = await indexingService.indexDirectory(args.directory_path as string);
          return {
            content: [{
              type: 'text',
              text: `Successfully indexed directory: ${args.directory_path}\nGenerated ${dirStats.totalChunks} chunks`
            }]
          };
        case 'index_file':
          const fileChunks = await indexingService.indexFile(args.file_path as string);
          return {
            content: [{
              type: 'text',
              text: `Successfully indexed file: ${args.file_path}\nGenerated ${fileChunks.length} chunks`
            }]
          };
        case 'search_code':
          const codeResults = await searchService.search(
            searchService.buildSearchQuery({
            query: args.query as string,
              ...(args.language !== undefined ? { language: args.language as string } : {}),
              ...(args.chunk_type !== undefined ? { chunkType: args.chunk_type as ChunkType } : {}),
              ...(args.file_path !== undefined ? { filePath: args.file_path as string } : {}),
              ...(args.limit !== undefined ? { limit: args.limit as number } : {}),
              ...(args.threshold !== undefined ? { threshold: args.threshold as number } : {}),
              ...(args.enable_hybrid !== undefined ? { enableHybrid: args.enable_hybrid as boolean } : {}),
              ...(args.enable_reranking !== undefined ? { enableReranking: args.enable_reranking as boolean } : {}),
              ...(args.llm_reranker_timeout_ms !== undefined ? { llmRerankerTimeoutMs: args.llm_reranker_timeout_ms as number } : {}),
            })
          );
          return {
            content: [{
              type: 'text',
              text: `Search results for "${args.query}":\n\n` +
                    codeResults.map((result: any, index: number) => 
                      `${index + 1}. [Score: ${result.score.toFixed(3)}] ${result.context}\n` +
                      `\`\`\`${result.chunk.language}\n${result.snippet}\n\`\`\``
                    ).join('\n\n')
            }]
          };
        case 'search_functions':
          const functionResults = await searchService.searchFunctions(
            searchService.buildSearchQuery({
              query: args.query as string,
              ...(args.language !== undefined ? { language: args.language as string } : {}),
              ...(args.limit !== undefined ? { limit: args.limit as number } : {}),
              chunkType: ChunkType.FUNCTION,
            })
          );
          return {
            content: [{
              type: 'text',
              text: `Function search results for "${args.query}":\n\n` +
                    functionResults.map((result: any, index: number) => 
                      `${index + 1}. [Score: ${result.score.toFixed(3)}] ${result.context}\n` +
                      `\`\`\`${result.chunk.language}\n${result.snippet}\n\`\`\``
                    ).join('\n\n')
            }]
          };
        case 'search_classes':
          const classResults = await searchService.searchClasses(
            searchService.buildSearchQuery({
              query: args.query as string,
              ...(args.language !== undefined ? { language: args.language as string } : {}),
              ...(args.limit !== undefined ? { limit: args.limit as number } : {}),
              chunkType: ChunkType.CLASS,
            })
          );
          return {
            content: [{
              type: 'text',
              text: `Class search results for "${args.query}":\n\n` +
                    classResults.map((result: any, index: number) => 
                      `${index + 1}. [Score: ${result.score.toFixed(3)}] ${result.context}\n` +
                      `\`\`\`${result.chunk.language}\n${result.snippet}\n\`\`\``
                    ).join('\n\n')
            }]
          };
        case 'find_similar':
          const similarResults = await searchService.findSimilar(
            searchService.buildSearchQuery({
              query: args.chunk_id as string,
              ...(args.limit !== undefined ? { limit: args.limit as number } : {}),
            })
          );
          return {
            content: [{
              type: 'text',
              text: `Similar chunks to "${args.chunk_id}":\n\n` +
                    similarResults.map((result: any, index: number) => 
                      `${index + 1}. [Score: ${result.score.toFixed(3)}] ${result.context}\n` +
                      `\`\`\`${result.chunk.language}\n${result.snippet}\n\`\`\``
                    ).join('\n\n')
            }]
          };
        case 'get_code_context':
          const codeContextResult = await searchService.getCodeContext(
            args.chunk_id as string,
            args.context_lines as number | undefined
          );
          if (!codeContextResult) {
            return {
              content: [{
                type: 'text',
                text: `Chunk not found: ${args.chunk_id}`
              }],
              isError: true
            };
          }
          return {
            content: [{
              type: 'text',
              text: `Code context for chunk "${args.chunk_id}":\n\n` +
                    `File: ${codeContextResult.chunk.filePath}\n` +
                    `Lines: ${codeContextResult.chunk.startLine}-${codeContextResult.chunk.endLine}\n` +
                    `Type: ${codeContextResult.chunk.chunkType}\n\n` +
                    `\`\`\`${codeContextResult.chunk.language}\n${codeContextResult.context}\n\`\`\``
            }]
          };
        case 'get_indexing_stats':
          const indexingStats = indexingService.getStats();
          return {
            content: [{
              type: 'text',
              text: `Indexing Statistics:\n\n` +
                    `Total files: ${indexingStats.totalFiles}\n` +
                    `Total chunks: ${indexingStats.totalChunks}\n` +
                    `Total size: ${indexingStats.totalSize} bytes\n` +
                    `Average chunk size: ${Math.round(indexingStats.averageChunkSize)} bytes\n` +
                    `Last indexed: ${indexingStats.lastIndexed.toISOString()}\n` +
                    `Indexing duration: ${indexingStats.indexingDuration}ms\n` +
                    `Errors: ${indexingStats.errors}\n` +
                    `Warnings: ${indexingStats.warnings}\n` +
                    `Largest file: ${indexingStats.largestFile}\n\n` +
                    `Language distribution:\n${Object.entries(indexingStats.languageDistribution)
                      .map(([lang, count]) => `  ${lang}: ${count}`)
                      .join('\n')}\n\n` +
                    `Chunk type distribution:\n${Object.entries(indexingStats.chunkTypeDistribution)
                      .map(([type, count]) => `  ${type}: ${count}`)
                      .join('\n')}`
            }]
          };
        case 'get_search_stats':
          const searchStats = await searchService.getSearchStats();
          const languageStats = Object.entries(searchStats.topLanguages)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .map(([lang, count]) => `  • ${lang}: ${count} chunks`)
            .join('\n');
          const chunkTypeStats = Object.entries(searchStats.topChunkTypes)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .map(([type, count]) => `  • ${type}: ${count} chunks`)
            .join('\n');
          return {
            content: [{
              type: 'text',
              text: `Search Statistics:\n\n` +
                    `Total queries: ${searchStats.totalQueries}\n` +
                    `Average latency: ${searchStats.averageLatency.toFixed(2)}ms\n` +
                    `Cache hit rate: ${searchStats.cacheHitRate.toFixed(2)}%\n` +
                    `Hybrid search usage: ${searchStats.hybridSearchUsage.toFixed(2)}%\n` +
                    `LLM reranker usage: ${searchStats.llmRerankerUsage.toFixed(2)}%\n` +
                    `Error rate: ${searchStats.errorRate.toFixed(2)}%\n` +
                    `Last query: ${searchStats.lastQuery?.toISOString() || 'N/A'}\n\n` +
                    `Top Languages:\n${languageStats}\n\n` +
                    `Top Chunk Types:\n${chunkTypeStats}`
            }]
          };
        case 'clear_index':
          await indexingService.clearIndex();
          return {
            content: [{
              type: 'text',
              text: 'Successfully cleared index'
            }]
          };
        case 'remove_file':
          await indexingService.removeFile(args.file_path as string);
          return {
            content: [{
              type: 'text',
              text: `Successfully removed file: ${args.file_path}`
            }]
          };
        case 'reindex_file':
          const reindexedChunks = await indexingService.reindexFile(args.file_path as string);
          return {
            content: [{
              type: 'text',
              text: `Successfully re-indexed file: ${args.file_path}\nGenerated ${reindexedChunks.length} chunks`
            }]
          };
        case 'create_payload_indexes':
          await (searchService as any).qdrantClient.ensurePayloadIndexes();
          return {
            content: [{
              type: 'text',
              text: '🎉 Successfully created payload indexes for filtering!\n\n' +
                    '✅ chunkType index - for filtering by code elements (function, class, interface, etc.)\n' +
                    '✅ language index - for filtering by programming language (typescript, javascript, etc.)\n' +
                    '✅ filePath index - for file-specific searches\n\n' +
                    '🔍 Your collection is now ready for @codebase-style filtered searches!'
            }]
          };
        case 'codebase_search':
          const enhancedSearchArgs = args as {
            query: string;
            language?: string;
            chunk_type?: string;
            file_path?: string;
            limit?: number;
            threshold?: number;
            enable_hybrid?: boolean;
            enable_reranking?: boolean;
            max_tokens?: number;
            prefer_implementation?: boolean;
          };

          // Build enhanced search query with implementation-focused defaults
          const enhancedQuery = searchService.buildSearchQuery({
            query: enhancedSearchArgs.query,
            ...(enhancedSearchArgs.language !== undefined ? { language: enhancedSearchArgs.language } : {}),
            ...(enhancedSearchArgs.chunk_type !== undefined ? { chunkType: enhancedSearchArgs.chunk_type as ChunkType } : {}),
            ...(enhancedSearchArgs.file_path !== undefined ? { filePath: enhancedSearchArgs.file_path } : {}),
            limit: enhancedSearchArgs.limit || 20,
            threshold: enhancedSearchArgs.threshold || 0.15, // Lower threshold for broader recall
            enableHybrid: enhancedSearchArgs.enable_hybrid !== false, // Default to true
            enableReranking: enhancedSearchArgs.enable_reranking !== false, // Default to true
            
            // Implementation-focused enhancements
            preferFunctions: true, // Boost function chunks
            preferClasses: true,   // Boost class chunks
            maxFilesPerType: 5,    // Allow more results per file
            preferImplementation: enhancedSearchArgs.prefer_implementation !== false, // Default to true
          });

          const enhancedResults = await searchService.search(enhancedQuery);
          
          if (enhancedResults.length === 0) {
            return {
              content: [{
                type: 'text', 
                text: `No results found for "${enhancedSearchArgs.query}". Try broadening your search terms or checking spelling.`
              }],
              isError: false
            };
          }

          // Create comprehensive output with metadata
          const searchTime = Date.now() - Date.now(); // This will be set by search service
          const formatOutput = (results: SearchResult[]): string => {
            let output = `Codebase search results for "${enhancedSearchArgs.query}":\n\n`;
            
            results.forEach((result, index) => {
              const score = (result.score * 100).toFixed(2);
              const chunkType = result.chunk.chunkType || 'generic';
              const startLine = result.chunk.startLine;
              const endLine = result.chunk.endLine;
              const filePath = result.chunk.filePath;
              
              // Create clickable file link with line numbers
              const fileLink = `[${filePath}:${startLine}-${endLine}](cursor://file?filePath=${encodeURIComponent(filePath)}&startLine=${startLine}&endLine=${endLine})`;
              
              output += `${index + 1}. **${chunkType} (Score: ${score}%)**  - ${fileLink}\n`;
              output += `\`\`\`${result.chunk.language}\n${result.chunk.content.trim()}\n\`\`\`\n\n`;
            });
            
            // Add search metadata
            const searchStats = searchService.getEnhancedSearchStats();
            const cacheHit = searchStats.cacheHitRate > 0 ? 'Yes' : 'No';
            const hybridUsed = searchStats.hybridSearchUsage > 0 ? 'Yes' : 'No';
            const reranked = searchStats.llmRerankerUsage > 0 ? 'Yes' : 'No';
            
            output += `_Search took ${searchTime.toFixed(2)}ms. Total results: ${results.length}. Cache Hit: ${cacheHit}. Hybrid Search Used: ${hybridUsed}. Reranked: ${reranked}_`;
            
            return output;
          };

          return {
            content: [{
              type: 'text',
              text: formatOutput(enhancedResults)
            }],
            isError: false
          };
        case 'get_health_status':
          // TODO: Implement health monitoring service
          return {
            content: [{
              type: 'text',
              text: '🏥 **System Health Status**\n\n' +
                    '✅ Search Service: Operational\n' +
                    '✅ Indexing Service: Operational\n' +
                    '⚠️ Health monitoring service not yet implemented'
            }]
          };
        case 'get_enhanced_stats':
          const enhancedStats = searchService.getEnhancedSearchStats();
          return {
            content: [{
              type: 'text',
              text: `📊 **Enhanced Search Statistics**\n\n` +
                    `**Search Performance:**\n` +
                    `- Total queries: ${enhancedStats.totalQueries}\n` +
                    `- Cache hit rate: ${(enhancedStats.cacheHitRate * 100).toFixed(1)}%\n` +
                    `- Hybrid search usage: ${enhancedStats.hybridSearchUsage} queries\n` +
                    `- LLM re-ranking usage: ${enhancedStats.llmRerankerUsage} queries\n` +
                    `- Last query: ${enhancedStats.lastQuery.toISOString()}\n\n` +
                    ``
            }]
          };
        case 'clear_search_cache':
          searchService.clearCaches();
          return {
            content: [{
              type: 'text',
              text: '🧹 Successfully cleared search cache and reset statistics'
            }]
          };
        case 'invalidate_file_cache':
          searchService.invalidateFileCache(args.file_path as string);
          return {
            content: [{
              type: 'text',
              text: `🔄 Successfully invalidated cache entries for file: ${args.file_path}`
            }]
          };
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Error: ${errorMessage}`
        }],
        isError: true
      };
    }
  });
}

class CodebaseIndexingServer {
  private server: Server;
  private indexingService: IndexingService;
  private searchService: SearchService;
  private workspaceWatcher: WorkspaceWatcher;
  private workspaceDir: string;

  constructor(config: Config) {
    this.server = new Server({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    }, {
      capabilities: {
        tools: {}
      }
    });

    this.indexingService = new IndexingService(config);
    this.searchService = new SearchService(config);
    this.workspaceDir = process.cwd();
    this.workspaceWatcher = new WorkspaceWatcher(
      this.workspaceDir,
      this.indexingService,
      config.supportedExtensions,
      config.excludePatterns
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: TOOL_DEFINITIONS
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'index_directory':
            return await this.handleIndexDirectory(args);
          case 'index_file':
            return await this.handleIndexFile(args);
          case 'search_code':
            return await this.handleSearchCode(args);
          case 'search_functions':
            return await this.handleSearchFunctions(args);
          case 'search_classes':
            return await this.handleSearchClasses(args);
          case 'find_similar':
            return await this.handleFindSimilar(args);
          case 'get_code_context':
            return await this.handleGetCodeContext(args);
          case 'get_indexing_stats':
            return await this.handleGetIndexingStats(args);
          case 'get_search_stats':
            return await this.handleGetSearchStats(args);
          case 'clear_index':
            return await this.handleClearIndex(args);
          case 'remove_file':
            return await this.handleRemoveFile(args);
          case 'reindex_file':
            return await this.handleReindexFile(args);
          case 'create_payload_indexes':
            return await this.handleCreatePayloadIndexes(args);
          case 'codebase_search':
            return await this.handleCodebaseSearch(args);
          case 'get_health_status':
            return await this.handleGetHealthStatus(args);
          case 'get_enhanced_stats':
            return await this.handleGetEnhancedStats(args);
          case 'clear_search_cache':
            return await this.handleClearSearchCache(args);
          case 'invalidate_file_cache':
            return await this.handleInvalidateFileCache(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`
            }
          ]
        };
      }
    });
  }

  private async handleIndexDirectory(args: any) {
    const { directory_path } = args;
    const stats = await this.indexingService.indexDirectory(directory_path);
    
    return {
      content: [
        {
          type: 'text',
          text: `Successfully indexed directory: ${directory_path}\n\n` +
                `Statistics:\n` +
                `- Total files: ${stats.totalFiles}\n` +
                `- Total chunks: ${stats.totalChunks}\n` +
                `- Total size: ${stats.totalSize} bytes\n` +
                `- Average chunk size: ${Math.round(stats.averageChunkSize)} bytes\n` +
                `- Indexing duration: ${stats.indexingDuration}ms\n` +
                `- Errors: ${stats.errors}\n` +
                `- Warnings: ${stats.warnings}\n\n` +
                `Language distribution:\n${Object.entries(stats.languageDistribution)
                  .map(([lang, count]) => `  ${lang}: ${count}`)
                  .join('\n')}\n\n` +
                `Chunk type distribution:\n${Object.entries(stats.chunkTypeDistribution)
                  .map(([type, count]) => `  ${type}: ${count}`)
                  .join('\n')}`
        }
      ]
    };
  }

  private async handleIndexFile(args: any) {
    const { file_path } = args;
    const chunks = await this.indexingService.indexFile(file_path);
    
    return {
      content: [
        {
          type: 'text',
          text: `Successfully indexed file: ${file_path}\n` +
                `Generated ${chunks.length} chunks\n\n` +
                `Chunks:\n${chunks.map(chunk => 
                  `- ${chunk.chunkType} (${chunk.startLine}-${chunk.endLine}): ${chunk.functionName || chunk.className || 'unnamed'}`
                ).join('\n')}`
        }
      ]
    };
  }

  private async handleSearchCode(args: any) {
    const { query, language, chunk_type, file_path, limit, threshold, enable_hybrid, enable_reranking, llm_reranker_timeout_ms } = args;
    
    const searchQuery = this.searchService.buildSearchQuery({
      query: query as string,
      ...(language !== undefined ? { language: language as string } : {}),
      ...(chunk_type !== undefined ? { chunkType: chunk_type as ChunkType } : {}),
      ...(file_path !== undefined ? { filePath: file_path as string } : {}),
      ...(limit !== undefined ? { limit: limit as number } : {}),
      ...(threshold !== undefined ? { threshold: threshold as number } : {}),
      ...(enable_hybrid !== undefined ? { enableHybrid: enable_hybrid as boolean } : {}),
      ...(enable_reranking !== undefined ? { enableReranking: enable_reranking as boolean } : {}),
      ...(llm_reranker_timeout_ms !== undefined ? { llmRerankerTimeoutMs: llm_reranker_timeout_ms as number } : {}),
    });

    const results = await this.searchService.search(searchQuery);
    
    return {
      content: [
        {
          type: 'text',
          text: `Search results for "${query}":\n\n` +
                results.map((result: any, index: number) => 
                  `${index + 1}. [Score: ${result.score.toFixed(3)}] ${result.context}\n` +
                  `\`\`\`${result.chunk.language}\n${result.snippet}\n\`\`\``
                ).join('\n\n')
        }
      ]
    };
  }

  private async handleSearchFunctions(args: any) {
    const { query, language, limit } = args;
    const searchQuery = this.searchService.buildSearchQuery({
      query: query as string,
      ...(language !== undefined ? { language: language as string } : {}),
      ...(limit !== undefined ? { limit: limit as number } : {}),
      chunkType: ChunkType.FUNCTION,
    });
    const results = await this.searchService.searchFunctions(searchQuery);
    
    return {
      content: [
        {
          type: 'text',
          text: `Function search results for "${query}":\n\n` +
                results.map((result: any, index: number) => 
                  `${index + 1}. [Score: ${result.score.toFixed(3)}] ${result.chunk.functionName || 'unnamed'}\n` +
                         `   ${result.context}\n` +
                  `\`\`\`${result.chunk.language}\n${result.snippet}\n\`\`\``
                ).join('\n\n')
        }
      ]
    };
  }

  private async handleSearchClasses(args: any) {
    const { query, language, limit } = args;
    const searchQuery = this.searchService.buildSearchQuery({
      query: query as string,
      ...(language !== undefined ? { language: language as string } : {}),
      ...(limit !== undefined ? { limit: limit as number } : {}),
      chunkType: ChunkType.CLASS,
    });
    const results = await this.searchService.searchClasses(searchQuery);
    
    return {
      content: [
        {
          type: 'text',
          text: `Class search results for "${query}":\n\n` +
                results.map((result: any, index: number) => 
                  `${index + 1}. [Score: ${result.score.toFixed(3)}] ${result.chunk.className || 'unnamed'}\n` +
                         `   ${result.context}\n` +
                  `\`\`\`${result.chunk.language}\n${result.snippet}\n\`\`\``
                ).join('\n\n')
        }
      ]
    };
  }

  private async handleFindSimilar(args: any) {
    const { chunk_id, limit } = args;
    const searchQuery = this.searchService.buildSearchQuery({
      query: chunk_id as string,
      ...(limit !== undefined ? { limit: limit as number } : {}),
    });
    const results = await this.searchService.findSimilar(searchQuery);
    
    return {
      content: [
        {
          type: 'text',
          text: `Similar chunks to "${chunk_id}":\n\n` +
                results.map((result: any, index: number) => 
                  `${index + 1}. [Score: ${result.score.toFixed(3)}] ${result.context}\n` +
                  `\`\`\`${result.chunk.language}\n${result.snippet}\n\`\`\``
                ).join('\n\n')
        }
      ]
    };
  }

  private async handleGetCodeContext(args: any) {
    const { chunk_id, context_lines } = args;
    const codeContextResult = await this.searchService.getCodeContext(
      chunk_id as string,
      context_lines as number | undefined
    );
    if (!codeContextResult) {
      return {
        content: [{
            type: 'text',
            text: `Chunk not found: ${chunk_id}`
        }],
        isError: true
      };
    }
    return {
      content: [{
          type: 'text',
          text: `Code context for chunk "${chunk_id}":\n\n` +
              `File: ${codeContextResult.chunk.filePath}\n` +
              `Lines: ${codeContextResult.chunk.startLine}-${codeContextResult.chunk.endLine}\n` +
              `Type: ${codeContextResult.chunk.chunkType}\n\n` +
              `\`\`\`${codeContextResult.chunk.language}\n${codeContextResult.context}\n\`\`\``
      }]
    };
  }

  private async handleGetIndexingStats(_args: any) {
    const indexingStats = this.indexingService.getStats();
    return {
      content: [{
          type: 'text',
          text: `Indexing Statistics:\n\n` +
              `Total files: ${indexingStats.totalFiles}\n` +
              `Total chunks: ${indexingStats.totalChunks}\n` +
              `Total size: ${indexingStats.totalSize} bytes\n` +
              `Average chunk size: ${Math.round(indexingStats.averageChunkSize)} bytes\n` +
              `Last indexed: ${indexingStats.lastIndexed.toISOString()}\n` +
              `Indexing duration: ${indexingStats.indexingDuration}ms\n` +
              `Errors: ${indexingStats.errors}\n` +
              `Warnings: ${indexingStats.warnings}\n` +
              `Largest file: ${indexingStats.largestFile}\n\n` +
              `Language distribution:\n${Object.entries(indexingStats.languageDistribution)
                  .map(([lang, count]) => `  ${lang}: ${count}`)
                  .join('\n')}\n\n` +
              `Chunk type distribution:\n${Object.entries(indexingStats.chunkTypeDistribution)
                  .map(([type, count]) => `  ${type}: ${count}`)
                  .join('\n')}`
      }]
    };
  }

  private async handleGetSearchStats(_args: any) {
    const searchStats = await this.searchService.getSearchStats();
    const languageStats = Object.entries(searchStats.topLanguages)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([lang, count]) => `  • ${lang}: ${count} chunks`)
      .join('\n');
    const chunkTypeStats = Object.entries(searchStats.topChunkTypes)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([type, count]) => `  • ${type}: ${count} chunks`)
      .join('\n');
    return {
      content: [{
          type: 'text',
        text: `Search Statistics:\n\n` +
              `Total queries: ${searchStats.totalQueries}\n` +
              `Average latency: ${searchStats.averageLatency.toFixed(2)}ms\n` +
              `Cache hit rate: ${searchStats.cacheHitRate.toFixed(2)}%\n` +
              `Hybrid search usage: ${searchStats.hybridSearchUsage.toFixed(2)}%\n` +
              `LLM reranker usage: ${searchStats.llmRerankerUsage.toFixed(2)}%\n` +
              `Error rate: ${searchStats.errorRate.toFixed(2)}%\n` +
              `Last query: ${searchStats.lastQuery?.toISOString() || 'N/A'}\n\n` +
              `Top Languages:\n${languageStats}\n\n` +
              `Top Chunk Types:\n${chunkTypeStats}`
      }]
    };
  }

  private async handleClearIndex(_args: any) {
    await this.indexingService.clearIndex();
    return {
      content: [{
          type: 'text',
        text: 'Successfully cleared index'
      }]
    };
  }

  private async handleRemoveFile(args: any) {
    await this.indexingService.removeFile(args.file_path as string);
    return {
      content: [{
          type: 'text',
        text: `Successfully removed file: ${args.file_path}`
      }]
    };
  }

  private async handleReindexFile(args: any) {
    const reindexedChunks = await this.indexingService.reindexFile(args.file_path as string);
    return {
      content: [{
          type: 'text',
        text: `Successfully re-indexed file: ${args.file_path}\nGenerated ${reindexedChunks.length} chunks`
      }]
    };
  }

  private async handleCreatePayloadIndexes(_args: any) {
    await (this.searchService as any).qdrantClient.ensurePayloadIndexes(_args.force as boolean || false);
    return {
      content: [{
          type: 'text',
        text: 'Successfully created payload indexes'
      }]
    };
  }

  private async handleCodebaseSearch(args: any) {
    const { query, language, chunk_type, file_path, limit, max_tokens, enable_hybrid, enable_reranking, prefer_implementation } = args;
    
    const searchQuery = this.searchService.buildSearchQuery({
      query: query as string,
      ...(language !== undefined ? { language: language as string } : {}),
      ...(chunk_type !== undefined ? { chunkType: chunk_type as ChunkType } : {}),
      ...(file_path !== undefined ? { filePath: file_path as string } : {}),
      ...(limit !== undefined ? { limit: limit as number } : {}),
      ...(enable_hybrid !== undefined ? { enableHybrid: enable_hybrid as boolean } : {}),
      ...(enable_reranking !== undefined ? { enableReranking: enable_reranking as boolean } : {}),
      ...(prefer_implementation !== undefined ? { preferImplementation: prefer_implementation as boolean } : { preferImplementation: true }), // Default to true
    });
    
    const { references, truncated, summary, metadata } = await this.searchService.searchForCodeReferences(searchQuery, max_tokens as number | undefined);
    
    return {
      content: [{
          type: 'text',
        text: `Codebase search results for "${query}":\n\n` +
              (summary ? `Summary: ${summary}\n\n` : '') +
              references.map((ref: any, index: number) => {
                const score = ref.score ? ` (Score: ${(ref.score * 100).toFixed(2)}%)` : '';
                const typeIcon = ref.chunkType ? ` ${this.getChunkTypeIcon(ref.chunkType)}` : '';
                const filePath = ref.path;
                const startLine = ref.lines[0];
                const endLine = ref.lines[1];
                const navLink = `cursor://file?filePath=${encodeURIComponent(filePath)}&startLine=${startLine}&endLine=${endLine}`;
                return `${index + 1}. **${ref.chunkType || 'Code'}${score}** ${typeIcon} - [${filePath}:${startLine}-${endLine}](${navLink})\n` +
                       `\`\`\`${ref.language || 'text'}\n${ref.snippet}\n\`\`\``;
              }).join('\n\n') +
              (truncated ? '\n\n(Results truncated to fit context window)' : '') +
              `\n\n_Search took ${metadata.searchTime.toFixed(2)}ms. Total results: ${metadata.totalResults}. Cache Hit: ${metadata.cacheHit ? 'Yes' : 'No'}. Hybrid Search Used: ${metadata.hybridUsed ? 'Yes' : 'No'}. Reranked: ${metadata.reranked ? 'Yes' : 'No'}_`
      }]
    };
  }

  private async handleGetHealthStatus(_args: any) {
    const healthStatus = await this.searchService.getHealthStatus();
    const serviceStatuses = Object.entries(healthStatus.services)
      .map(([name, svc]) => {
        const latency = svc.latency !== undefined ? ` (Latency: ${svc.latency.toFixed(2)}ms)` : '';
        const errorRate = svc.errorRate !== undefined ? ` (Error Rate: ${svc.errorRate.toFixed(2)}%)` : '';
        const message = svc.message ? `: ${svc.message}` : '';
        return `- ${name}: ${svc.status}${latency}${errorRate}${message}`;
      }).join('\n');
    const metrics = Object.entries(healthStatus.metrics)
      .map(([name, value]) => `- ${name}: ${value.toFixed(2)}`)
      .join('\n');
    return {
      content: [{
          type: 'text',
        text: `Health Status: ${healthStatus.status}\n` +
              `Timestamp: ${healthStatus.timestamp.toISOString()}\n` +
              `Version: ${healthStatus.version}\n` +
              `MCP Schema Version: ${healthStatus.mcpSchemaVersion}\n\n` +
              `Services:\n${serviceStatuses}\n\n` +
              `Metrics:\n${metrics}`
      }]
    };
  }

  private async handleGetEnhancedStats(_args: any) {
    const enhancedStats = this.searchService.getEnhancedSearchStats();
    return {
      content: [{
          type: 'text',
          text: `📊 **Enhanced Search Statistics**\n\n` +
                `**Search Performance:**\n` +
                `- Total queries: ${enhancedStats.totalQueries}\n` +
                `- Cache hit rate: ${(enhancedStats.cacheHitRate * 100).toFixed(1)}%\n` +
                `- Hybrid search usage: ${enhancedStats.hybridSearchUsage} queries\n` +
                `- LLM re-ranking usage: ${enhancedStats.llmRerankerUsage} queries\n` +
                `- Last query: ${enhancedStats.lastQuery.toISOString()}\n\n` +
              ``
      }]
    };
  }

  private async handleClearSearchCache(_args: any) {
    this.searchService.clearCaches();
    return {
      content: [{
          type: 'text',
        text: 'Successfully cleared search cache'
      }]
    };
  }

  private async handleInvalidateFileCache(args: any) {
    this.searchService.invalidateFileCache(args.file_path as string);
    return {
      content: [{
          type: 'text',
        text: `Successfully invalidated cache for file: ${args.file_path}`
      }]
    };
  }

  private getChunkTypeIcon(chunkType: ChunkType): string {
    switch (chunkType) {
      case ChunkType.FUNCTION:
        return '🚀';
      case ChunkType.CLASS:
        return '🧠';
      case ChunkType.MODULE:
        return '📦';
      case ChunkType.INTERFACE:
        return '👔';
      case ChunkType.ENUM:
        return '🎨';
      case ChunkType.TYPE:
        return '👤';
      case ChunkType.VARIABLE:
        return '👾';
      case ChunkType.IMPORT:
        return '🔗';
      case ChunkType.COMMENT:
        return '💬';
      case ChunkType.METHOD:
        return '⚡';
      case ChunkType.PROPERTY:
        return '⚙️';
      case ChunkType.CONSTRUCTOR:
        return '🏗️';
      case ChunkType.NAMESPACE:
        return '🏛️';
      case ChunkType.DECORATOR:
        return '✨';
      case ChunkType.SECTION:
        return '📚';
      case ChunkType.CODE_BLOCK:
        return '📃';
      case ChunkType.PARAGRAPH:
        return '✍️';
      case ChunkType.LIST:
        return '📜';
      case ChunkType.TABLE:
        return '📊';
      case ChunkType.BLOCKQUOTE:
        return '🗣️';
      case ChunkType.GENERIC:
        return '📄';
      default:
        return '❓';
    }
  }

  async run(): Promise<void> {
    // Initialize services
    await this.indexingService.initialize();
    await this.searchService.initialize();
    // Automatically index workspace if no index exists yet
    const existingChunks = await this.indexingService.countIndexedChunks();
    if (existingChunks === 0) {
      console.log('No existing index detected – indexing workspace for the first time...');
      await this.indexingService.indexDirectory(this.workspaceDir);
    }

    // Start watching workspace for real-time updates
    this.workspaceWatcher.start();
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error('Codebase Indexing MCP Server running on stdio');
  }
}



// Main entry point
async function main() {
  try {
    const config = loadConfig();
    validateConfig(config);
    printConfigSummary(config);
    
    const server = new CodebaseIndexingServer(config);
    await server.run();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// ES module equivalent of require.main === module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 