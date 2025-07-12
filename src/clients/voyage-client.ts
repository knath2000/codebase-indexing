import axios, { AxiosInstance } from 'axios';
import { VoyageEmbeddingRequest, VoyageEmbeddingResponse } from '../types.js';

export class VoyageClient {
  private client: AxiosInstance;
  private baseURL: string = 'https://api.voyageai.com/v1';

  constructor(apiKey: string) {
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
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
      truncation: true
    };

    try {
      const response = await this.client.post<VoyageEmbeddingResponse>('/embeddings', request);
      
      if (!response.data.data || response.data.data.length === 0) {
        throw new Error('No embeddings returned from Voyage AI');
      }

      return response.data.data.map(item => item.embedding);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Voyage AI API Error Details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          headers: error.response?.headers,
          requestData: request,
          requestHeaders: this.client.defaults.headers
        });
        const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message;
        throw new Error(`Voyage AI API error (${error.response?.status}): ${errorMessage}`);
      }
      console.error('Non-Axios error in Voyage client:', error);
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
      console.log('Testing Voyage AI connection...');
      const result = await this.generateEmbedding('test connection', 'voyage-code-3');
      console.log('Voyage AI connection test successful, embedding dimension:', result.length);
      return true;
    } catch (error) {
      console.error('Voyage AI connection test failed:', error);
      return false;
    }
  }
} 