import { SearchResult, LLMRerankerRequest, LLMRerankerResponse, Config } from '../types.js';

export class LLMRerankerService {
  private apiKey: string | undefined;
  private model: string;
  private enabled: boolean;
  private timeoutMs: number;
  private requestDurations: number[] = []; // To store last N request durations
  private errorCount: number = 0;
  private totalRequests: number = 0;
  private maxDurationsToStore: number = 100; // Store up to 100 durations
  private baseUrl?: string;

  constructor(config: Config) {
    this.apiKey = config.llmRerankerApiKey || undefined;
    this.model = config.llmRerankerModel;
    this.enabled = config.enableLLMReranking && !!this.apiKey;
    this.timeoutMs = config.llmRerankerTimeoutMs;
    this.baseUrl = (config as any).llmRerankerBaseUrl;
    
    if (config.enableLLMReranking && !this.apiKey) {
      console.warn('LLM re-ranking is enabled but no API key provided. Re-ranking will be disabled.');
      this.enabled = false;
    }
  }

  /**
   * Check if LLM re-ranking is available and enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Test connection to LLM Reranker
   */
  async testConnection(): Promise<boolean> {
    if (!this.enabled) {
      return true; // Consider as connected if disabled by config
    }
    try {
      const startTime = Date.now();
      // Make a dummy request to test connectivity
      await this.callLLMAPI('test', startTime);
      this.addRequestDuration(Date.now() - startTime);
      return true;
    } catch (error) {
      console.error('LLM Reranker connection test failed:', error);
      this.errorCount++;
      return false;
    }
  }

  /**
   * Get cache size (dummy for now as no cache is implemented in reranker)
   */
  cacheSize(): number {
    return 0;
  }

  /**
   * Get memory usage (dummy for now)
   */
  memoryUsage(): number {
    return 0;
  }

  /**
   * Get average request latency for LLM reranker
   */
  getAverageLatency(): number {
    if (this.requestDurations.length === 0) {
      return 0;
    }
    const sum = this.requestDurations.reduce((a, b) => a + b, 0);
    return sum / this.requestDurations.length;
  }

  /**
   * Get error rate for LLM reranker
   */
  getErrorRate(): number {
    return this.totalRequests === 0 ? 0 : (this.errorCount / this.totalRequests) * 100;
  }

  private addRequestDuration(duration: number): void {
    this.requestDurations.push(duration);
    if (this.requestDurations.length > this.maxDurationsToStore) {
      this.requestDurations.shift(); // Remove the oldest duration
    }
  }

  /**
   * Re-rank search results using LLM for improved relevance
   */
  async rerank(request: LLMRerankerRequest, requestStartTime: number = Date.now()): Promise<LLMRerankerResponse> {
    if (!this.enabled) {
      // Return original results if re-ranking is disabled
      return {
        rerankedResults: request.candidates.slice(0, request.maxResults),
        reasoning: 'LLM re-ranking disabled',
        confidence: 1.0
      };
    }

    try {
      const rerankStartTime = Date.now();
      console.log(`🧠 [LLMReranker] Re-ranking ${request.candidates.length} results for query: "${request.query}"`);
      
      // Prepare the prompt for LLM re-ranking
      const prompt = this.buildRerankingPrompt(request);
      
      // Call the LLM API
      const response = await this.callLLMAPI(prompt, requestStartTime);
      
      // Parse the response and re-order results
      const rerankedResults = this.parseRerankingResponse(response, request.candidates, request.maxResults);
      
      const rerankDuration = Date.now() - rerankStartTime;
      console.log(`✅ [LLMReranker] Re-ranked to ${rerankedResults.length} results in ${rerankDuration}ms`);
      
      return {
        rerankedResults,
        reasoning: 'LLM-based relevance scoring',
        confidence: 0.9
      };
      
    } catch (error) {
      console.error(`❌ [LLMReranker] Re-ranking failed:`, error);
      
      // Fallback to original results on error
      return {
        rerankedResults: request.candidates.slice(0, request.maxResults),
        reasoning: `Re-ranking failed: ${error instanceof Error ? error.message : String(error)}`,
        confidence: 0.5
      };
    }
  }

  /**
   * Build the prompt for LLM re-ranking
   */
  private buildRerankingPrompt(request: LLMRerankerRequest): string {
    const candidates = request.candidates.map((result, index) => {
      const metadata = result.chunk.metadata;
      const snippet = result.snippet.length > 120 ? result.snippet.slice(0, 120) + '…' : result.snippet;
      
      // Extract fileKind from payload if available
      const fileKind = (result.chunk as any).fileKind || 
                      ((result.chunk.filePath.includes('.md') || 
                        result.chunk.filePath.includes('README') || 
                        result.chunk.filePath.includes('docs/') ||
                        result.chunk.filePath.includes('memory-bank/')) ? 'docs' : 'code');
      
      return `
CANDIDATE ${index + 1}:
File: ${result.chunk.filePath}
File Kind: ${fileKind} ${fileKind === 'code' ? '🔥 IMPLEMENTATION' : '📝 DOCUMENTATION'}
Type: ${result.chunk.chunkType}
Language: ${result.chunk.language}
Function: ${result.chunk.functionName || 'N/A'}
Class: ${result.chunk.className || 'N/A'}
Lines: ${result.chunk.startLine}-${result.chunk.endLine}
Similarity Score: ${result.score.toFixed(3)}
Is Test File: ${metadata.isTest ? 'Yes' : 'No'}
Code Snippet:
\`\`\`${result.chunk.language}
${snippet}
\`\`\`
`;
    }).join('\n');

    return `You are a code search expert specializing in finding IMPLEMENTATION CODE. Your task is to re-rank code search results based on their relevance to the user's query, with an EXTREME PREFERENCE for implementation code over documentation.

USER QUERY: "${request.query}"

SEARCH CANDIDATES:
${candidates}

CRITICAL RANKING RULES (in order of importance):
1. **🔥 IMPLEMENTATION FIRST**: Candidates marked "🔥 IMPLEMENTATION" (File Kind: code) should ALWAYS rank higher than "📝 DOCUMENTATION" candidates, even if documentation has higher similarity scores
2. **CODE ENTITY PRIORITY**: Candidates with chunkType 'function', 'class', 'method', 'interface' are premium - rank these at the top
3. **ACTUAL CODE RELEVANCE**: Analyze the code snippet for direct relevance to the query - look for matching function names, variable names, logic patterns
4. **IMPLEMENTATION OVER EXPLANATION**: A function that implements the behavior beats documentation that explains the behavior
5. **EXACT MATCHES WIN**: Exact function/class name matches should rank highest
6. **WORKING CODE**: Complete, compilable code snippets rank higher than partial or example code
7. **RECENT/ACTIVE FILES**: Non-test files (.ts, .js, .py) over test files when both are relevant

SCORING GUIDELINES:
- Start with "🔥 IMPLEMENTATION" candidates - these should dominate your ranking
- Only consider "📝 DOCUMENTATION" if no relevant implementation code exists
- A mediocre implementation function is better than perfect documentation
- Boost based on chunkType: function > class > method > interface > generic
- Penalize documentation files (.md, README, docs/) unless explicitly asking for docs

Expected JSON format:
{
  "rankedIndices": [2, 0, 4, 1],
  "explanation": "Ranked implementation code first: function X directly implements the query, class Y provides relevant structure..."
}

JSON Response:`;
  }

  /**
   * Call the LLM API for re-ranking
   */
  private async callLLMAPI(prompt: string, requestStartTime: number): Promise<string> {
    if (!this.apiKey) {
      throw new Error('No API key configured for LLM re-ranking');
    }
    // If a custom base URL is provided, treat as OpenAI-compatible gateway
    if (this.baseUrl) {
      return this.callOpenAIAPI(prompt, requestStartTime);
    }
    // Support different LLM providers based on model name when no custom base URL
    if (this.model.includes('claude')) {
      return this.callAnthropicAPI(prompt, requestStartTime);
    } else if (this.model.includes('gpt')) {
      return this.callOpenAIAPI(prompt, requestStartTime);
    } else {
      throw new Error(`Unsupported LLM model for re-ranking: ${this.model}`);
    }
  }

  /**
   * Call Anthropic Claude API with timeout
   */
  private async callAnthropicAPI(prompt: string, requestStartTime: number): Promise<string> {
    const controller = new AbortController();
    const remainingTime = this.timeoutMs - (Date.now() - requestStartTime);
    const timeoutMs = Math.max(1000, remainingTime);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      console.log(`[LLMReranker] Calling Anthropic API with timeout ${timeoutMs}ms...`);
      const apiCallStartTime = Date.now();
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
          max_tokens: 400,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
        }),
        signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
      const apiCallDuration = Date.now() - apiCallStartTime;
      console.log(`[LLMReranker] Anthropic API call completed in ${apiCallDuration}ms`);
      // Additional debug information to verify LangDB gateway output
      console.debug(`[LLMReranker] Anthropic raw response snippet: ${JSON.stringify(data).slice(0, 300)}...`);
      this.totalRequests++;
    return data.content[0].text;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Call OpenAI GPT API with timeout
   */
  private async callOpenAIAPI(prompt: string, requestStartTime: number): Promise<string> {
    const controller = new AbortController();
    const remainingTime = this.timeoutMs - (Date.now() - requestStartTime);
    const timeoutMs = Math.max(1000, remainingTime);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      console.log(`[LLMReranker] Calling OpenAI API with timeout ${timeoutMs}ms...`);
      const apiCallStartTime = Date.now();
    const endpoint = this.baseUrl ? `${this.baseUrl.replace(/\/?$/, '')}/chat/completions` : 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey!}`,
        'x-api-key': this.apiKey!
      },
      body: JSON.stringify({
        model: this.model,
          max_tokens: 400,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
        }),
        signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
      const apiCallDuration = Date.now() - apiCallStartTime;
      console.log(`[LLMReranker] OpenAI API call completed in ${apiCallDuration}ms`);
      // Additional debug information to verify LangDB gateway output
      console.debug(`[LLMReranker] OpenAI raw response snippet: ${JSON.stringify(data).slice(0, 300)}...`);
      this.totalRequests++;
    return data.choices[0].message.content;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse the LLM response and re-order results
   */
  private parseRerankingResponse(
    response: string, 
    candidates: SearchResult[], 
    maxResults: number
  ): SearchResult[] {
    try {
      // Extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const rankedIndices = parsed.rankedIndices as number[];

      if (!Array.isArray(rankedIndices)) {
        throw new Error('Invalid ranked indices format');
      }

      // Re-order results based on LLM ranking
      const rerankedResults: SearchResult[] = [];
      
      for (const index of rankedIndices.slice(0, maxResults)) {
        if (index >= 0 && index < candidates.length) {
          const result = { ...candidates[index] };
          // Store the original score and add re-ranking score
          result.rerankedScore = 1.0 - (rerankedResults.length * 0.1); // Decreasing score
          rerankedResults.push(result);
        }
      }

      // If we don't have enough results, fill with remaining candidates
      if (rerankedResults.length < maxResults) {
        const usedIndices = new Set(rankedIndices);
        for (let i = 0; i < candidates.length && rerankedResults.length < maxResults; i++) {
          if (!usedIndices.has(i)) {
            const result = { ...candidates[i] };
            result.rerankedScore = 0.5 - (rerankedResults.length * 0.05);
            rerankedResults.push(result);
          }
        }
      }

      return rerankedResults;

    } catch (error) {
      console.warn(`Failed to parse LLM re-ranking response: ${error}`);
      console.warn(`Response was: ${response}`);
      
      // Fallback to original order
      return candidates.slice(0, maxResults).map((result, _index) => ({
        ...result,
        rerankedScore: result.score * 0.9 // Slightly lower than original
      }));
    }
  }

  /**
   * Get re-ranking statistics
   */
  getStats(): {
    enabled: boolean;
    model: string;
    totalRequests: number;
    successRate: number;
    averageLatency: number;
  } {
    return {
      enabled: this.enabled,
      model: this.model,
      totalRequests: this.totalRequests,
      successRate: this.getErrorRate() === 0 ? 1 : 1 - (this.errorCount / this.totalRequests),
      averageLatency: this.getAverageLatency()
    };
  }
} 