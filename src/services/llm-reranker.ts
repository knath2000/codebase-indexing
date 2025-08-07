import { OpenAI } from 'openai';
import type { Config } from '../types.js';

interface SearchResult {
  chunkId: string;
  score: number;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  chunkType?: string;
  language?: string;
}

export class LLMRerankerService {
  private apiKey: string | undefined;
  private model: string;
  private enabled: boolean;
  private timeoutMs: number;
  private requestDurations: number[] = []; // To store last N request durations
  private errorCount: number = 0;
  private totalRequests: number = 0;
  private maxDurationsToStore: number = 100; // Store up to 100 durations
  private client: OpenAI | undefined;

  constructor(config: Config) {
    this.apiKey = config.llmRerankerApiKey || undefined;
    this.model = config.llmRerankerModel;
    this.enabled = config.enableLLMReranking && !!this.apiKey;
    this.timeoutMs = config.llmRerankerTimeoutMs;

    // Initialize OpenAI client with LangDB configuration
    if (this.enabled && this.apiKey) {
      const baseUrl = (config as any).llmRerankerBaseUrl;
      
      this.client = new OpenAI({
        baseURL: baseUrl || 'https://api.openai.com/v1',
        apiKey: this.apiKey,
        timeout: this.timeoutMs
      });

      console.log(`[LLMRerankerService] Initialized with OpenAI SDK`);
      console.log(`[LLMRerankerService] Model: ${this.model}`);
      console.log(`[LLMRerankerService] Base URL: ${baseUrl || 'https://api.openai.com/v1'}`);
      console.log(`[LLMRerankerService] Timeout: ${this.timeoutMs}ms`);
    }
  }

  async rerank(
    query: string,
    searchResults: SearchResult[],
    limit: number = 10
  ): Promise<{ results: SearchResult[]; reranked: boolean }> {
    const startTime = Date.now();
    this.totalRequests++;

    if (!this.enabled || !this.client) {
      console.log('[LLMReranker] Re-ranking disabled or not configured, returning original results');
      return { results: searchResults.slice(0, limit), reranked: false };
    }

    if (searchResults.length <= 1) {
      console.log('[LLMReranker] Only 1 or fewer results, skipping re-ranking');
      return { results: searchResults, reranked: false };
    }

    try {
      console.log(`[LLMReranker] Re-ranking ${searchResults.length} results for query: "${query}"`);
      
      const prompt = this.buildReRankingPrompt(query, searchResults);
      const rankedIndices = await this.callLLMAPI(prompt);
      
      // Apply the ranking
      const rerankedResults = this.applyRanking(searchResults, rankedIndices, limit);
      
      const duration = Date.now() - startTime;
      this.recordDuration(duration);
      
      console.log(`[LLMReranker] Re-ranking completed successfully in ${duration}ms`);
      return { results: rerankedResults, reranked: true };
      
    } catch (error) {
      this.errorCount++;
      const duration = Date.now() - startTime;
      this.recordDuration(duration);
      
      console.error(`[LLMReranker] Re-ranking failed after ${duration}ms:`, error);
      console.log('[LLMReranker] Falling back to original results');
      return { results: searchResults.slice(0, limit), reranked: false };
    }
  }

  private async callLLMAPI(prompt: string): Promise<number[]> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    console.log(`[LLMReranker] Calling ${this.model} via OpenAI SDK...`);
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that ranks search results based on relevance to a query. You must respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in LLM response');
      }

      console.log(`[LLMReranker] Raw LLM response: ${content}`);
      
      // Parse the JSON response
      const parsed = JSON.parse(content);
      const rankedIndices = parsed.rankedIndices || parsed.ranking || parsed.indices;
      
      if (!Array.isArray(rankedIndices)) {
        throw new Error('LLM response does not contain a valid rankedIndices array');
      }

      console.log(`[LLMReranker] Parsed ranking: [${rankedIndices.join(', ')}]`);
      return rankedIndices;
      
    } catch (error: any) {
      console.error(`[LLMReranker] OpenAI SDK error:`, error.message);
      throw error;
    }
  }

  private buildReRankingPrompt(query: string, results: SearchResult[]): string {
    const resultSummaries = results.map((result, index) => {
      const fileName = result.filePath.split('/').pop() || result.filePath;
      const preview = result.content.substring(0, 200).replace(/\n/g, ' ');
      return `${index}: ${fileName} (${result.chunkType || 'unknown'}) - ${preview}...`;
    }).join('\n');

    return `Given the search query: "${query}"

Rank these ${results.length} search results by relevance (most relevant first):

${resultSummaries}

Respond with JSON only in this exact format:
{
  "rankedIndices": [most_relevant_index, second_most_relevant_index, ...]
}

Include ALL indices from 0 to ${results.length - 1} in your ranking.`;
  }

  private applyRanking(
    originalResults: SearchResult[],
    rankedIndices: number[],
    limit: number
  ): SearchResult[] {
    try {
      // Validate indices
      const validIndices = rankedIndices.filter(
        (idx) => typeof idx === 'number' && idx >= 0 && idx < originalResults.length
      );

      if (validIndices.length === 0) {
        console.warn('[LLMReranker] No valid indices in ranking, using original order');
        return originalResults.slice(0, limit);
      }

      // Apply ranking
      const rerankedResults = validIndices.map((idx) => originalResults[idx]);
      
      // Add any missing results at the end
      const usedIndices = new Set(validIndices);
      const missingResults = originalResults.filter((_, idx) => !usedIndices.has(idx));
      rerankedResults.push(...missingResults);

      console.log(`[LLMReranker] Applied ranking: ${validIndices.slice(0, 5).join(', ')}${validIndices.length > 5 ? '...' : ''}`);
      return rerankedResults.slice(0, limit);
      
    } catch (error) {
      console.error('[LLMReranker] Error applying ranking:', error);
      return originalResults.slice(0, limit);
    }
  }

  private recordDuration(duration: number): void {
    this.requestDurations.push(duration);
    if (this.requestDurations.length > this.maxDurationsToStore) {
      this.requestDurations.shift();
    }
  }

  getStats() {
    const avgDuration = this.requestDurations.length > 0 
      ? this.requestDurations.reduce((a, b) => a + b, 0) / this.requestDurations.length 
      : 0;

    return {
      enabled: this.enabled,
      model: this.model,
      totalRequests: this.totalRequests,
      errorCount: this.errorCount,
      errorRate: this.totalRequests > 0 ? (this.errorCount / this.totalRequests) * 100 : 0,
      avgDurationMs: Math.round(avgDuration),
      timeoutMs: this.timeoutMs,
      requestCount: this.requestDurations.length
    };
  }
} 