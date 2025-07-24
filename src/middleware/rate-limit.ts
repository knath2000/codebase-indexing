import { Request, Response, NextFunction } from 'express'
import type { Config } from '../types.js'

interface RateLimitBucket {
  tokens: number
  lastRefill: number
  created: number
}

interface RateLimitMetrics {
  totalRequests: number
  rejectedRequests: number
  activeBuckets: number
}

/**
 * Simple in-memory rate limiter with TTL cleanup and atomic operations
 * Implements token bucket algorithm with configurable parameters
 */
export class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>()
  private metrics: RateLimitMetrics = {
    totalRequests: 0,
    rejectedRequests: 0,
    activeBuckets: 0
  }
  private cleanupTimer?: NodeJS.Timeout

  constructor(
    private config: {
      tokens: number
      windowMs: number
      memoryTTLMs: number
      useSessionId: boolean
    }
  ) {
    // Start periodic cleanup to prevent memory leaks
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredBuckets()
    }, Math.max(this.config.memoryTTLMs / 10, 30000)) // Clean every 30s minimum
  }

  /**
   * Check if request should be rate limited
   * Returns false if allowed, true if rate limited
   */
  public checkRateLimit(key: string): { limited: boolean; retryAfterMs?: number } {
    this.metrics.totalRequests++
    
    const now = Date.now()
    let bucket = this.buckets.get(key)
    
    if (!bucket) {
      bucket = {
        tokens: this.config.tokens,
        lastRefill: now,
        created: now
      }
      this.buckets.set(key, bucket)
      this.metrics.activeBuckets = this.buckets.size
    }

    // Refill tokens based on elapsed time (sliding window)
    const elapsed = now - bucket.lastRefill
    if (elapsed >= this.config.windowMs) {
      // Full refill after window period
      bucket.tokens = this.config.tokens
      bucket.lastRefill = now
    } else {
      // Partial refill based on elapsed time (smooth rate limiting)
      const tokensToAdd = Math.floor((elapsed / this.config.windowMs) * this.config.tokens)
      bucket.tokens = Math.min(this.config.tokens, bucket.tokens + tokensToAdd)
      if (tokensToAdd > 0) {
        bucket.lastRefill = now
      }
    }

    // Check if request can be allowed
    if (bucket.tokens <= 0) {
      this.metrics.rejectedRequests++
      const retryAfterMs = this.config.windowMs - (now - bucket.lastRefill)
      return { limited: true, retryAfterMs }
    }

    // Consume one token atomically
    bucket.tokens--
    return { limited: false }
  }

  /**
   * Clean up expired buckets to prevent memory leaks
   */
  private cleanupExpiredBuckets(): void {
    const now = Date.now()
    const expiredKeys: string[] = []

    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.created > this.config.memoryTTLMs) {
        expiredKeys.push(key)
      }
    }

    for (const key of expiredKeys) {
      this.buckets.delete(key)
    }

    this.metrics.activeBuckets = this.buckets.size
  }

  /**
   * Get current metrics for observability
   */
  public getMetrics(): RateLimitMetrics {
    return { ...this.metrics }
  }

  /**
   * Reset metrics (useful for testing)
   */
  public resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      rejectedRequests: 0,
      activeBuckets: this.buckets.size
    }
  }

  /**
   * Clear all buckets (useful for testing)
   */
  public clear(): void {
    this.buckets.clear()
    this.metrics.activeBuckets = 0
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
    this.buckets.clear()
  }
}

/**
 * Create rate limiting middleware with configuration
 */
export const buildRateLimiter = (config: Config) => {
  if (!config.rateLimitEnabled) {
    // Return pass-through middleware if rate limiting is disabled
    return (_req: Request, _res: Response, next: NextFunction) => next()
  }

  const limiter = new RateLimiter({
    tokens: config.rateLimitTokens,
    windowMs: config.rateLimitWindowMs,
    memoryTTLMs: config.rateLimitMemoryTTLMs,
    useSessionId: config.rateLimitUseSessionId
  })

  return (req: Request, res: Response, next: NextFunction) => {
    // Extract rate limiting key based on configuration
    let key: string

    if (config.rateLimitUseSessionId) {
      // Prefer session ID from JSON-RPC or request headers for security
      key = req.body?.id || req.headers['x-session-id'] || req.ip || 'anonymous'
    } else {
      // Fall back to workspace header (less secure but backward compatible)
      key = req.headers['x-workspace'] as string || req.ip || 'default'
    }

    const result = limiter.checkRateLimit(key)

    if (result.limited) {
      const retryAfterSeconds = Math.ceil((result.retryAfterMs || 60000) / 1000)
      
      res.setHeader('Retry-After', retryAfterSeconds.toString())
      res.setHeader('X-RateLimit-Limit', config.rateLimitTokens.toString())
      res.setHeader('X-RateLimit-Remaining', '0')
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + (result.retryAfterMs || 60000)).toISOString())
      
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: retryAfterSeconds,
        message: `Too many requests from this ${config.rateLimitUseSessionId ? 'session' : 'workspace'}. Please retry after ${retryAfterSeconds} seconds.`
      })
    }

    // Add rate limit headers for successful requests
    const metrics = limiter.getMetrics()
    res.setHeader('X-RateLimit-Limit', config.rateLimitTokens.toString())
    res.setHeader('X-RateLimit-Remaining', Math.max(0, config.rateLimitTokens - 1).toString())

    // Store limiter instance for metrics collection
    req.rateLimiter = limiter

    return next()
  }
}

/**
 * Legacy rate limit function for backward compatibility
 * @deprecated Use buildRateLimiter() instead
 */
export function rateLimit(req: Request, res: Response, next: NextFunction) {
  // Create a basic limiter with default config for backward compatibility
  const defaultConfig = {
    rateLimitEnabled: true,
    rateLimitTokens: 30,
    rateLimitWindowMs: 60000,
    rateLimitMemoryTTLMs: 300000,
    rateLimitUseSessionId: false
  } as Config

  const middleware = buildRateLimiter(defaultConfig)
  return middleware(req, res, next)
}

// Augment Express Request type for TypeScript
declare global {
  namespace Express {
    interface Request {
      rateLimiter?: RateLimiter
    }
  }
} 