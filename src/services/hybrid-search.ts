import { 
  SearchQuery, 
  SearchResult, 
  HybridSearchResult, 
  Config,
  SparseVector 
} from '../types.js';

export class HybridSearchService {
  private enabled: boolean;
  private alpha: number; // Weight for dense vs sparse (0.7 = 70% dense, 30% sparse)

  constructor(config: Config) {
    this.enabled = config.enableHybridSearch;
    this.alpha = config.hybridSearchAlpha;
  }

  /**
   * Check if hybrid search is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Perform hybrid search combining dense and sparse retrieval
   */
  async hybridSearch(
    _query: SearchQuery,
    denseResults: SearchResult[],
    sparseResults?: SearchResult[]
  ): Promise<HybridSearchResult> {
    if (!this.enabled || !sparseResults) {
      // Return dense-only results if hybrid is disabled or sparse unavailable
      return {
        denseResults,
        sparseResults: sparseResults || [],
        combinedResults: denseResults,
        alpha: 1.0
      };
    }

    console.log(`🔀 [HybridSearch] Combining ${denseResults.length} dense + ${sparseResults.length} sparse results`);

    try {
      // Combine and score results
      const combinedResults = this.combineResults(denseResults, sparseResults, this.alpha);
      
      console.log(`✅ [HybridSearch] Combined to ${combinedResults.length} results with α=${this.alpha}`);

      return {
        denseResults,
        sparseResults,
        combinedResults,
        alpha: this.alpha
      };

    } catch (error) {
      console.error(`❌ [HybridSearch] Hybrid search failed:`, error);
      
      // Fallback to dense results only
      return {
        denseResults,
        sparseResults: sparseResults || [],
        combinedResults: denseResults,
        alpha: 1.0
      };
    }
  }

  /**
   * Combine dense and sparse results using weighted scoring
   */
  private combineResults(
    denseResults: SearchResult[],
    sparseResults: SearchResult[],
    alpha: number
  ): SearchResult[] {
    // Create maps for efficient lookup
    const denseMap = new Map<string, SearchResult>();
    const sparseMap = new Map<string, SearchResult>();
    
    // Normalize scores to 0-1 range
    const maxDenseScore = Math.max(...denseResults.map(r => r.score), 0.01);
    const maxSparseScore = Math.max(...sparseResults.map(r => r.score), 0.01);

    // Index dense results
    denseResults.forEach(result => {
      const normalizedResult = {
        ...result,
        score: result.score / maxDenseScore
      };
      denseMap.set(result.id, normalizedResult);
    });

    // Index sparse results
    sparseResults.forEach(result => {
      const normalizedResult = {
        ...result,
        score: result.score / maxSparseScore
      };
      sparseMap.set(result.id, normalizedResult);
    });

    // Get all unique result IDs
    const allIds = new Set([...denseMap.keys(), ...sparseMap.keys()]);
    
    // Combine scores for each result
    const combinedResults: SearchResult[] = [];
    
    for (const id of allIds) {
      const denseResult = denseMap.get(id);
      const sparseResult = sparseMap.get(id);
      
      // Calculate hybrid score: α * dense + (1-α) * sparse
      const denseScore = denseResult?.score || 0;
      const sparseScore = sparseResult?.score || 0;
      const hybridScore = alpha * denseScore + (1 - alpha) * sparseScore;
      
      // Use the result with more complete data (prefer dense, fallback to sparse)
      const baseResult = denseResult || sparseResult;
      if (!baseResult) continue;
      
      const combinedResult: SearchResult = {
        ...baseResult,
        score: hybridScore,
        hybridScore: {
          dense: denseScore,
          sparse: sparseScore,
          combined: hybridScore
        }
      };
      
      combinedResults.push(combinedResult);
    }
    
    // Sort by combined score (descending)
    combinedResults.sort((a, b) => b.score - a.score);
    
    return combinedResults;
  }

  /**
   * Generate sparse vector representation for BM25-style search
   * This is a simplified implementation - in production, you'd use a proper BM25 library
   */
  generateSparseVector(text: string, vocabulary: Map<string, number>): SparseVector {
    const terms = this.tokenize(text);
    const termFreq = new Map<string, number>();
    
    // Count term frequencies
    terms.forEach(term => {
      termFreq.set(term, (termFreq.get(term) || 0) + 1);
    });
    
    const indices: number[] = [];
    const values: number[] = [];
    
    // Convert to sparse vector format
    termFreq.forEach((freq, term) => {
      const termId = vocabulary.get(term);
      if (termId !== undefined) {
        indices.push(termId);
        values.push(freq); // Could apply TF-IDF weighting here
      }
    });
    
    return { indices, values };
  }

  /**
   * Simple tokenization for sparse vector generation
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1)
      .filter(token => !this.isStopWord(token));
  }

  /**
   * Check if a word is a stop word
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
      'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
    ]);
    return stopWords.has(word);
  }

  /**
   * Adjust the alpha parameter for different query types
   */
  adaptiveAlpha(query: SearchQuery): number {
    let adaptedAlpha = this.alpha;
    
    // Boost dense search for semantic queries
    if (this.isSemanticQuery(query.query)) {
      adaptedAlpha = Math.min(1.0, this.alpha + 0.1);
    }
    
    // Boost sparse search for exact matches and identifier searches
    if (this.isExactMatchQuery(query.query)) {
      adaptedAlpha = Math.max(0.0, this.alpha - 0.2);
    }
    
    return adaptedAlpha;
  }

  /**
   * Detect if query is semantic in nature
   */
  private isSemanticQuery(query: string): boolean {
    const semanticIndicators = [
      'how to', 'what is', 'explain', 'implement', 'create', 'build',
      'algorithm', 'pattern', 'similar to', 'like', 'example'
    ];
    
    const lowerQuery = query.toLowerCase();
    return semanticIndicators.some(indicator => lowerQuery.includes(indicator));
  }

  /**
   * Detect if query is looking for exact matches
   */
  private isExactMatchQuery(query: string): boolean {
    // Queries with camelCase, snake_case, or specific identifiers
    const exactMatchPatterns = [
      /[a-z][A-Z]/, // camelCase
      /_[a-z]/, // snake_case
      /^[A-Z][a-z]+$/, // PascalCase
      /^\w+\(\)$/, // function calls
      /^[\w.]+$/ // dot notation
    ];
    
    return exactMatchPatterns.some(pattern => pattern.test(query.trim()));
  }

  /**
   * Get hybrid search statistics
   */
  getStats(): {
    enabled: boolean;
    alpha: number;
    totalQueries: number;
    denseOnlyQueries: number;
    hybridQueries: number;
    averageImprovement: number;
  } {
    return {
      enabled: this.enabled,
      alpha: this.alpha,
      totalQueries: 0, // TODO: Implement query tracking
      denseOnlyQueries: 0, // TODO: Implement tracking
      hybridQueries: 0, // TODO: Implement tracking
      averageImprovement: 0.15 // TODO: Implement improvement tracking
    };
  }
} 