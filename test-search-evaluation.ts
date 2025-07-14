import { SearchService } from './src/services/search-service.js';
import { loadConfig } from './src/config.js';
import { ChunkType } from './src/types.js';

interface GoldStandardQuery {
  query: string;
  description: string;
  expectedFiles: string[];
  expectedChunkTypes?: ChunkType[];
  minimumRecall?: number; // What percentage of expected files should be in top-k
}

interface EvaluationResult {
  query: string;
  topKPrecision: number;
  topKRecall: number;
  actualFiles: string[];
  missedFiles: string[];
  unexpectedFiles: string[];
  rank: number; // Rank of first relevant result
}

class SearchEvaluationHarness {
  private searchService: SearchService;
  private goldStandardQueries: GoldStandardQuery[] = [
    {
      query: "session validation",
      description: "Finding session validation and management code",
      expectedFiles: ["src/http-server.ts"],
      expectedChunkTypes: [ChunkType.FUNCTION, ChunkType.METHOD],
      minimumRecall: 0.8
    },
    {
      query: "SSE connection management",
      description: "Server-Sent Events connection handling",
      expectedFiles: ["src/http-server.ts"],
      expectedChunkTypes: [ChunkType.FUNCTION, ChunkType.METHOD],
      minimumRecall: 0.8
    },
    {
      query: "MCP tool registration",
      description: "How MCP tools are registered and exposed",
      expectedFiles: ["src/index.ts"],
      expectedChunkTypes: [ChunkType.FUNCTION, ChunkType.CLASS],
      minimumRecall: 0.8
    },
    {
      query: "embedding generation",
      description: "Code that generates embeddings for documents",
      expectedFiles: ["src/clients/voyage-client.ts", "src/services/indexing-service.ts"],
      expectedChunkTypes: [ChunkType.FUNCTION, ChunkType.METHOD],
      minimumRecall: 0.7
    },
    {
      query: "vector search implementation",
      description: "Implementation of vector similarity search",
      expectedFiles: ["src/clients/qdrant-client.ts"],
      expectedChunkTypes: [ChunkType.FUNCTION, ChunkType.METHOD],
      minimumRecall: 0.8
    },
    {
      query: "file indexing process",
      description: "How files are parsed and indexed",
      expectedFiles: ["src/services/indexing-service.ts"],
      expectedChunkTypes: [ChunkType.FUNCTION, ChunkType.METHOD],
      minimumRecall: 0.8
    },
    {
      query: "code chunk parsing",
      description: "Parsing code into semantic chunks",
      expectedFiles: ["src/parsers/code-parser.ts"],
      expectedChunkTypes: [ChunkType.FUNCTION, ChunkType.METHOD],
      minimumRecall: 0.8
    },
    {
      query: "search result boosting",
      description: "Implementation boosting for search results",
      expectedFiles: ["src/services/search-service.ts"],
      expectedChunkTypes: [ChunkType.FUNCTION, ChunkType.METHOD],
      minimumRecall: 0.8
    },
    {
      query: "hybrid search algorithm",
      description: "Combining dense and sparse search results",
      expectedFiles: ["src/services/hybrid-search.ts"],
      expectedChunkTypes: [ChunkType.FUNCTION, ChunkType.METHOD],
      minimumRecall: 0.8
    },
    {
      query: "LLM reranking process",
      description: "Using LLM to rerank search results",
      expectedFiles: ["src/services/llm-reranker.ts"],
      expectedChunkTypes: [ChunkType.FUNCTION, ChunkType.METHOD],
      minimumRecall: 0.8
    }
  ];

  constructor() {
    const config = loadConfig();
    this.searchService = new SearchService(config);
  }

  async initialize(): Promise<void> {
    await this.searchService.initialize();
    console.log('🚀 Search evaluation harness initialized');
  }

  async runEvaluation(topK: number = 10): Promise<EvaluationResult[]> {
    console.log(`\n📊 Running search evaluation with top-${topK} results...\n`);
    
    const results: EvaluationResult[] = [];
    
    for (const goldQuery of this.goldStandardQueries) {
      console.log(`\n🔍 Evaluating: "${goldQuery.query}"`);
      console.log(`   Description: ${goldQuery.description}`);
      console.log(`   Expected files: ${goldQuery.expectedFiles.join(', ')}`);
      
      try {
        // Build search query with implementation preference
        const searchQuery = this.searchService.buildSearchQuery({
          query: goldQuery.query,
          limit: topK,
          threshold: 0.15, // Lower threshold for broader recall
          enableHybrid: true,
          enableReranking: true,
          preferImplementation: true
        });

        // Execute search
        const searchResults = await this.searchService.search(searchQuery);
        
        // Extract file paths from results
        const actualFiles = searchResults.map(r => r.chunk.filePath);
        const uniqueActualFiles = [...new Set(actualFiles)];
        
        // Calculate metrics
        const relevantFiles = goldQuery.expectedFiles;
        const foundRelevantFiles = uniqueActualFiles.filter(file => 
          relevantFiles.some(expected => file.includes(expected) || expected.includes(file))
        );
        
        const precision = foundRelevantFiles.length / Math.min(uniqueActualFiles.length, topK);
        const recall = foundRelevantFiles.length / relevantFiles.length;
        
        // Find rank of first relevant result
        let firstRelevantRank = -1;
        for (let i = 0; i < searchResults.length; i++) {
          const filePath = searchResults[i].chunk.filePath;
          if (relevantFiles.some(expected => filePath.includes(expected) || expected.includes(filePath))) {
            firstRelevantRank = i + 1;
            break;
          }
        }
        
        const missedFiles = relevantFiles.filter(expected => 
          !uniqueActualFiles.some(actual => actual.includes(expected) || expected.includes(actual))
        );
        
        const unexpectedFiles = uniqueActualFiles.filter(actual => 
          !relevantFiles.some(expected => actual.includes(expected) || expected.includes(actual))
        );

        const result: EvaluationResult = {
          query: goldQuery.query,
          topKPrecision: precision,
          topKRecall: recall,
          actualFiles: uniqueActualFiles.slice(0, topK),
          missedFiles,
          unexpectedFiles: unexpectedFiles.slice(0, 5), // Show first 5 unexpected
          rank: firstRelevantRank
        };
        
        results.push(result);
        
        // Print results
        console.log(`   ✅ Precision@${topK}: ${(precision * 100).toFixed(1)}%`);
        console.log(`   ✅ Recall@${topK}: ${(recall * 100).toFixed(1)}%`);
        console.log(`   ✅ First relevant rank: ${firstRelevantRank === -1 ? 'NOT FOUND' : firstRelevantRank}`);
        
        if (foundRelevantFiles.length > 0) {
          console.log(`   ✅ Found relevant: ${foundRelevantFiles.join(', ')}`);
        }
        
        if (missedFiles.length > 0) {
          console.log(`   ❌ Missed: ${missedFiles.join(', ')}`);
        }
        
        const success = recall >= (goldQuery.minimumRecall || 0.8);
        console.log(`   ${success ? '✅' : '❌'} PASS: ${success ? 'YES' : 'NO'} (recall >= ${((goldQuery.minimumRecall || 0.8) * 100).toFixed(0)}%)`);
        
      } catch (error) {
        console.error(`   ❌ Error evaluating "${goldQuery.query}":`, error);
        results.push({
          query: goldQuery.query,
          topKPrecision: 0,
          topKRecall: 0,
          actualFiles: [],
          missedFiles: goldQuery.expectedFiles,
          unexpectedFiles: [],
          rank: -1
        });
      }
    }
    
    return results;
  }

  printSummary(results: EvaluationResult[]): void {
    console.log('\n📊 EVALUATION SUMMARY');
    console.log('=' .repeat(50));
    
    const avgPrecision = results.reduce((sum, r) => sum + r.topKPrecision, 0) / results.length;
    const avgRecall = results.reduce((sum, r) => sum + r.topKRecall, 0) / results.length;
    const successfulQueries = results.filter(r => r.topKRecall >= 0.8).length;
    const avgFirstRank = results.filter(r => r.rank > 0).reduce((sum, r) => sum + r.rank, 0) / results.filter(r => r.rank > 0).length;
    
    console.log(`📈 Average Precision@10: ${(avgPrecision * 100).toFixed(1)}%`);
    console.log(`📈 Average Recall@10: ${(avgRecall * 100).toFixed(1)}%`);
    console.log(`📈 Successful Queries: ${successfulQueries}/${results.length} (${((successfulQueries / results.length) * 100).toFixed(1)}%)`);
    console.log(`📈 Average First Relevant Rank: ${avgFirstRank.toFixed(1)}`);
    
    console.log('\n🎯 INDIVIDUAL QUERY PERFORMANCE:');
    results.forEach(result => {
      const status = result.topKRecall >= 0.8 ? '✅' : '❌';
      console.log(`${status} "${result.query}": P=${(result.topKPrecision * 100).toFixed(1)}% R=${(result.topKRecall * 100).toFixed(1)}% Rank=${result.rank === -1 ? 'N/A' : result.rank}`);
    });
    
    // Identify problematic queries
    const problematicQueries = results.filter(r => r.topKRecall < 0.8);
    if (problematicQueries.length > 0) {
      console.log('\n🚨 QUERIES NEEDING IMPROVEMENT:');
      problematicQueries.forEach(result => {
        console.log(`❌ "${result.query}" (Recall: ${(result.topKRecall * 100).toFixed(1)}%)`);
        if (result.missedFiles.length > 0) {
          console.log(`   Missing: ${result.missedFiles.join(', ')}`);
        }
      });
    }
  }

  async compareWithCursor(): Promise<void> {
    console.log('\n🔍 COMPARISON WITH CURSOR BUILT-IN SEARCH');
    console.log('=' .repeat(50));
    console.log('To compare with Cursor built-in search:');
    console.log('1. Use Cursor\'s codebase_search for each query');
    console.log('2. Note which files appear in top 5 results');
    console.log('3. Compare with our results above');
    console.log('\nKey test query: "session validation"');
    console.log('Expected: Cursor should surface src/http-server.ts session handling functions');
  }
}

// Main execution
async function main() {
  try {
    const harness = new SearchEvaluationHarness();
    await harness.initialize();
    
    const results = await harness.runEvaluation(10);
    harness.printSummary(results);
    await harness.compareWithCursor();
    
  } catch (error) {
    console.error('❌ Evaluation failed:', error);
    process.exit(1);
  }
}

// Run evaluation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { SearchEvaluationHarness, type GoldStandardQuery, type EvaluationResult }; 