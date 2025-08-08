import { OpenAI } from 'openai';
import type { Config } from '../types.js';
import { createModuleLogger } from '../logging/logger.js'

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
  private readonly log = createModuleLogger('llm-reranker')

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

      this.log.info({ model: this.model, baseUrl: baseUrl || 'https://api.openai.com/v1', timeoutMs: this.timeoutMs }, 'LLMReranker initialized')
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
      this.log.debug('Re-ranking disabled or not configured; returning original results')
      return { results: searchResults.slice(0, limit), reranked: false };
    }

    if (searchResults.length <= 1) {
      this.log.debug('Only 1 or fewer results; skipping re-ranking')
      return { results: searchResults, reranked: false };
    }

    try {
      this.log.debug({ count: searchResults.length }, 'Re-ranking candidates')
      
      const prompt = this.buildReRankingPrompt(query, searchResults);
      const rankedIndices = await this.callLLMAPI(prompt);
      
      // Apply the ranking
      const rerankedResults = this.applyRanking(searchResults, rankedIndices, limit);
      
      const duration = Date.now() - startTime;
      this.recordDuration(duration);
      this.log.info({ durationMs: duration, count: searchResults.length }, 'Re-ranking completed')
      return { results: rerankedResults, reranked: true };
      
    } catch (error) {
      this.errorCount++;
      const duration = Date.now() - startTime;
      this.recordDuration(duration);

      this.log.warn({ durationMs: duration, err: error }, 'Re-ranking failed; falling back to original results')
      return { results: searchResults.slice(0, limit), reranked: false };
    }
  }

  private async callLLMAPI(prompt: string): Promise<number[]> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    this.log.debug({ model: this.model }, 'Calling LLM via OpenAI SDK')
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that ranks search results based on relevance to a query. You must respond with valid JSON only. Output strictly valid JSON.'
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
      // Be tolerant to fenced code blocks from some providers
      const jsonText = content.trim().replace(/^```json\s*|```$/g, '')
      const parsed = JSON.parse(jsonText);
      const rankedIndices = parsed.rankedIndices || parsed.ranking || parsed.indices;
      
      if (!Array.isArray(rankedIndices)) {
        throw new Error('LLM response does not contain a valid rankedIndices array');
      }
      this.log.debug({ rankedCount: rankedIndices.length }, 'Parsed ranking indices')
      return rankedIndices;
      
    } catch (error: any) {
      this.log.warn({ err: error }, 'LLM API error')
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
        this.log.warn('No valid indices in ranking; using original order')
        return originalResults.slice(0, limit);
      }

      // Apply ranking
      const rerankedResults = validIndices.map((idx) => originalResults[idx]);
      
      // Add any missing results at the end
      const usedIndices = new Set(validIndices);
      const missingResults = originalResults.filter((_, idx) => !usedIndices.has(idx));
      rerankedResults.push(...missingResults);

      this.log.debug({ sample: validIndices.slice(0, 5) }, 'Applied ranking order')
      return rerankedResults.slice(0, limit);
      
    } catch (error) {
      this.log.error({ err: error }, 'Error applying ranking')
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