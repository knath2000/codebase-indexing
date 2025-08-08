import { SearchResult, SearchQuery, SearchCache, Config } from '../types.js';
import { createHash } from 'crypto';
import { createModuleLogger } from '../logging/logger.js'

export class SearchCacheService {
  private cache: Map<string, SearchCache>;
  private lruList: Map<string, number>; // key -> lastAccessTs
  private ttl: number;
  private maxSize: number;
  private hitCount: number;
  private missCount: number;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly log = createModuleLogger('search-cache')

  constructor(config: Config) {
    this.cache = new Map();
    this.lruList = new Map();
    this.ttl = (config.searchCacheTTL ?? 300) * 1000; // ms
    this.maxSize = (config as any).searchCacheMaxSize ?? 500;
    this.hitCount = 0;
    this.missCount = 0;
  }

  start(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => this.cleanup(), this.ttl)
    this.log.info({ ttlMs: this.ttl, maxSize: this.maxSize }, 'Search cache started')
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
      this.log.info('Search cache stopped')
    }
    this.clear()
  }

  /**
   * Get cached search results if available and not expired
   */
  get(query: SearchQuery): SearchResult[] | null {
    const key = this.generateCacheKey(query);
    const cached = this.cache.get(key);

    if (!cached) {
      this.missCount++;
      return null;
    }

    // Check if cache entry has expired
    if (Date.now() - cached.timestamp.getTime() > this.ttl) {
      this.cache.delete(key);
      this.lruList.delete(key)
      this.missCount++;
      return null;
    }

    this.hitCount++;
    this.touch(key)
    this.log.debug({ query: query.query }, 'Cache hit');
    return cached.results;
  }

  /**
   * Store search results in cache
   */
  set(query: SearchQuery, results: SearchResult[]): void {
    // Don't cache empty results or very large result sets
    if (results.length === 0 || results.length > 100) {
      return;
    }

    const key = this.generateCacheKey(query);
    // True LRU eviction
    if (this.cache.size >= this.maxSize) this.evictLRU()

    const cacheEntry: SearchCache = {
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
    this.touch(key)
    this.log.debug({ query: query.query, count: results.length }, 'Cached results');
  }

  /**
   * Generate a unique cache key for a search query
   */
  private generateCacheKey(query: SearchQuery): string {
    const keyData = {
      query: query.query.toLowerCase().trim(),
      language: query.language ?? '',
      chunkType: query.chunkType ?? '',
      filePath: query.filePath ?? '',
      limit: query.limit ?? 10,
      threshold: query.threshold ?? 0.7
    };

    const keyString = JSON.stringify(keyData);
    return createHash('md5').update(keyString).digest('hex');
  }

  /**
   * Evict the oldest cache entry (LRU)
   */
  private evictLRU(): void {
    // Find least-recently-used by lastAccess timestamp
    let lruKey: string | undefined
    let lruTs = Infinity
    for (const [key, ts] of this.lruList.entries()) {
      if (ts < lruTs) { lruTs = ts; lruKey = key }
    }
    if (lruKey) {
      this.cache.delete(lruKey)
      this.lruList.delete(lruKey)
      this.log.debug({ key: lruKey }, 'Evicted LRU entry')
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp.getTime() > this.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => { this.cache.delete(key); this.lruList.delete(key) });

    if (keysToDelete.length > 0) this.log.debug({ count: keysToDelete.length }, 'Cleaned expired entries')
  }

  /**
   * Invalidate cache entries for a specific file (when file is modified)
   */
  invalidateFile(filePath: string): void {
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      // Check if any cached results are from the modified file
      const hasFileResults = entry.results.some(result => 
        result.chunk.filePath === filePath
      );

      if (hasFileResults || entry.metadata.filePath === filePath) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    if (keysToDelete.length > 0) this.log.debug({ count: keysToDelete.length, filePath }, 'Invalidated cache entries for file')
  }

  /**
   * Invalidate cache entries for a specific language
   */
  invalidateLanguage(language: string): void {
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (entry.metadata.language === language) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    if (keysToDelete.length > 0) this.log.debug({ count: keysToDelete.length, language }, 'Invalidated cache entries for language')
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.lruList.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.log.info({ size }, 'Cleared cache')
  }

  /**
   * Get current size of the cache (number of entries)
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get estimated memory usage of the cache in bytes
   */
  memoryUsage(): number {
    // This is a rough estimate. A more accurate measure would involve
    // deep-inspecting object sizes, which is complex in JavaScript.
    // Assume an average entry size for estimation.
    const averageEntrySizeEstimate = 2000; // 2KB per entry, based on typical SearchResult complexity
    return this.cache.size * averageEntrySizeEstimate;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitCount: number;
    missCount: number;
    hitRate: number;
    ttl: number;
    memoryUsage: number;
  } {
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
  getEntries(): Array<{
    key: string;
    query: string;
    resultCount: number;
    age: number;
    metadata: any;
  }> {
    const now = Date.now();
    const entries: Array<{
      key: string;
      query: string;
      resultCount: number;
      age: number;
      metadata: any;
    }> = [];

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
  async warmUp(commonQueries: string[]): Promise<void> {
    this.log.info({ count: commonQueries.length }, 'Warming up cache');
    
    // This would typically be called with a search service instance
    // For now, we just log the intent
    for (const query of commonQueries) {
      this.log.debug({ query }, 'Warm-up candidate');
    }
  }

  /**
   * Check if a query is likely to benefit from caching
   */
  shouldCache(query: SearchQuery, results: SearchResult[]): boolean {
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

  private touch(key: string) {
    this.lruList.set(key, Date.now())
  }
} 