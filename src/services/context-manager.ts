import { 
  SearchResult, 
  CodeReference, 
  ContextWindow, 
  TokenBudget, 
  Config,
  ChunkType 
} from '../types.js';

export class ContextManagerService {
  private tokenBudget: TokenBudget;
  private readonly reservedTokens: number;
  private readonly charsPerToken: number;
  private readonly groupGapLines: number;

  constructor(config: Config) {
    this.reservedTokens = (config as any).contextReservedTokens ?? 2000;
    this.charsPerToken = (config as any).contextCharsPerToken ?? 4;
    this.groupGapLines = (config as any).contextGroupGapLines ?? 10;

    this.tokenBudget = {
      total: config.contextWindowSize,
      reserved: this.reservedTokens,
      available: config.contextWindowSize - this.reservedTokens,
      used: 0
    };
  }

  /**
   * Convert search results to Cursor-style code references with token budgeting
   */
  formatAsCodeReferences(
    results: SearchResult[], 
    maxTokens?: number
  ): { 
    references: CodeReference[], 
    contextWindow: ContextWindow,
    truncated: boolean 
  } {
    const budget = maxTokens || this.tokenBudget.available;
    const references: CodeReference[] = [];
    let usedTokens = 0;
    let truncated = false;

    console.log(`📝 [ContextManager] Formatting ${results.length} results with ${budget} token budget`);

    // Group consecutive chunks from the same file
    const groupedResults = this.groupConsecutiveChunks(results);
    
    for (const group of groupedResults) {
      const reference = this.createCodeReference(group);
      const referenceTokens = this.estimateTokens(reference.snippet);
      
      // Check if adding this reference would exceed the budget
      if (usedTokens + referenceTokens > budget) {
        truncated = true;
        break;
      }
      
      references.push(reference);
      usedTokens += referenceTokens;
    }

    const contextWindow: ContextWindow = {
      maxTokens: budget,
      usedTokens,
      chunks: references,
      truncated,
      ...(truncated && { summary: this.generateTruncationSummary(results, references.length) })
    };

    console.log(`✅ [ContextManager] Created ${references.length} references using ${usedTokens}/${budget} tokens${truncated ? ' (truncated)' : ''}`);

    return { references, contextWindow, truncated };
  }

  /**
   * Group consecutive chunks from the same file to reduce UI clutter
   */
  private groupConsecutiveChunks(results: SearchResult[]): SearchResult[][] {
    if (results.length === 0) return [];

    const groups: SearchResult[][] = [];
    let currentGroup: SearchResult[] = [results[0]];

    for (let i = 1; i < results.length; i++) {
      const current = results[i];
      const previous = results[i - 1];

      // Check if chunks are from the same file and potentially consecutive
      if (this.shouldGroupChunks(current, previous)) {
        currentGroup.push(current);
      } else {
        // Start a new group
        groups.push(currentGroup);
        currentGroup = [current];
      }
    }
    
    // Add the last group
    groups.push(currentGroup);

    return groups;
  }

  /**
   * Determine if two chunks should be grouped together
   */
  private shouldGroupChunks(current: SearchResult, previous: SearchResult): boolean {
    // Must be from the same file
    if (current.chunk.filePath !== previous.chunk.filePath) {
      return false;
    }

    // Check if chunks are close to each other (within configured gap)
    const gap = current.chunk.startLine - previous.chunk.endLine;
    return gap >= 0 && gap <= this.groupGapLines;
  }

  /**
   * Create a Cursor-style code reference from a group of chunks
   */
  private createCodeReference(group: SearchResult[]): CodeReference {
    // Sort by line number to ensure proper ordering
    group.sort((a, b) => a.chunk.startLine - b.chunk.startLine);
    
    const firstChunk = group[0].chunk;
    const lastChunk = group[group.length - 1].chunk;
    
    // Determine the overall line range
    const startLine = firstChunk.startLine;
    const endLine = lastChunk.endLine;
    
    // Combine snippets with appropriate spacing
    const combinedSnippet = this.combineSnippets(group);
    
    // Calculate average score
    const averageScore = group.reduce((sum, result) => sum + result.score, 0) / group.length;
    
    // Determine the primary chunk type and metadata
    const primaryResult = group.reduce((best, current) => 
      current.score > best.score ? current : best
    );

    return {
      type: 'code_reference',
      path: firstChunk.filePath,
      lines: [startLine, endLine],
      snippet: combinedSnippet,
      score: averageScore,
      chunkType: primaryResult.chunk.chunkType,
      language: firstChunk.language,
      metadata: {
        ...(primaryResult.chunk.functionName && { functionName: primaryResult.chunk.functionName }),
        ...(primaryResult.chunk.className && { className: primaryResult.chunk.className }),
        ...(primaryResult.chunk.complexity && { complexity: primaryResult.chunk.complexity }),
        isTest: firstChunk.metadata.isTest
      }
    };
  }

  /**
   * Combine snippets from multiple chunks with proper formatting
   */
  private combineSnippets(group: SearchResult[]): string {
    if (group.length === 1) {
      return group[0].snippet;
    }

    const snippets: string[] = [];
    let lastEndLine = 0;

    for (const result of group) {
      const chunk = result.chunk;
      
      // Add gap indicator if there's a significant gap between chunks
      if (lastEndLine > 0 && chunk.startLine - lastEndLine > 3) {
        snippets.push('// ... (gap) ...');
      }
      
      snippets.push(result.snippet);
      lastEndLine = chunk.endLine;
    }

    return snippets.join('\n\n');
  }

  /**
   * Estimate token count for a text snippet
   * This is a rough approximation - in production, use a proper tokenizer
   */
  private estimateTokens(text: string): number {
    // Rough approximation: configurable chars-per-token for code
    return Math.ceil(text.length / Math.max(1, this.charsPerToken));
  }

  /**
   * Generate a summary when results are truncated
   */
  private generateTruncationSummary(
    allResults: SearchResult[], 
    includedCount: number
  ): string {
    const truncatedCount = allResults.length - includedCount;
    
    if (truncatedCount === 0) return '';
    
    // Analyze truncated results
    const truncatedResults = allResults.slice(includedCount);
    const fileSet = new Set(truncatedResults.map(r => r.chunk.filePath));
    const typeSet = new Set(truncatedResults.map(r => r.chunk.chunkType));
    
    const parts: string[] = [];
    parts.push(`${truncatedCount} additional result${truncatedCount > 1 ? 's' : ''} truncated`);
    
    if (fileSet.size > 0) {
      parts.push(`from ${fileSet.size} file${fileSet.size > 1 ? 's' : ''}`);
    }
    
    if (typeSet.size > 0) {
      const types = Array.from(typeSet).slice(0, 3).join(', ');
      parts.push(`(${types}${typeSet.size > 3 ? ', ...' : ''})`);
    }
    
    return parts.join(' ');
  }

  /**
   * Boost results based on file metadata (recently modified, currently open)
   */
  boostResultsByMetadata(results: SearchResult[]): SearchResult[] {
    return results.map(result => {
      let boost = 0;
      const metadata = result.chunk.metadata;
      
      // Boost recently modified files
      if (metadata.isRecentlyModified) {
        boost += 0.1;
      }
      
      // Boost currently open files
      if (metadata.isCurrentlyOpen) {
        boost += 0.15;
      }
      
      // Boost based on file type preferences
      if (!metadata.isTest) {
        boost += 0.05; // Slightly prefer non-test files
      }
      
      return {
        ...result,
        score: Math.min(1.0, result.score + boost)
      };
    });
  }

  /**
   * Filter and prioritize results for optimal context usage
   */
  optimizeForContext(
    results: SearchResult[], 
    _query: string,
    preferences: {
      preferFunctions?: boolean;
      preferClasses?: boolean;
      maxFilesPerType?: number;
      diversifyLanguages?: boolean;
    } = {}
  ): SearchResult[] {
    let optimized = [...results];
    
    // Apply metadata-based boosting
    optimized = this.boostResultsByMetadata(optimized);
    
    // Apply type-based preferences
    if (preferences.preferFunctions) {
      optimized = this.boostByChunkType(optimized, ChunkType.FUNCTION, 0.1);
    }
    
    if (preferences.preferClasses) {
      optimized = this.boostByChunkType(optimized, ChunkType.CLASS, 0.1);
    }
    
    // Diversify by language if requested
    if (preferences.diversifyLanguages) {
      optimized = this.diversifyByLanguage(optimized);
    }
    
    // Limit results per file type if specified
    if (preferences.maxFilesPerType) {
      optimized = this.limitPerFileType(optimized, preferences.maxFilesPerType);
    }
    
    // Re-sort by adjusted scores
    optimized.sort((a, b) => b.score - a.score);
    
    return optimized;
  }

  /**
   * Boost results of a specific chunk type
   */
  private boostByChunkType(results: SearchResult[], chunkType: ChunkType, boost: number): SearchResult[] {
    return results.map(result => {
      if (result.chunk.chunkType === chunkType) {
        return {
          ...result,
          score: Math.min(1.0, result.score + boost)
        };
      }
      return result;
    });
  }

  /**
   * Diversify results by language to provide broader context
   */
  private diversifyByLanguage(results: SearchResult[]): SearchResult[] {
    const languageGroups = new Map<string, SearchResult[]>();
    
    // Group by language
    results.forEach(result => {
      const lang = result.chunk.language;
      if (!languageGroups.has(lang)) {
        languageGroups.set(lang, []);
      }
      languageGroups.get(lang)!.push(result);
    });
    
    // Take top results from each language group
    const diversified: SearchResult[] = [];
    const maxPerLanguage = Math.max(2, Math.floor(results.length / languageGroups.size));
    
    for (const [_lang, group] of languageGroups) {
      diversified.push(...group.slice(0, maxPerLanguage));
    }
    
    return diversified;
  }

  /**
   * Limit the number of results per file to avoid overwhelming from a single file
   */
  private limitPerFileType(results: SearchResult[], maxPerFile: number): SearchResult[] {
    const fileGroups = new Map<string, SearchResult[]>();
    
    // Group by file path
    results.forEach(result => {
      const filePath = result.chunk.filePath;
      if (!fileGroups.has(filePath)) {
        fileGroups.set(filePath, []);
      }
      fileGroups.get(filePath)!.push(result);
    });
    
    // Take top results from each file
    const limited: SearchResult[] = [];
    
    for (const [_filePath, group] of fileGroups) {
      limited.push(...group.slice(0, maxPerFile));
    }
    
    return limited;
  }

  /**
   * Get current token budget status
   */
  getTokenBudget(): TokenBudget {
    return { ...this.tokenBudget };
  }

  /**
   * Update the token budget based on usage
   */
  updateTokenUsage(usedTokens: number): void {
    this.tokenBudget.used = usedTokens;
    this.tokenBudget.available = this.tokenBudget.total - this.tokenBudget.reserved - usedTokens;
  }

  /**
   * Reset the token budget for a new context window
   */
  resetTokenBudget(): void {
    this.tokenBudget.used = 0;
    this.tokenBudget.available = this.tokenBudget.total - this.tokenBudget.reserved;
  }
} 