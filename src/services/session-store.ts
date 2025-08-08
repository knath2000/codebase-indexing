import Database from 'better-sqlite3'
import { createModuleLogger } from '../logging/logger.js'

const log = createModuleLogger('session-store')

export interface ISessionStore {
  upsert(sessionId: string, allocId: string, ttlMs?: number): Promise<void>
  lookup(sessionId: string): Promise<string | null>
  touch(sessionId: string, ttlMs?: number): Promise<boolean>
  delete(sessionId: string): Promise<void>
  cleanup(): Promise<number>
  close(): Promise<void>
}

export interface SessionStoreOptions {
  dbPath?: string
  defaultTtlMs?: number
  nowProvider?: () => number
}

const DEFAULT_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '', 10) || 10 * 60 * 1000 // 10 minutes

/**
 * SQLite-backed session store. For single-instance deployments this is sufficient.
 * Exposes an async API to allow drop-in replacement with Redis or others.
 */
export class SQLiteSessionStore implements ISessionStore {
  private db: Database.Database
  private readonly defaultTtlMs: number
  private readonly now: () => number

  // Cached prepared statements
  private stmtUpsert!: Database.Statement
  private stmtLookup!: Database.Statement
  private stmtDelete!: Database.Statement
  private stmtCleanup!: Database.Statement

  constructor(opts: SessionStoreOptions = {}) {
    const dbPath = opts.dbPath || process.env.SESSION_DB_PATH || '/data/session-store.sqlite'
    const resolvedPath = process.env.NODE_ENV === 'test' ? ':memory:' : dbPath
    this.defaultTtlMs = opts.defaultTtlMs || DEFAULT_TTL_MS
    this.now = opts.nowProvider || Date.now

    try {
      this.db = new Database(resolvedPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('busy_timeout = 2000')
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT PRIMARY KEY,
          alloc_id   TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
      `)

      this.stmtUpsert = this.db.prepare(`
        INSERT INTO sessions (session_id, alloc_id, created_at, expires_at)
        VALUES (@sessionId,@allocId,@now,@expires)
        ON CONFLICT(session_id) DO UPDATE SET alloc_id=excluded.alloc_id, expires_at=excluded.expires_at;
      `)
      this.stmtLookup = this.db.prepare('SELECT alloc_id, expires_at FROM sessions WHERE session_id=?')
      this.stmtDelete = this.db.prepare('DELETE FROM sessions WHERE session_id=?')
      this.stmtCleanup = this.db.prepare('DELETE FROM sessions WHERE expires_at < ?')
    } catch (err) {
      log.error({ err, dbPath: resolvedPath }, 'Failed to initialize SQLiteSessionStore')
      throw err
    }
  }

  async upsert(sessionId: string, allocId: string, ttlMs?: number): Promise<void> {
    if (!sessionId) throw new Error('sessionId is required')
    if (!allocId) throw new Error('allocId is required')
    const now = this.now()
    const expires = now + (ttlMs ?? this.defaultTtlMs)
    try {
      this.stmtUpsert.run({ sessionId, allocId, now, expires })
    } catch (err) {
      log.error({ err, sessionId }, 'upsert failed')
      throw err
    }
  }

  async lookup(sessionId: string): Promise<string | null> {
    if (!sessionId) throw new Error('sessionId is required')
    try {
      const row = this.stmtLookup.get(sessionId) as { alloc_id: string; expires_at: number } | undefined
      if (!row) return null
      if (row.expires_at < this.now()) {
        await this.delete(sessionId)
        return null
      }
      return row.alloc_id
    } catch (err) {
      log.error({ err, sessionId }, 'lookup failed')
      throw err
    }
  }

  async touch(sessionId: string, ttlMs?: number): Promise<boolean> {
    if (!sessionId) throw new Error('sessionId is required')
    const current = await this.lookup(sessionId)
    if (!current) return false
    await this.upsert(sessionId, current, ttlMs)
    return true
  }

  async delete(sessionId: string): Promise<void> {
    if (!sessionId) throw new Error('sessionId is required')
    try {
      this.stmtDelete.run(sessionId)
    } catch (err) {
      log.error({ err, sessionId }, 'delete failed')
      throw err
    }
  }

  async cleanup(): Promise<number> {
    try {
      const info = this.stmtCleanup.run(this.now())
      return info.changes || 0
    } catch (err) {
      log.error({ err }, 'cleanup failed')
      throw err
    }
  }

  async close(): Promise<void> {
    try {
      this.db.close()
    } catch (err) {
      log.error({ err }, 'close failed')
    }
  }
}