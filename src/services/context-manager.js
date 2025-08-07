import { ChunkType } from '../types.js';
export class ContextManagerService {
    constructor(config) {
        this.tokenBudget = {
            total: config.contextWindowSize,
            reserved: 2000, // Reserve tokens for system prompts, etc.
            available: config.contextWindowSize - 2000,
            used: 0
        };
    }
    /**
     * Convert search results to Cursor-style code references with token budgeting
     */
    formatAsCodeReferences(results, maxTokens) {
        const budget = maxTokens || this.tokenBudget.available;
        const references = [];
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
        const contextWindow = {
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
    groupConsecutiveChunks(results) {
        if (results.length === 0)
            return [];
        const groups = [];
        let currentGroup = [results[0]];
        for (let i = 1; i < results.length; i++) {
            const current = results[i];
            const previous = results[i - 1];
            // Check if chunks are from the same file and potentially consecutive
            if (this.shouldGroupChunks(current, previous)) {
                currentGroup.push(current);
            }
            else {
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
    shouldGroupChunks(current, previous) {
        // Must be from the same file
        if (current.chunk.filePath !== previous.chunk.filePath) {
            return false;
        }
        // Check if chunks are close to each other (within 10 lines)
        const gap = current.chunk.startLine - previous.chunk.endLine;
        return gap >= 0 && gap <= 10;
    }
    /**
     * Create a Cursor-style code reference from a group of chunks
     */
    createCodeReference(group) {
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
        const primaryResult = group.reduce((best, current) => current.score > best.score ? current : best);
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
    combineSnippets(group) {
        if (group.length === 1) {
            return group[0].snippet;
        }
        const snippets = [];
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
    estimateTokens(text) {
        // Rough approximation: 1 token ≈ 4 characters for code
        // This varies by language and tokenizer, but gives a reasonable estimate
        return Math.ceil(text.length / 3.5);
    }
    /**
     * Generate a summary when results are truncated
     */
    generateTruncationSummary(allResults, includedCount) {
        const truncatedCount = allResults.length - includedCount;
        if (truncatedCount === 0)
            return '';
        // Analyze truncated results
        const truncatedResults = allResults.slice(includedCount);
        const fileSet = new Set(truncatedResults.map(r => r.chunk.filePath));
        const typeSet = new Set(truncatedResults.map(r => r.chunk.chunkType));
        const parts = [];
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
    boostResultsByMetadata(results) {
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
    optimizeForContext(results, _query, preferences = {}) {
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
    boostByChunkType(results, chunkType, boost) {
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
    diversifyByLanguage(results) {
        const languageGroups = new Map();
        // Group by language
        results.forEach(result => {
            const lang = result.chunk.language;
            if (!languageGroups.has(lang)) {
                languageGroups.set(lang, []);
            }
            languageGroups.get(lang).push(result);
        });
        // Take top results from each language group
        const diversified = [];
        const maxPerLanguage = Math.max(2, Math.floor(results.length / languageGroups.size));
        for (const [_lang, group] of languageGroups) {
            diversified.push(...group.slice(0, maxPerLanguage));
        }
        return diversified;
    }
    /**
     * Limit the number of results per file to avoid overwhelming from a single file
     */
    limitPerFileType(results, maxPerFile) {
        const fileGroups = new Map();
        // Group by file path
        results.forEach(result => {
            const filePath = result.chunk.filePath;
            if (!fileGroups.has(filePath)) {
                fileGroups.set(filePath, []);
            }
            fileGroups.get(filePath).push(result);
        });
        // Take top results from each file
        const limited = [];
        for (const [_filePath, group] of fileGroups) {
            limited.push(...group.slice(0, maxPerFile));
        }
        return limited;
    }
    /**
     * Get current token budget status
     */
    getTokenBudget() {
        return { ...this.tokenBudget };
    }
    /**
     * Update the token budget based on usage
     */
    updateTokenUsage(usedTokens) {
        this.tokenBudget.used = usedTokens;
        this.tokenBudget.available = this.tokenBudget.total - this.tokenBudget.reserved - usedTokens;
    }
    /**
     * Reset the token budget for a new context window
     */
    resetTokenBudget() {
        this.tokenBudget.used = 0;
        this.tokenBudget.available = this.tokenBudget.total - this.tokenBudget.reserved;
    }
}
