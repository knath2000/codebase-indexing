import { Request, Response, NextFunction } from 'express'

interface Bucket {
  tokens: number
  last: number
}

const WINDOW_MS = 60 * 1000 // 1 minute
const MAX_TOKENS = 30 // per workspace per minute

const buckets = new Map<string, Bucket>()

/**
 * Simple token-bucket rate limiter keyed by `X-Workspace` header.
 * Exposes 429 with Retry-After when exhausted.
 */
export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const workspace = String(req.header('X-Workspace') || 'default')
  const now = Date.now()
  let bucket = buckets.get(workspace)
  if (!bucket) {
    bucket = { tokens: MAX_TOKENS, last: now }
    buckets.set(workspace, bucket)
  }
  // refill tokens based on elapsed time
  const elapsed = now - bucket.last
  if (elapsed > WINDOW_MS) {
    bucket.tokens = MAX_TOKENS
    bucket.last = now
  }
  if (bucket.tokens <= 0) {
    res.setHeader('Retry-After', '60')
    return res.status(429).send('Rate limit exceeded')
  }
  bucket.tokens -= 1
  next()
} 