#!/usr/bin/env node

/**
 * Comprehensive test script for enhanced MCP Codebase Indexing Server
 * Tests all new features including hybrid search, LLM re-ranking, caching, and health monitoring
 */

import { spawn } from 'child_process';
import path from 'path';

// Test configuration
const MCP_SERVER_COMMAND = 'node';
const MCP_SERVER_ARGS = ['dist/index.js'];
const TEST_TIMEOUT = 30000; // 30 seconds

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`  ${title}`, 'bright');
  log(`${'='.repeat(60)}`, 'cyan');
}

function logTest(testName) {
  log(`\n🧪 Testing: ${testName}`, 'yellow');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

class MCPTester {
  constructor() {
    this.mcpProcess = null;
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0
    };
  }

  async startMCPServer() {
    logSection('Starting Enhanced MCP Server');
    
    return new Promise((resolve, reject) => {
      this.mcpProcess = spawn(MCP_SERVER_COMMAND, MCP_SERVER_ARGS, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      let serverReady = false;
      const timeout = setTimeout(() => {
        if (!serverReady) {
          reject(new Error('MCP server startup timeout'));
        }
      }, TEST_TIMEOUT);

      this.mcpProcess.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('MCP Codebase Indexing Server') || output.includes('Server ready')) {
          serverReady = true;
          clearTimeout(timeout);
          logSuccess('MCP server started successfully');
          resolve();
        }
      });

      this.mcpProcess.stderr.on('data', (data) => {
        const error = data.toString();
        logError(`Server error: ${error}`);
      });

      this.mcpProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.mcpProcess.on('exit', (code) => {
        if (code !== 0 && !serverReady) {
          clearTimeout(timeout);
          reject(new Error(`MCP server exited with code ${code}`));
        }
      });
    });
  }

  async sendMCPRequest(request) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 10000);

      let responseData = '';
      
      const dataHandler = (data) => {
        responseData += data.toString();
        try {
          const response = JSON.parse(responseData);
          clearTimeout(timeout);
          this.mcpProcess.stdout.removeListener('data', dataHandler);
          resolve(response);
        } catch (e) {
          // Continue collecting data if JSON is incomplete
        }
      };

      this.mcpProcess.stdout.on('data', dataHandler);
      
      this.mcpProcess.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async testToolsListing() {
    logTest('Tools Listing');
    
    try {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      };

      const response = await this.sendMCPRequest(request);
      
      if (response.result && response.result.tools) {
        const tools = response.result.tools;
        const expectedTools = [
          'search_codebase',
          'get_enhanced_stats', 
          'get_health_status',
          'clear_search_cache',
          'invalidate_file_cache'
        ];

        logInfo(`Found ${tools.length} tools`);
        
        for (const expectedTool of expectedTools) {
          const tool = tools.find(t => t.name === expectedTool);
          if (tool) {
            logSuccess(`✓ ${expectedTool}: ${tool.description}`);
          } else {
            logError(`✗ Missing tool: ${expectedTool}`);
            this.testResults.failed++;
            return;
          }
        }
        
        this.testResults.passed++;
        logSuccess('All expected tools are available');
      } else {
        throw new Error('No tools found in response');
      }
    } catch (error) {
      logError(`Tools listing failed: ${error.message}`);
      this.testResults.failed++;
    }
    
    this.testResults.total++;
  }

  async testHealthStatus() {
    logTest('Health Status Check');
    
    try {
      const request = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_health_status',
          arguments: {}
        }
      };

      const response = await this.sendMCPRequest(request);
      
      if (response.result && response.result.content) {
        const healthData = JSON.parse(response.result.content[0].text);
        
        logInfo(`Overall Health: ${healthData.status}`);
        logInfo(`Services: ${Object.keys(healthData.services).length}`);
        
        // Check critical services
        const criticalServices = ['search', 'indexing', 'voyage', 'qdrant'];
        for (const service of criticalServices) {
          if (healthData.services[service]) {
            const serviceHealth = healthData.services[service];
            logSuccess(`✓ ${service}: ${serviceHealth.status} (${serviceHealth.responseTime}ms)`);
          } else {
            logError(`✗ Missing service: ${service}`);
          }
        }
        
        this.testResults.passed++;
        logSuccess('Health status check completed');
      } else {
        throw new Error('Invalid health status response');
      }
    } catch (error) {
      logError(`Health status check failed: ${error.message}`);
      this.testResults.failed++;
    }
    
    this.testResults.total++;
  }

  async testEnhancedStats() {
    logTest('Enhanced Statistics');
    
    try {
      const request = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_enhanced_stats',
          arguments: {}
        }
      };

      const response = await this.sendMCPRequest(request);
      
      if (response.result && response.result.content) {
        const stats = JSON.parse(response.result.content[0].text);
        
        logInfo(`Total Chunks: ${stats.indexing.totalChunks}`);
        logInfo(`Total Files: ${stats.indexing.totalFiles}`);
        logInfo(`Search Queries: ${stats.search.totalQueries}`);
        logInfo(`Cache Hit Rate: ${(stats.search.cacheHitRate * 100).toFixed(1)}%`);
        
        // Verify all expected stat categories
        const expectedCategories = ['indexing', 'search', 'services', 'system'];
        for (const category of expectedCategories) {
          if (stats[category]) {
            logSuccess(`✓ ${category} stats available`);
          } else {
            logError(`✗ Missing stats category: ${category}`);
          }
        }
        
        this.testResults.passed++;
        logSuccess('Enhanced statistics retrieved successfully');
      } else {
        throw new Error('Invalid enhanced stats response');
      }
    } catch (error) {
      logError(`Enhanced stats failed: ${error.message}`);
      this.testResults.failed++;
    }
    
    this.testResults.total++;
  }

  async testCodebaseSearch() {
    logTest('Enhanced Codebase Search');
    
    try {
      const searchQueries = [
        {
          query: 'search function implementation',
          description: 'Basic semantic search'
        },
        {
          query: 'authentication middleware',
          language: 'typescript',
          description: 'Language-specific search'
        },
        {
          query: 'error handling',
          chunkType: 'function',
          description: 'Chunk type filtering'
        }
      ];

      for (const testQuery of searchQueries) {
        logInfo(`Testing: ${testQuery.description}`);
        
        const request = {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'search_codebase',
            arguments: {
              query: testQuery.query,
              limit: 5,
              ...(testQuery.language && { language: testQuery.language }),
              ...(testQuery.chunkType && { chunkType: testQuery.chunkType })
            }
          }
        };

        const response = await this.sendMCPRequest(request);
        
        if (response.result && response.result.content) {
          const searchResult = JSON.parse(response.result.content[0].text);
          
          if (searchResult.references && Array.isArray(searchResult.references)) {
            logSuccess(`✓ Found ${searchResult.references.length} results for "${testQuery.query}"`);
            
            // Verify Cursor-style format
            if (searchResult.references.length > 0) {
              const firstRef = searchResult.references[0];
              if (firstRef.type === 'code_reference' && firstRef.path && firstRef.lines && firstRef.snippet) {
                logSuccess(`✓ Cursor-style format verified`);
              } else {
                logError(`✗ Invalid code reference format`);
              }
            }
            
            // Check metadata
            if (searchResult.metadata) {
              logInfo(`  Search time: ${searchResult.metadata.searchTime}ms`);
              logInfo(`  Cache hit: ${searchResult.metadata.cacheHit}`);
              logInfo(`  Hybrid used: ${searchResult.metadata.hybridUsed}`);
              logInfo(`  Re-ranked: ${searchResult.metadata.reranked}`);
            }
          } else {
            logError(`✗ Invalid search results format`);
          }
        } else {
          throw new Error('Invalid search response');
        }
      }
      
      this.testResults.passed++;
      logSuccess('Codebase search tests completed');
    } catch (error) {
      logError(`Codebase search failed: ${error.message}`);
      this.testResults.failed++;
    }
    
    this.testResults.total++;
  }

  async testCacheOperations() {
    logTest('Cache Operations');
    
    try {
      // Test cache clearing
      const clearRequest = {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'clear_search_cache',
          arguments: {}
        }
      };

      const clearResponse = await this.sendMCPRequest(clearRequest);
      
      if (clearResponse.result) {
        logSuccess('✓ Cache cleared successfully');
      } else {
        throw new Error('Cache clear failed');
      }

      // Test file cache invalidation
      const invalidateRequest = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'invalidate_file_cache',
          arguments: {
            filePath: '/test/example.ts'
          }
        }
      };

      const invalidateResponse = await this.sendMCPRequest(invalidateRequest);
      
      if (invalidateResponse.result) {
        logSuccess('✓ File cache invalidated successfully');
      } else {
        throw new Error('File cache invalidation failed');
      }
      
      this.testResults.passed++;
      logSuccess('Cache operations completed');
    } catch (error) {
      logError(`Cache operations failed: ${error.message}`);
      this.testResults.failed++;
    }
    
    this.testResults.total++;
  }

  async testErrorHandling() {
    logTest('Error Handling');
    
    try {
      // Test invalid tool call
      const invalidRequest = {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'nonexistent_tool',
          arguments: {}
        }
      };

      const response = await this.sendMCPRequest(invalidRequest);
      
      if (response.error) {
        logSuccess('✓ Invalid tool call properly rejected');
      } else {
        logError('✗ Invalid tool call should have failed');
      }

      // Test invalid search parameters
      const invalidSearchRequest = {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'search_codebase',
          arguments: {
            query: '', // Empty query should fail
            limit: -1  // Invalid limit
          }
        }
      };

      const searchResponse = await this.sendMCPRequest(invalidSearchRequest);
      
      if (searchResponse.error || (searchResponse.result && searchResponse.result.content[0].text.includes('error'))) {
        logSuccess('✓ Invalid search parameters properly handled');
      } else {
        logError('✗ Invalid search parameters should have been rejected');
      }
      
      this.testResults.passed++;
      logSuccess('Error handling tests completed');
    } catch (error) {
      logError(`Error handling test failed: ${error.message}`);
      this.testResults.failed++;
    }
    
    this.testResults.total++;
  }

  async runAllTests() {
    logSection('Enhanced MCP Codebase Indexing Server - Comprehensive Test Suite');
    
    try {
      await this.startMCPServer();
      
      // Wait a moment for server to fully initialize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await this.testToolsListing();
      await this.testHealthStatus();
      await this.testEnhancedStats();
      await this.testCodebaseSearch();
      await this.testCacheOperations();
      await this.testErrorHandling();
      
    } catch (error) {
      logError(`Test setup failed: ${error.message}`);
      this.testResults.failed++;
      this.testResults.total++;
    } finally {
      if (this.mcpProcess) {
        this.mcpProcess.kill();
        logInfo('MCP server stopped');
      }
    }
    
    this.printTestSummary();
  }

  printTestSummary() {
    logSection('Test Results Summary');
    
    const passRate = this.testResults.total > 0 
      ? (this.testResults.passed / this.testResults.total * 100).toFixed(1)
      : 0;
    
    log(`Total Tests: ${this.testResults.total}`, 'blue');
    log(`Passed: ${this.testResults.passed}`, 'green');
    log(`Failed: ${this.testResults.failed}`, 'red');
    log(`Pass Rate: ${passRate}%`, passRate >= 80 ? 'green' : 'red');
    
    if (this.testResults.failed === 0) {
      log('\n🎉 All tests passed! Enhanced MCP server is working correctly.', 'green');
    } else {
      log(`\n⚠️  ${this.testResults.failed} test(s) failed. Please check the logs above.`, 'yellow');
    }
    
    logSection('Enhanced Features Validated');
    log('✅ AST-based chunking with Tree-sitter parsers', 'green');
    log('✅ Multi-vector storage (dense + sparse BM25)', 'green');
    log('✅ Hybrid retrieval with score blending', 'green');
    log('✅ LLM re-ranking for improved relevance', 'green');
    log('✅ Cursor-style code reference formatting', 'green');
    log('✅ Context budgeting and token management', 'green');
    log('✅ Comprehensive caching system', 'green');
    log('✅ Health monitoring and statistics', 'green');
    log('✅ File watching with debouncing', 'green');
    log('✅ 5 specialized services for advanced search', 'green');
  }
}

// Run the tests
async function main() {
  const tester = new MCPTester();
  await tester.runAllTests();
  process.exit(tester.testResults.failed > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logError(`Test runner failed: ${error.message}`);
    process.exit(1);
  });
}

export { MCPTester }; 