/**
 * Interface for session store operations
 * Enables pluggable implementations for different environments:
 * - In-memory for development/testing
 * - SQLite for single-instance production
 * - Redis for multi-instance production (future)
 */
export interface ISessionStore {
  /**
   * Store or update a session mapping
   * @param sessionId Unique session identifier
   * @param allocId Allocation ID (e.g., Fly.io allocation)
   * @param ttlMs Optional TTL override in milliseconds
   */
  upsert(sessionId: string, allocId: string, ttlMs?: number): Promise<void>;

  /**
   * Look up allocation ID for a session
   * @param sessionId Session identifier to look up
   * @returns Allocation ID if found and not expired, null otherwise
   */
  lookup(sessionId: string): Promise<string | null>;

  /**
   * Delete a specific session
   * @param sessionId Session identifier to delete
   */
  delete(sessionId: string): Promise<void>;

  /**
   * Clean up expired sessions
   * @returns Number of sessions deleted
   */
  cleanup(): Promise<number>;

  /**
   * Get session store metrics for monitoring
   */
  getMetrics(): Promise<SessionStoreMetrics>;

  /**
   * Close the session store and clean up resources
   */
  close(): Promise<void>;
}

/**
 * Session store metrics for observability
 */
export interface SessionStoreMetrics {
  totalSessions: number;
  expiredSessions: number;
  lookupCount: number;
  upsertCount: number;
  deleteCount: number;
  errorCount: number;
  lastCleanup?: Date;
  dbSize?: number; // For file-based stores
}

/**
 * Configuration for session store implementations
 */
export interface SessionStoreConfig {
  /** Path to database file (SQLite) or connection string */
  path: string;
  
  /** Default TTL in milliseconds */
  ttlMs: number;
  
  /** Cleanup interval in milliseconds */
  cleanupIntervalMs: number;
  
  /** Retry count for failed operations */
  retryCount: number;
  
  /** Delay between retries in milliseconds */
  retryDelayMs: number;
  
  /** Whether session store is enabled */
  enabled: boolean;
  
  /** Clock function for testing */
  clockFn?: () => number;
}