import { Request, Response, NextFunction, RequestHandler } from 'express'
import { createModuleLogger } from '../logging/logger.js'

const log = createModuleLogger('rate-limit')

export interface RateLimitOptions {
  windowMs: number
  maxTokens: number
  /** build a key from request; default: ip + route + workspace */
  keyGenerator?: (req: Request) => string
  /** bypass limits (e.g., internal IPs) */
  whitelist?: (req: Request) => boolean
  /** called when a request is limited */
  onLimit?: (info: { req: Request; key: string; remaining: number; retryAfterSec: number }) => void
  /** pluggable store (e.g., Redis) */
  store?: RateLimitStore
  /** time provider for tests */
  nowProvider?: () => number
}

export interface BucketState {
  tokens: number // may be fractional
  lastRefillMs: number
}

export interface RateLimitStore {
  get(key: string): Promise<BucketState | undefined>
  set(key: string, value: BucketState): Promise<void>
  delete(key: string): Promise<void>
  prune?(nowMs: number): Promise<void>
}

class InMemoryStore implements RateLimitStore {
  private readonly map = new Map<string, BucketState & { expiresAt: number }>()
  constructor(private readonly windowMs: number) {}
  async get(key: string): Promise<BucketState | undefined> {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key)
      return undefined
    }
    return { tokens: entry.tokens, lastRefillMs: entry.lastRefillMs }
  }
  async set(key: string, value: BucketState): Promise<void> {
    this.map.set(key, { ...value, expiresAt: value.lastRefillMs + this.windowMs * 2 })
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key)
  }
  async prune(nowMs: number): Promise<void> {
    for (const [k, v] of this.map) {
      if (v.expiresAt <= nowMs) this.map.delete(k)
    }
  }
}

function defaultKeyGenerator(req: Request): string {
  const ip = (req.ip || req.socket.remoteAddress || 'unknown').toString()
  const route = (req.baseUrl || req.path || req.url || '/').toString()
  const workspace = String(req.header('X-Workspace') || 'default')
  return `${ip}|${route}|${workspace}`
}

/**
 * Create a token-bucket rate limiter middleware with informative headers.
 */
export function createRateLimit(opts?: Partial<RateLimitOptions>): RequestHandler {
  const windowMs = opts?.windowMs ?? parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10)
  const maxTokens = opts?.maxTokens ?? parseInt(process.env.RATE_LIMIT_MAX_TOKENS || '30', 10)
  const keyGenerator = opts?.keyGenerator ?? defaultKeyGenerator
  const whitelist = opts?.whitelist ?? (() => false)
  const onLimit = opts?.onLimit
  const now = opts?.nowProvider ?? Date.now
  const store: RateLimitStore = opts?.store ?? new InMemoryStore(windowMs)

  const ratePerMs = maxTokens / windowMs

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (whitelist(req)) return next()

      const key = keyGenerator(req)
      const nowMs = now()

      // Load state and refill
      const state = (await store.get(key)) ?? { tokens: maxTokens, lastRefillMs: nowMs }
      const elapsed = Math.max(0, nowMs - state.lastRefillMs)
      const refilled = Math.min(maxTokens, state.tokens + elapsed * ratePerMs)

      // Decide
      if (refilled < 1) {
        const needed = 1 - refilled
        const retryAfterSec = Math.ceil(needed / ratePerMs / 1000)
        const remaining = Math.max(0, Math.floor(refilled))

        res.setHeader('Retry-After', String(retryAfterSec))
        res.setHeader('X-RateLimit-Limit', String(maxTokens))
        res.setHeader('X-RateLimit-Remaining', String(remaining))
        res.setHeader('X-RateLimit-Reset', String(retryAfterSec))

        onLimit?.({ req, key, remaining, retryAfterSec })
        log.warn({ key, remaining, retryAfterSec }, 'Rate limit exceeded')
        return res.status(429).json({ error: 'rate_limited', limit: maxTokens, remaining, retryAfter: retryAfterSec })
      }

      // Consume a token and persist
      const newTokens = refilled - 1
      await store.set(key, { tokens: newTokens, lastRefillMs: nowMs })

      const remaining = Math.max(0, Math.floor(newTokens))
      // Time until next token (when below max)
      const nextTokenSec = newTokens < maxTokens ? Math.ceil((1 - (newTokens % 1 || 1)) / ratePerMs / 1000) : 0
      res.setHeader('X-RateLimit-Limit', String(maxTokens))
      res.setHeader('X-RateLimit-Remaining', String(remaining))
      res.setHeader('X-RateLimit-Reset', String(nextTokenSec))

      return next()
    } catch (err) {
      // Fail-open: do not block traffic on limiter error
      log.error({ err }, 'Rate limiter error')
      return next()
    }
  }
}

/**
 * Backward-compatible default middleware using env-based configuration.
 */
export const rateLimit: RequestHandler = createRateLimit()
