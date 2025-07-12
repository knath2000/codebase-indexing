#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Config, ChunkType } from './types.js';
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
    name: 'search_codebase',
    description: 'Enhanced codebase search with Cursor-style code references, hybrid retrieval, and LLM re-ranking',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for codebase'
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
          const codeResults = await searchService.search({
            query: args.query as string,
            language: args.language as string,
            chunkType: args.chunk_type ? args.chunk_type as ChunkType : undefined,
            filePath: args.file_path as string,
            limit: args.limit as number,
            threshold: args.threshold as number
          });
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
          const functionResults = await searchService.searchFunctions(args.query as string, args.language as string, args.limit as number);
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
          const classResults = await searchService.searchClasses(args.query as string, args.language as string, args.limit as number);
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
          const similarResults = await searchService.findSimilar(args.chunk_id as string, args.limit as number);
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
          const contextResult = await searchService.getCodeContext(args.chunk_id as string, args.context_lines as number || 5);
          if (!contextResult) {
            return {
              content: [{
                type: 'text',
                text: `Chunk "${args.chunk_id}" not found`
              }]
            };
          }
          return {
            content: [{
              type: 'text',
              text: `Code context for chunk "${args.chunk_id}":\n\n` +
                    `File: ${contextResult.chunk.filePath}\n` +
                    `Lines: ${contextResult.chunk.startLine}-${contextResult.chunk.endLine}\n` +
                    `Type: ${contextResult.chunk.chunkType}\n\n` +
                    `\`\`\`${contextResult.chunk.language}\n${contextResult.context}\n\`\`\``
            }]
          };
        case 'get_indexing_stats':
          const stats = indexingService.getStats();
          return {
            content: [{
              type: 'text',
              text: `Indexing Statistics:\n\n` +
                    `Total files: ${stats.totalFiles}\n` +
                    `Total chunks: ${stats.totalChunks}\n` +
                    `Total size: ${stats.totalSize} bytes\n`
            }]
          };
        case 'get_search_stats':
          const searchStats = await searchService.getSearchStats();
          return {
            content: [{
              type: 'text',
              text: `Search Statistics:\n\n` +
                    `Total indexed chunks: ${searchStats.totalChunks}\n`
            }]
          };
        case 'clear_index':
          await indexingService.clearIndex();
          return {
            content: [{
              type: 'text',
              text: 'Successfully cleared the search index'
            }]
          };
        case 'remove_file':
          await indexingService.removeFile(args.file_path as string);
          return {
            content: [{
              type: 'text',
              text: `Successfully removed file "${args.file_path}" from the search index`
            }]
          };
        case 'reindex_file':
          const reindexChunks = await indexingService.indexFile(args.file_path as string);
          return {
            content: [{
              type: 'text',
              text: `Successfully re-indexed file "${args.file_path}"\nGenerated ${reindexChunks.length} chunks`
            }]
          };
        case 'create_payload_indexes':
          // Access the Qdrant client through the search service
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
        case 'search_codebase':
          const codebaseResult = await searchService.searchForCodeReferences({
            query: args.query as string,
            language: args.language as string,
            chunkType: args.chunk_type ? args.chunk_type as ChunkType : undefined,
            filePath: args.file_path as string,
            limit: args.limit as number,
            enableHybrid: args.enable_hybrid as boolean,
            enableReranking: args.enable_reranking as boolean
          }, args.max_tokens as number);
          
          const referencesText = codebaseResult.references.map((ref, index) => 
            `${index + 1}. **${ref.path}** (lines ${ref.lines[0]}-${ref.lines[1]}) [${ref.chunkType}]${ref.score ? ` - Score: ${ref.score.toFixed(3)}` : ''}\n` +
            `\`\`\`${ref.language || 'text'}\n${ref.snippet}\n\`\`\``
          ).join('\n\n');
          
          return {
            content: [{
              type: 'text',
              text: `🔍 **Enhanced Codebase Search Results** for "${args.query}"\n\n` +
                    `📊 **Search Metadata:**\n` +
                    `- Total results: ${codebaseResult.metadata.totalResults}\n` +
                    `- Search time: ${codebaseResult.metadata.searchTime}ms\n` +
                    `- Cache hit: ${codebaseResult.metadata.cacheHit ? '✅' : '❌'}\n` +
                    `- Hybrid search: ${codebaseResult.metadata.hybridUsed ? '✅' : '❌'}\n` +
                    `- LLM re-ranked: ${codebaseResult.metadata.reranked ? '✅' : '❌'}\n` +
                    `- Truncated: ${codebaseResult.truncated ? '⚠️ Yes' : '✅ No'}\n` +
                    (codebaseResult.summary ? `- Summary: ${codebaseResult.summary}\n` : '') +
                    `\n📝 **Code References:**\n\n${referencesText}`
            }]
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
          const serviceStatus = searchService.getServiceStatus();
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
                    `**Service Status:**\n` +
                    `- LLM Re-ranker: ${serviceStatus.llmReranker.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                    `- Hybrid Search: ${serviceStatus.hybridSearch.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                    `- Search Cache: ${serviceStatus.searchCache.enabled ? '✅ Enabled' : '❌ Disabled'}`
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
          case 'search_codebase':
            return await this.handleSearchCodebase(args);
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
    const { query, language, chunk_type, file_path, limit, threshold } = args;
    
    const searchQuery = {
      query,
      language,
      chunkType: chunk_type,
      filePath: file_path,
      limit: limit || 10,
      threshold: threshold || 0.7
    };

    const results = await this.searchService.search(searchQuery);
    
    return {
      content: [
        {
          type: 'text',
          text: `Search results for "${query}":\n\n` +
                results.map((result, index) => 
                  `${index + 1}. [Score: ${result.score.toFixed(3)}] ${result.context}\n` +
                  `\`\`\`${result.chunk.language}\n${result.snippet}\n\`\`\``
                ).join('\n\n')
        }
      ]
    };
  }

  private async handleSearchFunctions(args: any) {
    const { query, language, limit } = args;
    const results = await this.searchService.searchFunctions(query, language, limit);
    
    return {
      content: [
        {
          type: 'text',
          text: `Function search results for "${query}":\n\n` +
                results.map((result, index) => 
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
    const results = await this.searchService.searchClasses(query, language, limit);
    
    return {
      content: [
        {
          type: 'text',
          text: `Class search results for "${query}":\n\n` +
                results.map((result, index) => 
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
    const results = await this.searchService.findSimilar(chunk_id, limit);
    
    return {
      content: [
        {
          type: 'text',
          text: `Similar chunks to "${chunk_id}":\n\n` +
                results.map((result, index) => 
                  `${index + 1}. [Score: ${result.score.toFixed(3)}] ${result.context}\n` +
                  `\`\`\`${result.chunk.language}\n${result.snippet}\n\`\`\``
                ).join('\n\n')
        }
      ]
    };
  }

  private async handleGetCodeContext(args: any) {
    const { chunk_id, context_lines } = args;
    const result = await this.searchService.getCodeContext(chunk_id, context_lines);
    
    if (!result) {
      return {
        content: [
          {
            type: 'text',
            text: `Chunk not found: ${chunk_id}`
          }
        ]
      };
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `Code context for chunk "${chunk_id}":\n\n` +
                `File: ${result.chunk.filePath}\n` +
                `Lines: ${result.chunk.startLine}-${result.chunk.endLine}\n` +
                `Type: ${result.chunk.chunkType}\n\n` +
                `\`\`\`${result.chunk.language}\n${result.context}\n\`\`\``
        }
      ]
    };
  }

  private async handleGetIndexingStats(_args: any) {
    const stats = this.indexingService.getStats();
    
    return {
      content: [
        {
          type: 'text',
          text: `Indexing Statistics:\n\n` +
                `Total files: ${stats.totalFiles}\n` +
                `Total chunks: ${stats.totalChunks}\n` +
                `Total size: ${stats.totalSize} bytes\n` +
                `Average chunk size: ${Math.round(stats.averageChunkSize)} bytes\n` +
                `Last indexed: ${stats.lastIndexed.toISOString()}\n` +
                `Indexing duration: ${stats.indexingDuration}ms\n` +
                `Errors: ${stats.errors}\n` +
                `Warnings: ${stats.warnings}\n` +
                `Largest file: ${stats.largestFile}\n\n` +
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

  private async handleGetSearchStats(_args: any) {
    const stats = await this.searchService.getSearchStats();
    
    // Format language distribution
    const languageStats = Object.entries(stats.languageDistribution)
      .sort(([, a], [, b]) => b - a)
      .map(([lang, count]) => `  • ${lang}: ${count} chunks`)
      .join('\n');
    
    // Format chunk type distribution  
    const chunkTypeStats = Object.entries(stats.chunkTypeDistribution)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => `  • ${type}: ${count} chunks`)
      .join('\n');
    
    return {
      content: [
        {
          type: 'text',
          text: `🔍 **Codebase Search Statistics**\n\n` +
                `📊 **Overview:**\n` +
                `• Total indexed chunks: **${stats.totalChunks.toLocaleString()}**\n` +
                `• Embedding model: **${stats.embeddingModel}** (${stats.embeddingDimension}D)\n` +
                `• Collection status: **${stats.collectionStatus}**\n\n` +
                
                `💻 **Language Distribution:**\n` +
                (languageStats || '  • No language data available') + '\n\n' +
                
                `🏷️ **Chunk Type Distribution:**\n` +
                (chunkTypeStats || '  • No chunk type data available') + '\n\n' +
                
                `✨ **Search Capabilities:**\n` +
                `• Semantic code search with **${stats.embeddingModel}**\n` +
                `• Context-aware suggestions\n` +
                `• Function, class, and module search\n` +
                `• File-specific and language-specific filtering\n` +
                `• Real-time codebase understanding`
        }
      ]
    };
  }

  private async handleClearIndex(_args: any) {
    await this.indexingService.clearIndex();
    
    return {
      content: [
        {
          type: 'text',
          text: 'Successfully cleared the search index'
        }
      ]
    };
  }

  private async handleRemoveFile(args: any) {
    const { file_path } = args;
    await this.indexingService.removeFile(file_path);
    
    return {
      content: [
        {
          type: 'text',
          text: `Successfully removed file from index: ${file_path}`
        }
      ]
    };
  }

  private async handleReindexFile(args: any) {
    const { file_path } = args;
    const chunks = await this.indexingService.reindexFile(file_path);
    
    return {
      content: [
        {
          type: 'text',
          text: `Successfully re-indexed file: ${file_path}\n` +
                `Generated ${chunks.length} chunks`
        }
      ]
    };
  }

  private async handleCreatePayloadIndexes(_args: any) {
    // Access the Qdrant client through the search service
    await (this.searchService as any).qdrantClient.ensurePayloadIndexes();
    
    return {
      content: [
        {
          type: 'text',
          text: '🎉 Successfully created payload indexes for filtering!\n\n' +
                '✅ chunkType index - for filtering by code elements (function, class, interface, etc.)\n' +
                '✅ language index - for filtering by programming language (typescript, javascript, etc.)\n' +
                '✅ filePath index - for file-specific searches\n\n' +
                '🔍 Your collection is now ready for @codebase-style filtered searches!'
        }
      ]
    };
  }

  private async handleSearchCodebase(args: any) {
    const codebaseResult = await this.searchService.searchForCodeReferences({
      query: args.query as string,
      language: args.language as string,
      chunkType: args.chunk_type ? args.chunk_type as ChunkType : undefined,
      filePath: args.file_path as string,
      limit: args.limit as number,
      enableHybrid: args.enable_hybrid as boolean,
      enableReranking: args.enable_reranking as boolean
    }, args.max_tokens as number);
    
    const referencesText = codebaseResult.references.map((ref, index) => 
      `${index + 1}. **${ref.path}** (lines ${ref.lines[0]}-${ref.lines[1]}) [${ref.chunkType}]${ref.score ? ` - Score: ${ref.score.toFixed(3)}` : ''}\n` +
      `\`\`\`${ref.language || 'text'}\n${ref.snippet}\n\`\`\``
    ).join('\n\n');
    
    return {
      content: [
        {
          type: 'text',
          text: `🔍 **Enhanced Codebase Search Results** for "${args.query}"\n\n` +
                `📊 **Search Metadata:**\n` +
                `- Total results: ${codebaseResult.metadata.totalResults}\n` +
                `- Search time: ${codebaseResult.metadata.searchTime}ms\n` +
                `- Cache hit: ${codebaseResult.metadata.cacheHit ? '✅' : '❌'}\n` +
                `- Hybrid search: ${codebaseResult.metadata.hybridUsed ? '✅' : '❌'}\n` +
                `- LLM re-ranked: ${codebaseResult.metadata.reranked ? '✅' : '❌'}\n` +
                `- Truncated: ${codebaseResult.truncated ? '⚠️ Yes' : '✅ No'}\n` +
                (codebaseResult.summary ? `- Summary: ${codebaseResult.summary}\n` : '') +
                `\n📝 **Code References:**\n\n${referencesText}`
        }
      ]
    };
  }

  private async handleGetHealthStatus(_args: any) {
    // TODO: Implement health monitoring service
    return {
      content: [
        {
          type: 'text',
          text: '🏥 **System Health Status**\n\n' +
                '✅ Search Service: Operational\n' +
                '✅ Indexing Service: Operational\n' +
                '⚠️ Health monitoring service not yet implemented'
        }
      ]
    };
  }

  private async handleGetEnhancedStats(_args: any) {
    const enhancedStats = this.searchService.getEnhancedSearchStats();
    const serviceStatus = this.searchService.getServiceStatus();
    
    return {
      content: [
        {
          type: 'text',
          text: `📊 **Enhanced Search Statistics**\n\n` +
                `**Search Performance:**\n` +
                `- Total queries: ${enhancedStats.totalQueries}\n` +
                `- Cache hit rate: ${(enhancedStats.cacheHitRate * 100).toFixed(1)}%\n` +
                `- Hybrid search usage: ${enhancedStats.hybridSearchUsage} queries\n` +
                `- LLM re-ranking usage: ${enhancedStats.llmRerankerUsage} queries\n` +
                `- Last query: ${enhancedStats.lastQuery.toISOString()}\n\n` +
                `**Service Status:**\n` +
                `- LLM Re-ranker: ${serviceStatus.llmReranker.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                `- Hybrid Search: ${serviceStatus.hybridSearch.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
                `- Search Cache: ${serviceStatus.searchCache.enabled ? '✅ Enabled' : '❌ Disabled'}`
        }
      ]
    };
  }

  private async handleClearSearchCache(_args: any) {
    this.searchService.clearCaches();
    
    return {
      content: [
        {
          type: 'text',
          text: '🧹 Successfully cleared search cache and reset statistics'
        }
      ]
    };
  }

  private async handleInvalidateFileCache(args: any) {
    this.searchService.invalidateFileCache(args.file_path as string);
    
    return {
      content: [
        {
          type: 'text',
          text: `🔄 Successfully invalidated cache entries for file: ${args.file_path}`
        }
      ]
    };
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