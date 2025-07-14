import { createHash } from 'crypto';
export class SearchCacheService {
    constructor(config) {
        this.cache = new Map();
        this.ttl = config.searchCacheTTL * 1000; // Convert to milliseconds
        this.maxSize = 1000; // Maximum number of cached queries
        this.hitCount = 0;
        this.missCount = 0;
        // Periodic cleanup of expired entries
        setInterval(() => this.cleanup(), this.ttl);
    }
    /**
     * Get cached search results if available and not expired
     */
    get(query) {
        const key = this.generateCacheKey(query);
        const cached = this.cache.get(key);
        if (!cached) {
            this.missCount++;
            return null;
        }
        // Check if cache entry has expired
        if (Date.now() - cached.timestamp.getTime() > this.ttl) {
            this.cache.delete(key);
            this.missCount++;
            return null;
        }
        this.hitCount++;
        console.log(`🎯 [SearchCache] Cache hit for query: "${query.query}"`);
        return cached.results;
    }
    /**
     * Store search results in cache
     */
    set(query, results) {
        // Don't cache empty results or very large result sets
        if (results.length === 0 || results.length > 100) {
            return;
        }
        const key = this.generateCacheKey(query);
        // Implement LRU eviction if cache is full
        if (this.cache.size >= this.maxSize) {
            this.evictOldest();
        }
        const cacheEntry = {
            query: query.query,
            queryHash: key,
            results: results.map(result => ({ ...result })), // Deep copy
            timestamp: new Date(),
            ttl: this.ttl,
            metadata: {
                ...(query.language && { language: query.language }),
                ...(query.chunkType && { chunkType: query.chunkType }),
                ...(query.filePath && { filePath: query.filePath })
            }
        };
        this.cache.set(key, cacheEntry);
        console.log(`💾 [SearchCache] Cached ${results.length} results for query: "${query.query}"`);
    }
    /**
     * Generate a unique cache key for a search query
     */
    generateCacheKey(query) {
        const keyData = {
            query: query.query.toLowerCase().trim(),
            language: query.language || '',
            chunkType: query.chunkType || '',
            filePath: query.filePath || '',
            limit: query.limit || 10,
            threshold: query.threshold || 0.7
        };
        const keyString = JSON.stringify(keyData);
        return createHash('md5').update(keyString).digest('hex');
    }
    /**
     * Evict the oldest cache entry (LRU)
     */
    evictOldest() {
        let oldestKey = null;
        let oldestTime = Date.now();
        for (const [key, entry] of this.cache) {
            if (entry.timestamp.getTime() < oldestTime) {
                oldestTime = entry.timestamp.getTime();
                oldestKey = key;
            }
        }
        if (oldestKey) {
            this.cache.delete(oldestKey);
            console.log(`🗑️ [SearchCache] Evicted oldest cache entry`);
        }
    }
    /**
     * Clean up expired cache entries
     */
    cleanup() {
        const now = Date.now();
        const keysToDelete = [];
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp.getTime() > this.ttl) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.cache.delete(key));
        if (keysToDelete.length > 0) {
            console.log(`🧹 [SearchCache] Cleaned up ${keysToDelete.length} expired cache entries`);
        }
    }
    /**
     * Invalidate cache entries for a specific file (when file is modified)
     */
    invalidateFile(filePath) {
        const keysToDelete = [];
        for (const [key, entry] of this.cache) {
            // Check if any cached results are from the modified file
            const hasFileResults = entry.results.some(result => result.chunk.filePath === filePath);
            if (hasFileResults || entry.metadata.filePath === filePath) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.cache.delete(key));
        if (keysToDelete.length > 0) {
            console.log(`🔄 [SearchCache] Invalidated ${keysToDelete.length} cache entries for file: ${filePath}`);
        }
    }
    /**
     * Invalidate cache entries for a specific language
     */
    invalidateLanguage(language) {
        const keysToDelete = [];
        for (const [key, entry] of this.cache) {
            if (entry.metadata.language === language) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.cache.delete(key));
        if (keysToDelete.length > 0) {
            console.log(`🔄 [SearchCache] Invalidated ${keysToDelete.length} cache entries for language: ${language}`);
        }
    }
    /**
     * Clear all cache entries
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.hitCount = 0;
        this.missCount = 0;
        console.log(`🗑️ [SearchCache] Cleared ${size} cache entries`);
    }
    /**
     * Get current size of the cache (number of entries)
     */
    size() {
        return this.cache.size;
    }
    /**
     * Get estimated memory usage of the cache in bytes
     */
    memoryUsage() {
        // This is a rough estimate. A more accurate measure would involve
        // deep-inspecting object sizes, which is complex in JavaScript.
        // Assume an average entry size for estimation.
        const averageEntrySizeEstimate = 2000; // 2KB per entry, based on typical SearchResult complexity
        return this.cache.size * averageEntrySizeEstimate;
    }
    /**
     * Get cache statistics
     */
    getStats() {
        const hitRate = this.hitCount + this.missCount > 0
            ? this.hitCount / (this.hitCount + this.missCount)
            : 0;
        // Rough estimate of memory usage
        const memoryUsage = this.cache.size * 1024; // Assume ~1KB per entry
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRate: Math.round(hitRate * 100) / 100,
            ttl: this.ttl / 1000, // Convert back to seconds
            memoryUsage
        };
    }
    /**
     * Get cache entries for debugging
     */
    getEntries() {
        const now = Date.now();
        const entries = [];
        for (const [key, entry] of this.cache) {
            entries.push({
                key,
                query: entry.query,
                resultCount: entry.results.length,
                age: Math.round((now - entry.timestamp.getTime()) / 1000),
                metadata: entry.metadata
            });
        }
        return entries.sort((a, b) => a.age - b.age);
    }
    /**
     * Warm up the cache with common queries
     */
    async warmUp(commonQueries) {
        console.log(`🔥 [SearchCache] Warming up cache with ${commonQueries.length} common queries`);
        // This would typically be called with a search service instance
        // For now, we just log the intent
        for (const query of commonQueries) {
            console.log(`🔥 [SearchCache] Would warm up: "${query}"`);
        }
    }
    /**
     * Check if a query is likely to benefit from caching
     */
    shouldCache(query, results) {
        // Don't cache very specific queries (likely one-time searches)
        if (query.filePath) {
            return false;
        }
        // Don't cache empty results
        if (results.length === 0) {
            return false;
        }
        // Don't cache very large result sets (memory intensive)
        if (results.length > 100) {
            return false;
        }
        // Don't cache very short queries (likely typos or incomplete)
        if (query.query.trim().length < 3) {
            return false;
        }
        return true;
    }
}
