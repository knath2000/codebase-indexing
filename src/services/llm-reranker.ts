import { SearchResult, LLMRerankerRequest, LLMRerankerResponse, Config } from '../types.js';

export class LLMRerankerService {
  private apiKey: string | undefined;
  private model: string;
  private enabled: boolean;

  constructor(config: Config) {
    this.apiKey = config.llmRerankerApiKey || undefined;
    this.model = config.llmRerankerModel;
    this.enabled = config.enableLLMReranking && !!this.apiKey;
    
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
   * Re-rank search results using LLM for improved relevance
   */
  async rerank(request: LLMRerankerRequest): Promise<LLMRerankerResponse> {
    if (!this.enabled) {
      // Return original results if re-ranking is disabled
      return {
        rerankedResults: request.candidates.slice(0, request.maxResults),
        reasoning: 'LLM re-ranking disabled',
        confidence: 1.0
      };
    }

    try {
      console.log(`🧠 [LLMReranker] Re-ranking ${request.candidates.length} results for query: "${request.query}"`);
      
      // Prepare the prompt for LLM re-ranking
      const prompt = this.buildRerankingPrompt(request);
      
      // Call the LLM API
      const response = await this.callLLMAPI(prompt);
      
      // Parse the response and re-order results
      const rerankedResults = this.parseRerankingResponse(response, request.candidates, request.maxResults);
      
      console.log(`✅ [LLMReranker] Re-ranked to ${rerankedResults.length} results`);
      
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
      return `
CANDIDATE ${index + 1}:
File: ${result.chunk.filePath}
Type: ${result.chunk.chunkType}
Language: ${result.chunk.language}
Function: ${result.chunk.functionName || 'N/A'}
Class: ${result.chunk.className || 'N/A'}
Lines: ${result.chunk.startLine}-${result.chunk.endLine}
Similarity Score: ${result.score.toFixed(3)}
Is Test File: ${metadata.isTest ? 'Yes' : 'No'}
Code Snippet:
\`\`\`${result.chunk.language}
${result.snippet}
\`\`\`
`;
    }).join('\n');

    return `You are a code search expert. Your task is to re-rank code search results based on their relevance to the user's query.

USER QUERY: "${request.query}"

SEARCH CANDIDATES:
${candidates}

INSTRUCTIONS:
1. Analyze each candidate's relevance to the query
2. Consider code context, function/class names, and actual implementation
3. Prioritize exact matches over partial matches
4. Consider code quality and completeness
5. Return a JSON array with candidate indices in order of relevance (most relevant first)
6. Include only the top ${request.maxResults} most relevant candidates
7. Provide a brief explanation for your ranking

Expected JSON format:
{
  "rankedIndices": [2, 0, 4, 1],
  "explanation": "Ranked based on direct relevance to query..."
}

JSON Response:`;
  }

  /**
   * Call the LLM API for re-ranking
   */
  private async callLLMAPI(prompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('No API key configured for LLM re-ranking');
    }

    // Support different LLM providers based on model name
    if (this.model.includes('claude')) {
      return this.callAnthropicAPI(prompt);
    } else if (this.model.includes('gpt')) {
      return this.callOpenAIAPI(prompt);
    } else {
      throw new Error(`Unsupported LLM model for re-ranking: ${this.model}`);
    }
  }

  /**
   * Call Anthropic Claude API
   */
  private async callAnthropicAPI(prompt: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1000,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    return data.content[0].text;
  }

  /**
   * Call OpenAI GPT API
   */
  private async callOpenAIAPI(prompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey!}`
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1000,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    return data.choices[0].message.content;
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
      totalRequests: 0, // TODO: Implement request tracking
      successRate: 0.95, // TODO: Implement success tracking
      averageLatency: 500 // TODO: Implement latency tracking
    };
  }
} 