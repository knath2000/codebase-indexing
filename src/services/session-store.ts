import Database from 'better-sqlite3'

const DEFAULT_TTL_MS = 10 * 60 * 1000 // 10 minutes

export class SessionStore {
  private db: Database.Database

  constructor(dbPath: string = '/data/session-store.sqlite') {
    // If volume not mounted fallback to in-memory db (unit tests / dev)
    const path = process.env.NODE_ENV === 'test' ? ':memory:' : dbPath
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        alloc_id   TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
    `)
  }

  upsert(sessionId: string, allocId: string, ttlMs: number = DEFAULT_TTL_MS) {
    const now = Date.now()
    const expires = now + ttlMs
    const stmt = this.db.prepare(`
      INSERT INTO sessions (session_id, alloc_id, created_at, expires_at)
      VALUES (@sessionId,@allocId,@now,@expires)
      ON CONFLICT(session_id) DO UPDATE SET alloc_id=excluded.alloc_id, expires_at=excluded.expires_at;
    `)
    stmt.run({ sessionId, allocId, now, expires })
  }

  lookup(sessionId: string): string | null {
    const row = this.db.prepare('SELECT alloc_id, expires_at FROM sessions WHERE session_id=?').get(sessionId) as { alloc_id: string, expires_at: number } | undefined
    if (!row) return null
    if (row.expires_at < Date.now()) {
      this.delete(sessionId)
      return null
    }
    return row.alloc_id
  }

  delete(sessionId: string) {
    this.db.prepare('DELETE FROM sessions WHERE session_id=?').run(sessionId)
  }

  cleanup() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  }
} 