#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Config, ChunkType, SearchResult } from './types.js';
import { IndexingService } from './services/indexing-service.js';
import { SearchService } from './services/search-service.js';
import { HealthMonitorService } from './services/health-monitor.js';
import { VoyageClient } from './clients/voyage-client.js';
import { QdrantVectorClient } from './clients/qdrant-client.js';
import { loadConfig, validateConfig, printConfigSummary } from './config.js';
import { WorkspaceWatcher } from './services/workspace-watcher.js';
import { WorkspaceManager } from './services/workspace-manager.js';
import { createModuleLogger } from './logging/logger.js'

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
    name: 'get_workspace_info',
    description: 'Get information about the current workspace and detected project structure',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'list_workspaces',
    description: 'List all detected workspaces and their metadata',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'switch_workspace',
    description: 'Switch to a different workspace by ID',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: {
          type: 'string',
          description: 'The ID of the workspace to switch to'
        }
      },
      required: ['workspace_id']
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
export function setupMcpTools(
  server: Server,
  indexingService: IndexingService,
  searchService: SearchService,
  healthMonitor?: HealthMonitorService
): void {
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
        case 'get_health_status': {
          try {
            const health = healthMonitor
              ? await healthMonitor.getHealthStatus()
              : await searchService.getHealthStatus();
            const serviceStatuses = Object.entries(health.services)
              .map(([name, svc]) => {
                const latency = svc.latency !== undefined ? ` (Latency: ${svc.latency.toFixed(2)}ms)` : '';
                const errorRate = svc.errorRate !== undefined ? ` (Error Rate: ${svc.errorRate.toFixed(2)}%)` : '';
                const message = svc.message ? `: ${svc.message}` : '';
                return `- ${name}: ${svc.status}${latency}${errorRate}${message}`;
              }).join('\n');
            const metrics = Object.entries(health.metrics)
              .map(([name, value]) => `- ${name}: ${value.toFixed(2)}`)
              .join('\n');
          return {
            content: [{
              type: 'text',
                text: `Health Status: ${health.status}\n` +
                      `Timestamp: ${health.timestamp.toISOString()}\n` +
                      `Version: ${health.version}\n` +
                      `MCP Schema Version: ${health.mcpSchemaVersion}\n\n` +
                      `Services:\n${serviceStatuses}\n\n` +
                      `Metrics:\n${metrics}`
              }]
            };
          } catch (err) {
            return {
              content: [{ type: 'text', text: `Error retrieving health status: ${err instanceof Error ? err.message : String(err)}` }],
              isError: true
            }
          }
        }
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
        case 'get_workspace_info':
          // Access the workspace manager from the service (if available)
          const currentWorkspace = (indexingService as any).currentWorkspace || (searchService as any).currentWorkspace;
          if (!currentWorkspace) {
            return {
              content: [{
                type: 'text',
                text: '❌ No workspace detected. Please ensure you are running the server from a valid workspace directory.'
              }],
              isError: true
            };
          }
          
          return {
            content: [{
              type: 'text',
              text: `🏗️ **Current Workspace Information**\n\n` +
                    `**Name:** ${currentWorkspace.name}\n` +
                    `**Type:** ${currentWorkspace.type}\n` +
                    `**Root Path:** ${currentWorkspace.rootPath}\n` +
                    `**Collection:** ${currentWorkspace.collectionName}\n` +
                    `**Folders:** ${currentWorkspace.folders.length}\n` +
                    currentWorkspace.folders.map((folder: string, i: number) => `  ${i + 1}. ${folder}`).join('\n') + '\n\n' +
                    (currentWorkspace.gitRemote ? `**Git Remote:** ${currentWorkspace.gitRemote}\n` : '') +
                    (currentWorkspace.packageName ? `**Package Name:** ${currentWorkspace.packageName}\n` : '') +
                    `**Last Accessed:** ${currentWorkspace.lastAccessed.toISOString()}\n` +
                    `**Workspace ID:** ${currentWorkspace.id}`
            }]
          };
        
        case 'list_workspaces':
          // Get workspace manager from services
          const workspaceManager = (indexingService as any).workspaceManager || (searchService as any).workspaceManager;
          if (!workspaceManager) {
            return {
              content: [{
                type: 'text',
                text: '❌ Workspace manager not available.'
              }],
              isError: true
            };
          }
          
          const allWorkspaces = workspaceManager.getAllWorkspaces();
          const currentWorkspaceId = workspaceManager.getCurrentWorkspace()?.id;
          
          if (allWorkspaces.length === 0) {
            return {
              content: [{
                type: 'text',
                text: '📂 No workspaces have been detected yet.'
              }]
            };
          }
          
          return {
            content: [{
              type: 'text',
              text: `📂 **Detected Workspaces**\n\n` +
                    allWorkspaces.map((workspace: any, index: number) => {
                      const current = workspace.id === currentWorkspaceId ? ' ← **Current**' : '';
                      const lastAccessed = workspace.lastAccessed.toLocaleDateString();
                      return `${index + 1}. **${workspace.name}** (${workspace.type})${current}\n` +
                             `   - Path: ${workspace.rootPath}\n` +
                             `   - Collection: ${workspace.collectionName}\n` +
                             `   - Last Accessed: ${lastAccessed}\n` +
                             `   - ID: ${workspace.id.substring(0, 12)}...`;
                    }).join('\n\n')
            }]
          };
        
        case 'switch_workspace':
          const targetWorkspaceId = args.workspace_id as string;
          const wsManager = (indexingService as any).workspaceManager || (searchService as any).workspaceManager;
          
          if (!wsManager) {
            return {
              content: [{
                type: 'text',
                text: '❌ Workspace manager not available.'
              }],
              isError: true
            };
          }
          
          const switchedWorkspace = await wsManager.switchToWorkspace(targetWorkspaceId);
          if (!switchedWorkspace) {
            return {
              content: [{
                type: 'text',
                text: `❌ Workspace not found: ${targetWorkspaceId}`
              }],
              isError: true
            };
          }
          
          // Update services to use the new workspace
          if (indexingService && (indexingService as any).updateQdrantClientForWorkspace) {
            (indexingService as any).updateQdrantClientForWorkspace(switchedWorkspace);
          }
          if (searchService && (searchService as any).updateQdrantClientForWorkspace) {
            (searchService as any).updateQdrantClientForWorkspace(switchedWorkspace);
          }
          
          return {
            content: [{
              type: 'text',
              text: `🔄 **Successfully switched to workspace:** ${switchedWorkspace.name}\n\n` +
                    `**Type:** ${switchedWorkspace.type}\n` +
                    `**Collection:** ${switchedWorkspace.collectionName}\n` +
                    `**Path:** ${switchedWorkspace.rootPath}\n\n` +
                    `🔧 All services have been updated to use the new workspace collection.`
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
  private workspaceManager: WorkspaceManager;
  private workspaceDir: string;
  // Note: used for side effects via start(); referenced via this.healthMonitor in run()
  private healthMonitor?: HealthMonitorService;
  private readonly log = createModuleLogger('stdio-server')

  constructor(config: Config) {
    this.server = new Server({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    }, {
      capabilities: {
        tools: {}
      }
    });

    // Create shared workspace manager
    this.workspaceManager = new WorkspaceManager();

    this.indexingService = new IndexingService(config, this.workspaceManager);
    this.searchService = new SearchService(config, this.workspaceManager);
    // Create health monitor (started in run())
    const voyageClient = new VoyageClient(config.voyageApiKey)
    const qdrantClient = new QdrantVectorClient(
      config.qdrantUrl,
      config.qdrantApiKey,
      config.collectionName,
      voyageClient.getEmbeddingDimension(config.embeddingModel)
    )
    this.healthMonitor = new HealthMonitorService(config, voyageClient, qdrantClient) as any
    this.workspaceDir = process.cwd();
    this.workspaceWatcher = new WorkspaceWatcher(
      this.workspaceDir,
      this.indexingService,
      config.supportedExtensions,
      config.excludePatterns
    );

    // Register MCP tools on stdio server using shared setup
    setupMcpTools(this.server, this.indexingService, this.searchService, this.healthMonitor);
  }


  async run(): Promise<void> {
    this.log.info('Starting Codebase Indexing MCP Server (stdio)')
    
    // Initialize services with workspace detection
    this.log.debug('Initializing indexing and search services')
    await this.indexingService.initialize();
    await this.searchService.initialize();
    this.healthMonitor?.start?.()
    
    // Show workspace information after initialization
    const currentWorkspace = this.workspaceManager.getCurrentWorkspace();
    if (currentWorkspace) {
      this.log.info({
        workspace: currentWorkspace.name,
        type: currentWorkspace.type,
        collection: currentWorkspace.collectionName,
        id: currentWorkspace.id.substring(0, 16),
        folders: currentWorkspace.folders.length,
        gitRemote: currentWorkspace.gitRemote,
        packageName: currentWorkspace.packageName
      }, 'Workspace initialized')
    }
    
    // Auto-index workspace if no index exists
    await this.ensureWorkspaceIndexed();
    
    // Start watching workspace for real-time updates
    this.log.info('Starting workspace file watcher for real-time updates')
    this.workspaceWatcher.start();
    
    // Connect to stdio transport
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.log.info({ workspaceDir: this.workspaceDir, autoIndexing: true, fileWatching: true }, 'Codebase Indexing MCP Server running on stdio')
  }

  /**
   * Ensure the current workspace is indexed, automatically indexing if needed
   */
  private async ensureWorkspaceIndexed(): Promise<void> {
    try {
      this.log.debug('Checking if workspace is already indexed')
      const existingChunks = await this.indexingService.countIndexedChunks();
      
      if (existingChunks === 0) {
        this.log.info({ workspaceDir: this.workspaceDir }, 'No existing index detected – indexing workspace')
        
        const startTime = Date.now();
        await this.indexingService.indexDirectory(this.workspaceDir);
        const duration = Date.now() - startTime;
        
        const finalCount = await this.indexingService.countIndexedChunks();
        this.log.info({ ms: duration, chunks: finalCount }, 'Workspace indexing completed')
      } else {
        this.log.info({ chunks: existingChunks }, 'Found existing index; watcher will perform incremental updates')
      }
    } catch (error) {
      this.log.warn({ err: error }, 'Error during workspace indexing; server will continue')
      // Don't throw - allow server to start even if auto-indexing fails
    }
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
    const log = createModuleLogger('stdio-server')
    log.error({ err: error }, 'Failed to start server')
    process.exit(1);
  }
}

// ES module equivalent of require.main === module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 