import axios, { AxiosInstance } from 'axios';
import { VoyageEmbeddingRequest, VoyageEmbeddingResponse } from '../types.js';
import { createModuleLogger } from '../logging/logger.js'

export class VoyageClient {
  private client: AxiosInstance;
  private baseURL: string;
  private readonly log = createModuleLogger('voyage-client')

  constructor(apiKey: string) {
    this.baseURL = process.env.VOYAGE_API_BASE_URL || 'https://api.voyageai.com/v1'
    const timeoutMs = parseInt(process.env.VOYAGE_TIMEOUT_MS || '', 10) || 30000
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });
  }

  /**
   * Generate embeddings for a single text or array of texts
   */
  async generateEmbeddings(
    input: string | string[],
    model: string = 'voyage-code-3',
    inputType: 'query' | 'document' = 'document'
  ): Promise<number[][]> {
    const request: VoyageEmbeddingRequest = {
      input,
      model,
      input_type: inputType,
      truncation: true,
      output_dimension: this.getEmbeddingDimension(model)  // Specify the dimension we want
    };

    const start = Date.now()
    try {
      const response = await this.client.post<VoyageEmbeddingResponse>('/embeddings', request);
      
      if (!response.data.data || response.data.data.length === 0) {
        throw new Error('No embeddings returned from Voyage AI');
      }

      const embeddings = response.data.data.map(item => item.embedding);
      this.log.debug({ model, inputType, count: Array.isArray(input) ? input.length : 1, ms: Date.now() - start }, 'Voyage embeddings OK')
      return embeddings;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.log.warn({
          status: error.response?.status,
          statusText: error.response?.statusText,
          code: error.code,
          ms: Date.now() - start,
          model,
          inputType
        }, 'Voyage embeddings error')
        const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
        throw new Error(`Voyage AI API error (${error.response?.status}): ${errorMessage}`);
      }
      this.log.error({ err: error }, 'Non-Axios error in Voyage client');
      throw error;
    }
  }

  /**
   * Generate a single embedding for a text
   */
  async generateEmbedding(
    text: string,
    model: string = 'voyage-code-3',
    inputType: 'query' | 'document' = 'document'
  ): Promise<number[]> {
    const embeddings = await this.generateEmbeddings(text, model, inputType);
    return embeddings[0];
  }

  /**
   * Generate embeddings in batches for large inputs
   */
  async generateEmbeddingsBatch(
    texts: string[],
    model: string = 'voyage-code-3',
    inputType: 'query' | 'document' = 'document',
    batchSize: number = 100
  ): Promise<number[][]> {
    const results: number[][] = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await this.generateEmbeddings(batch, model, inputType);
      results.push(...batchEmbeddings);
      
      // Add a small delay to avoid rate limiting
      if (i + batchSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }

  /**
   * Get embedding dimension for a model
   */
  getEmbeddingDimension(model: string): number {
    const modelDimensions: Record<string, number> = {
      'voyage-code-3': 2048,  // Updated to 2048 dimensions per Voyage AI docs
      'voyage-3.5': 1024,
      'voyage-3-large': 1024,
      'voyage-code-2': 1536,
      'voyage-2': 1024,
      'voyage-large-2': 1536,
      'voyage-3': 1024,
      'voyage-multimodal-3': 1024
    };
    
    return modelDimensions[model] || 1024;
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      this.log.info('Testing Voyage AI connection...')
      const result = await this.generateEmbedding('test connection', 'voyage-code-3');
      this.log.info({ dim: result.length }, 'Voyage AI connection test successful')
      return true;
    } catch (error) {
      this.log.error({ err: error }, 'Voyage AI connection test failed')
      return false;
    }
  }
} 