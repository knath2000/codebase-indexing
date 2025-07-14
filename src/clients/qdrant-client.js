import { QdrantClient } from '@qdrant/js-client-rest';
export class QdrantVectorClient {
    constructor(url, apiKey, collectionName, embeddingDimension, keywordTimeoutMs = 10000, keywordMaxChunks = 20000) {
        this.requestDurations = []; // To store last N request durations
        this.maxDurationsToStore = 100; // Store up to 100 durations
        this.url = url;
        this.apiKey = apiKey;
        this.collectionName = collectionName;
        this.embeddingDimension = embeddingDimension;
        const clientOptions = this.apiKey ? { url: this.url, apiKey: this.apiKey } : { url: this.url };
        this.client = new QdrantClient(clientOptions);
        this.keywordTimeoutMs = keywordTimeoutMs;
        this.keywordMaxChunks = keywordMaxChunks;
    }
    /**
     * Initialize the collection with proper schema
     */
    async initializeCollection() {
        try {
            // Check if collection exists
            const collections = await this.client.getCollections();
            const collectionExists = collections.collections.some(col => col.name === this.collectionName);
            if (!collectionExists) {
                await this.client.createCollection(this.collectionName, {
                    vectors: {
                        size: this.embeddingDimension,
                        distance: 'Cosine'
                    }
                });
                console.log(`Created collection: ${this.collectionName}`);
                // Create payload indexes for filtering capabilities
                await this.createPayloadIndexes();
            }
            else {
                // Check if existing collection has correct dimensions
                const collectionInfo = await this.client.getCollection(this.collectionName);
                const existingDimensions = collectionInfo.config?.params?.vectors?.size;
                if (existingDimensions !== this.embeddingDimension) {
                    console.log(`⚠️  Collection exists but has wrong dimensions: ${existingDimensions}, expected: ${this.embeddingDimension}`);
                    console.log(`🔄 Recreating collection with correct dimensions...`);
                    await this.recreateCollection();
                }
                else {
                    console.log(`✅ Collection exists with correct dimensions: ${this.embeddingDimension}`);
                    // Ensure payload indexes exist (idempotent operation)
                    await this.createPayloadIndexes();
                }
            }
        }
        catch (error) {
            throw new Error(`Failed to initialize collection: ${error}`);
        }
    }
    /**
     * Recreate the collection with correct dimensions (deletes all existing data)
     */
    async recreateCollection() {
        try {
            console.log(`🗑️  Deleting existing collection: ${this.collectionName}`);
            // Delete existing collection
            try {
                await this.client.deleteCollection(this.collectionName);
                console.log(`✅ Deleted existing collection`);
            }
            catch (deleteError) {
                console.log(`⚠️  Collection deletion failed (might not exist): ${deleteError}`);
            }
            // Wait a moment for deletion to complete
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Create new collection with correct dimensions
            console.log(`🎯 Creating new collection with ${this.embeddingDimension} dimensions`);
            await this.client.createCollection(this.collectionName, {
                vectors: {
                    size: this.embeddingDimension,
                    distance: 'Cosine'
                }
            });
            console.log(`✅ Successfully recreated collection: ${this.collectionName}`);
            // Create payload indexes for filtering capabilities
            await this.createPayloadIndexes();
        }
        catch (error) {
            throw new Error(`Failed to recreate collection: ${error}`);
        }
    }
    /**
     * Create payload indexes for filtering capabilities (matching Cursor's @codebase functionality)
     */
    async createPayloadIndexes() {
        console.log(`🔧 [Qdrant] Creating payload indexes for enhanced filtering...`);
        try {
            // Index for chunkType filtering (function, class, interface, etc.)
            await this.client.createPayloadIndex(this.collectionName, {
                field_name: 'chunkType',
                field_schema: 'keyword'
            });
            console.log(`✅ [Qdrant] Created chunkType index for filtering by code elements`);
            // Index for language filtering (typescript, javascript, etc.)
            await this.client.createPayloadIndex(this.collectionName, {
                field_name: 'language',
                field_schema: 'keyword'
            });
            console.log(`✅ [Qdrant] Created language index for filtering by programming language`);
            // Index for filePath filtering
            await this.client.createPayloadIndex(this.collectionName, {
                field_name: 'filePath',
                field_schema: 'keyword'
            });
            console.log(`✅ [Qdrant] Created filePath index for file-specific searches`);
            // Index for fileKind filtering (code vs docs)
            await this.client.createPayloadIndex(this.collectionName, {
                field_name: 'fileKind',
                field_schema: 'keyword'
            });
            console.log(`✅ [Qdrant] Created fileKind index for distinguishing code vs documentation`);
            console.log(`🎉 [Qdrant] All payload indexes created successfully - collection ready for @codebase-style filtered searches!`);
        }
        catch (error) {
            // Check if indexes already exist (this is not an error)
            const errorMsg = String(error).toLowerCase();
            if (errorMsg.includes('already exists') || errorMsg.includes('conflict')) {
                console.log(`ℹ️  [Qdrant] Payload indexes already exist, skipping creation`);
            }
            else {
                console.error(`❌ [Qdrant] Failed to create payload indexes:`, error);
                throw new Error(`Failed to create payload indexes: ${error}`);
            }
        }
    }
    /**
     * Create payload indexes on existing collection (useful for upgrading existing collections)
     */
    async ensurePayloadIndexes() {
        console.log(`🔧 [Qdrant] Ensuring payload indexes exist for collection: ${this.collectionName}`);
        await this.createPayloadIndexes();
    }
    /**
     * Store embedding vectors in Qdrant
     */
    async storeEmbeddings(embeddings) {
        console.log(`🚀 [Qdrant] Starting to store ${embeddings.length} embeddings`);
        try {
            // Test connection first
            console.log(`🔗 [Qdrant] Testing connection before storage...`);
            const isConnected = await this.testConnection();
            if (!isConnected) {
                throw new Error('Qdrant connection test failed');
            }
            console.log(`✅ [Qdrant] Connection test successful`);
            // Log collection info
            console.log(`📊 [Qdrant] Getting collection info...`);
            const collectionInfo = await this.getCollectionInfo();
            console.log(`📊 [Qdrant] Collection info:`, {
                name: collectionInfo.config?.params?.vectors?.size || 'unknown',
                points: collectionInfo.points_count || 0,
                status: collectionInfo.status || 'unknown'
            });
            // Prepare points data
            console.log(`🔄 [Qdrant] Preparing ${embeddings.length} points for upsert...`);
            const points = embeddings.map((embedding, index) => {
                if (index === 0) {
                    // Log first embedding structure for debugging
                    console.log(`📝 [Qdrant] First embedding structure:`, {
                        id: embedding.id,
                        vectorLength: embedding.vector?.length || 0,
                        payloadKeys: Object.keys(embedding.payload || {}),
                        payloadPreview: {
                            filePath: embedding.payload?.filePath || 'missing',
                            chunkType: embedding.payload?.chunkType || 'missing',
                            startLine: embedding.payload?.startLine || 'missing'
                        }
                    });
                }
                return {
                    id: embedding.id,
                    vector: embedding.vector,
                    payload: embedding.payload
                };
            });
            console.log(`💾 [Qdrant] Calling upsert with wait=false...`);
            const startTime = Date.now();
            // Change wait to false to avoid timeouts, and add timeout handling
            const upsertPromise = this.client.upsert(this.collectionName, {
                wait: false, // Don't wait for indexing to complete
                points
            });
            // Add manual timeout
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Upsert operation timed out after 30 seconds')), 30000);
            });
            await Promise.race([upsertPromise, timeoutPromise]);
            const duration = Date.now() - startTime;
            console.log(`✅ [Qdrant] Upsert completed successfully in ${duration}ms`);
            // Verify points were stored
            console.log(`🔍 [Qdrant] Verifying storage...`);
            const updatedInfo = await this.getCollectionInfo();
            console.log(`📊 [Qdrant] Updated collection points count: ${updatedInfo.points_count || 0}`);
        }
        catch (error) {
            console.error(`❌ [Qdrant] Storage failed:`, error);
            throw new Error(`Failed to store embeddings: ${error}`);
        }
    }
    /**
     * Store a single embedding vector
     */
    async storeEmbedding(embedding) {
        return this.storeEmbeddings([embedding]);
    }
    /**
     * Search for similar vectors with enhanced error handling and logging
     */
    async searchSimilar(query, queryVector) {
        console.log(`🔍 [Qdrant] Starting search with query: "${query.query}"`);
        console.log(`🔍 [Qdrant] Search parameters:`, {
            limit: query.limit || 50, // Increased from 10 to 50 for better coverage
            threshold: query.threshold ?? 0.25,
            language: query.language,
            filePath: query.filePath,
            chunkType: query.chunkType,
            vectorLength: queryVector.length
        });
        try {
            // Validate input parameters
            if (!queryVector || queryVector.length === 0) {
                throw new Error('Query vector is empty or invalid');
            }
            if (queryVector.length !== this.embeddingDimension) {
                throw new Error(`Query vector dimension mismatch: expected ${this.embeddingDimension}, got ${queryVector.length}`);
            }
            const searchParams = {
                vector: queryVector,
                limit: query.limit || 50, // Increased from 10 to 50 for better coverage
                score_threshold: query.threshold ?? 0.25,
                with_payload: true,
                with_vector: false
            };
            // Build filters based on query parameters
            const filterConditions = [];
            if (query.language) {
                filterConditions.push({ key: 'language', match: { value: query.language } });
                console.log(`🔍 [Qdrant] Adding language filter: ${query.language}`);
            }
            if (query.filePath) {
                filterConditions.push({ key: 'filePath', match: { value: query.filePath } });
                console.log(`🔍 [Qdrant] Adding file path filter: ${query.filePath}`);
            }
            if (query.chunkType) {
                filterConditions.push({ key: 'chunkType', match: { value: query.chunkType } });
                console.log(`🔍 [Qdrant] Adding chunk type filter: ${query.chunkType}`);
            }
            // Add fileKind filter when preferImplementation is true
            if (query.preferImplementation === true) {
                filterConditions.push({ key: 'fileKind', match: { value: 'code' } });
                console.log(`🔍 [Qdrant] Adding fileKind filter: code (prefer implementation)`);
            }
            if (filterConditions.length > 0) {
                searchParams.filter = { must: filterConditions };
                console.log(`🔍 [Qdrant] Applied ${filterConditions.length} filter(s)`);
            }
            console.log(`🔍 [Qdrant] Executing search in collection: ${this.collectionName}`);
            const searchResult = await this.client.search(this.collectionName, searchParams);
            console.log(`✅ [Qdrant] Search completed successfully, found ${searchResult.length} results`);
            const results = searchResult.map(result => {
                const chunk = this.payloadToCodeChunk(result.payload);
                chunk.id = result.id; // Set the ID from the search result
                return {
                    id: result.id,
                    score: result.score,
                    chunk,
                    snippet: this.createSnippet(result.payload),
                    context: this.createContextDescription(result.payload)
                };
            });
            console.log(`🔍 [Qdrant] Returning ${results.length} processed results`);
            return results;
        }
        catch (error) {
            console.error(`❌ [Qdrant] Search failed:`, error);
            if (error instanceof Error) {
                // Enhance error message with more context
                throw new Error(`Qdrant search failed: ${error.message} (Collection: ${this.collectionName}, Query: "${query.query}")`);
            }
            throw new Error(`Qdrant search failed: ${String(error)}`);
        }
    }
    /**
     * Perform a simple keyword-based search across all indexed chunks.
     * This provides a lightweight BM25-style sparse retrieval fallback that can be
     * blended with dense semantic search results for higher accuracy – similar to
     * Cursor's hybrid search pipeline.
     *
     * NOTE: This implementation scrolls the entire collection once and performs
     * in-memory scoring. For typical source-code repositories (a few thousand
     * chunks) this is fast enough and keeps the implementation dependency-free.
     * If the collection grows large, consider replacing this with Qdrant's
     * full-text payload index once it becomes generally available.
     */
    async keywordSearch(query) {
        const searchText = query.query.toLowerCase();
        if (!searchText.trim()) {
            return [];
        }
        const startTime = Date.now();
        let scanned = 0;
        // Collect all chunks (streaming in pages of 1000) – this is OK for <50k chunks
        const pageLimit = 1000;
        let offset = undefined;
        const allPoints = [];
        try {
            do {
                const page = await this.client.scroll(this.collectionName, {
                    with_payload: true,
                    with_vector: false,
                    limit: pageLimit,
                    offset: offset ?? null
                });
                page.points.forEach(point => {
                    allPoints.push({ id: point.id, payload: point.payload });
                });
                scanned += page.points.length;
                if (Date.now() - startTime > this.keywordTimeoutMs) {
                    console.warn(`[Qdrant] keywordSearch timeout after ${this.keywordTimeoutMs} ms, stopping scroll early (scanned ${scanned} points)`);
                    break;
                }
                if (scanned >= this.keywordMaxChunks) {
                    console.warn(`[Qdrant] keywordSearch reached max chunk limit (${this.keywordMaxChunks}), stopping scroll`);
                    break;
                }
                offset = page.next_page_offset;
            } while (offset !== undefined);
        }
        catch (error) {
            console.error('[Qdrant] keywordSearch scroll failed:', error);
            return [];
        }
        // Score and sort results by relevance
        const scoredResults = allPoints
            .map(point => {
            const chunk = this.payloadToCodeChunk(point.payload);
            chunk.id = String(point.id);
            return {
                point,
                chunk,
                score: this.calculateKeywordScore(searchText, point.payload.content)
            };
        })
            .filter(result => {
            // Apply score threshold
            if (result.score <= (query.threshold ?? 0.25)) {
                return false;
            }
            // Apply preferImplementation filter
            if (query.preferImplementation === true && result.point.payload.fileKind !== 'code') {
                return false;
            }
            // Apply other query filters
            if (query.language && result.point.payload.language !== query.language) {
                return false;
            }
            if (query.chunkType && result.point.payload.chunkType !== query.chunkType) {
                return false;
            }
            if (query.filePath && result.point.payload.filePath !== query.filePath) {
                return false;
            }
            return true;
        })
            .sort((a, b) => b.score - a.score)
            .slice(0, query.limit || 50); // Use consistent limit
        const results = scoredResults.map(result => ({
            id: String(result.point.id),
            score: result.score,
            chunk: result.chunk,
            snippet: this.createSnippet(result.point.payload),
            context: this.createContextDescription(result.point.payload)
        }));
        return results;
    }
    /**
     * Delete embeddings by file path
     */
    async deleteByFilePath(filePath) {
        try {
            await this.client.delete(this.collectionName, {
                filter: {
                    must: [{ key: 'filePath', match: { value: filePath } }]
                }
            });
        }
        catch (error) {
            throw new Error(`Failed to delete embeddings for file ${filePath}: ${error}`);
        }
    }
    /**
     * Delete embeddings by IDs
     */
    async deleteByIds(ids) {
        try {
            await this.client.delete(this.collectionName, {
                points: ids
            });
        }
        catch (error) {
            throw new Error(`Failed to delete embeddings by IDs: ${error}`);
        }
    }
    /**
     * Get collection info and stats
     */
    async getCollectionInfo() {
        try {
            return await this.client.getCollection(this.collectionName);
        }
        catch (error) {
            throw new Error(`Failed to get collection info: ${error}`);
        }
    }
    /**
     * Count total points in collection
     */
    async countPoints() {
        try {
            const info = await this.getCollectionInfo();
            return info.points_count || 0;
        }
        catch (error) {
            throw new Error(`Failed to count points: ${error}`);
        }
    }
    /**
     * Clear all data from collection
     */
    async clearCollection() {
        try {
            await this.client.delete(this.collectionName, {
                filter: { must: [] }
            });
        }
        catch (error) {
            throw new Error(`Failed to clear collection: ${error}`);
        }
    }
    /**
     * Get points by their IDs
     */
    async getPointsById(ids) {
        try {
            const response = await this.client.retrieve(this.collectionName, {
                ids: ids,
                with_payload: true,
                with_vector: true,
            });
            return response;
        }
        catch (error) {
            console.error(`❌ [Qdrant] Failed to retrieve points by ID:`, error);
            throw new Error(`Qdrant getPointsById failed: ${String(error)}`);
        }
    }
    /**
     * Get average request latency for Qdrant client
     */
    getAverageLatency() {
        if (this.requestDurations.length === 0) {
            return 0;
        }
        const sum = this.requestDurations.reduce((a, b) => a + b, 0);
        return sum / this.requestDurations.length;
    }
    /**
     * Test connection to Qdrant
     */
    async testConnection() {
        try {
            const startTime = Date.now();
            await this.client.getCollections();
            const duration = Date.now() - startTime;
            this.addRequestDuration(duration);
            return true;
        }
        catch (error) {
            console.error('Qdrant connection test failed:', error);
            return false;
        }
    }
    addRequestDuration(duration) {
        this.requestDurations.push(duration);
        if (this.requestDurations.length > this.maxDurationsToStore) {
            this.requestDurations.shift(); // Remove the oldest duration
        }
    }
    /**
     * Get embeddings by file path
     */
    async getEmbeddingsByFilePath(filePath) {
        try {
            const searchResult = await this.client.scroll(this.collectionName, {
                filter: {
                    must: [{ key: 'filePath', match: { value: filePath } }]
                },
                limit: 1000,
                with_payload: true,
                with_vector: true
            });
            return searchResult.points.map(point => ({
                id: point.id,
                vector: point.vector,
                payload: point.payload
            }));
        }
        catch (error) {
            throw new Error(`Failed to get embeddings for file ${filePath}: ${error}`);
        }
    }
    /**
     * Check if file is already indexed
     */
    async isFileIndexed(filePath, lastModified) {
        try {
            const searchResult = await this.client.scroll(this.collectionName, {
                filter: {
                    must: [
                        { key: 'filePath', match: { value: filePath } },
                        { key: 'metadata.lastModified', match: { value: lastModified } }
                    ]
                },
                limit: 1
            });
            return searchResult.points.length > 0;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Convert payload to CodeChunk
     */
    payloadToCodeChunk(payload) {
        return {
            id: '', // Will be set by the calling function
            content: payload.content,
            filePath: payload.filePath,
            language: payload.language,
            startLine: payload.startLine,
            endLine: payload.endLine,
            chunkType: payload.chunkType,
            functionName: payload.functionName,
            className: payload.className,
            moduleName: payload.moduleName,
            contentHash: payload.contentHash,
            metadata: payload.metadata
        };
    }
    /**
     * Create a snippet from the payload
     */
    createSnippet(payload) {
        const lines = payload.content.split('\n');
        const maxLines = 5;
        if (lines.length <= maxLines) {
            return payload.content;
        }
        const snippet = lines.slice(0, maxLines).join('\n');
        return snippet + '\n...';
    }
    /**
     * Create a context description for search results (similar to Cursor's @codebase format)
     */
    createContextDescription(payload) {
        const parts = [];
        // Add file path (relative format)
        const filePath = payload.filePath.startsWith('/app/')
            ? payload.filePath.substring(5)
            : payload.filePath;
        parts.push(`📁 ${filePath}`);
        // Add line range
        if (payload.startLine && payload.endLine) {
            parts.push(`📍 Lines ${payload.startLine}-${payload.endLine}`);
        }
        // Add function/class name if available
        if (payload.functionName) {
            parts.push(`🔧 Function: ${payload.functionName}`);
        }
        else if (payload.className) {
            parts.push(`📦 Class: ${payload.className}`);
        }
        else if (payload.moduleName) {
            parts.push(`📂 Module: ${payload.moduleName}`);
        }
        // Add chunk type
        parts.push(`🏷️  Type: ${payload.chunkType}`);
        // Add language
        parts.push(`💻 ${payload.language}`);
        return parts.join(' | ');
    }
    /**
     * Calculate keyword score for keyword search.
     * This is a very basic TF-IDF-like scoring.
     * For a real-world application, you'd need a proper tokenizer, stopwords,
     * and a more sophisticated scoring mechanism.
     */
    calculateKeywordScore(query, content) {
        const tokens = query.split(/\s+/).filter(Boolean);
        let score = 0;
        for (const token of tokens) {
            const occurrences = content.split(token).length - 1;
            score += occurrences;
        }
        return score;
    }
}
