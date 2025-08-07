import axios from 'axios';
export class VoyageClient {
    constructor(apiKey) {
        this.baseURL = 'https://api.voyageai.com/v1';
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
    async generateEmbeddings(input, model = 'voyage-code-3', inputType = 'document') {
        const request = {
            input,
            model,
            input_type: inputType,
            truncation: true,
            output_dimension: this.getEmbeddingDimension(model) // Specify the dimension we want
        };
        try {
            const response = await this.client.post('/embeddings', request);
            if (!response.data.data || response.data.data.length === 0) {
                throw new Error('No embeddings returned from Voyage AI');
            }
            return response.data.data.map(item => item.embedding);
        }
        catch (error) {
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
    async generateEmbedding(text, model = 'voyage-code-3', inputType = 'document') {
        const embeddings = await this.generateEmbeddings(text, model, inputType);
        return embeddings[0];
    }
    /**
     * Generate embeddings in batches for large inputs
     */
    async generateEmbeddingsBatch(texts, model = 'voyage-code-3', inputType = 'document', batchSize = 100) {
        const results = [];
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
    getEmbeddingDimension(model) {
        const modelDimensions = {
            'voyage-code-3': 2048, // Updated to 2048 dimensions per Voyage AI docs
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
    async testConnection() {
        try {
            console.log('Testing Voyage AI connection...');
            const result = await this.generateEmbedding('test connection', 'voyage-code-3');
            console.log('Voyage AI connection test successful, embedding dimension:', result.length);
            return true;
        }
        catch (error) {
            console.error('Voyage AI connection test failed:', error);
            return false;
        }
    }
}
