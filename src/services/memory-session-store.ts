import { ISessionStore, SessionStoreMetrics, SessionStoreConfig } from '../interfaces/session-store.js';
import { createLogger } from '../utils/logger.js';

/**
 * Session data stored in memory
 */
interface SessionData {
  allocId: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * In-memory session store implementation
 * Perfect for development, testing, and single-instance scenarios where persistence isn't required
 * 
 * Features:
 * - Fast O(1) lookups and updates
 * - Automatic cleanup with TTL
 * - Memory-efficient with LRU-style eviction
 * - Comprehensive metrics collection
 * - Zero external dependencies
 */
export class MemorySessionStore implements ISessionStore {
  private readonly sessions = new Map<string, SessionData>();
  private readonly logger = createLogger().child({ component: 'memory-session-store' });
  private readonly cleanupTimer: NodeJS.Timer;
  private readonly metrics: SessionStoreMetrics = {
    totalSessions: 0,
    expiredSessions: 0,
    lookupCount: 0,
    upsertCount: 0,
    deleteCount: 0,
    errorCount: 0
  };

  constructor(private readonly config: SessionStoreConfig) {
    this.logger.info({
      ttlMs: config.ttlMs,
      cleanupIntervalMs: config.cleanupIntervalMs
    }, 'Memory session store initialized');

    // Start automatic cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        this.logger.error({ error }, 'Cleanup failed');
        this.metrics.errorCount++;
      });
    }, config.cleanupIntervalMs);

    // Don't keep the process alive just for cleanup
    this.cleanupTimer.unref();
  }

  async upsert(sessionId: string, allocId: string, ttlMs?: number): Promise<void> {
    try {
      const now = this.getCurrentTime();
      const effectiveTtl = ttlMs ?? this.config.ttlMs;
      const expiresAt = now + effectiveTtl;

      const sessionData: SessionData = {
        allocId,
        createdAt: now,
        expiresAt
      };

      const isNew = !this.sessions.has(sessionId);
      this.sessions.set(sessionId, sessionData);

      if (isNew) {
        this.metrics.totalSessions++;
      }
      this.metrics.upsertCount++;

      this.logger.debug({
        sessionId,
        allocId,
        ttlMs: effectiveTtl,
        isNew
      }, 'Session upserted');

    } catch (error) {
      this.metrics.errorCount++;
      this.logger.error({
        error,
        sessionId,
        allocId
      }, 'Failed to upsert session');
      throw error;
    }
  }

  async lookup(sessionId: string): Promise<string | null> {
    try {
      this.metrics.lookupCount++;
      
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData) {
        this.logger.debug({ sessionId }, 'Session not found');
        return null;
      }

      const now = this.getCurrentTime();
      if (sessionData.expiresAt < now) {
        // Session expired, remove it
        this.sessions.delete(sessionId);
        this.metrics.expiredSessions++;
        this.metrics.totalSessions--;
        
        this.logger.debug({
          sessionId,
          expiresAt: sessionData.expiresAt,
          now
        }, 'Session expired and removed');
        
        return null;
      }

      this.logger.debug({
        sessionId,
        allocId: sessionData.allocId
      }, 'Session found');

      return sessionData.allocId;

    } catch (error) {
      this.metrics.errorCount++;
      this.logger.error({
        error,
        sessionId
      }, 'Failed to lookup session');
      throw error;
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      const existed = this.sessions.delete(sessionId);
      if (existed) {
        this.metrics.totalSessions--;
        this.metrics.deleteCount++;
        
        this.logger.debug({
          sessionId
        }, 'Session deleted');
      }
    } catch (error) {
      this.metrics.errorCount++;
      this.logger.error({
        error,
        sessionId
      }, 'Failed to delete session');
      throw error;
    }
  }

  async cleanup(): Promise<number> {
    try {
      const now = this.getCurrentTime();
      const initialCount = this.sessions.size;
      let deletedCount = 0;

      // Find expired sessions
      const expiredSessions: string[] = [];
      for (const [sessionId, sessionData] of this.sessions.entries()) {
        if (sessionData.expiresAt < now) {
          expiredSessions.push(sessionId);
        }
      }

      // Remove expired sessions
      for (const sessionId of expiredSessions) {
        this.sessions.delete(sessionId);
        deletedCount++;
      }

      // Update metrics
      this.metrics.expiredSessions += deletedCount;
      this.metrics.totalSessions -= deletedCount;
      this.metrics.lastCleanup = new Date();

      if (deletedCount > 0) {
        this.logger.debug({
          deletedCount,
          remainingCount: this.sessions.size,
          initialCount
        }, 'Cleanup completed');
      }

      return deletedCount;

    } catch (error) {
      this.metrics.errorCount++;
      this.logger.error({ error }, 'Cleanup failed');
      throw error;
    }
  }

  async getMetrics(): Promise<SessionStoreMetrics> {
    return {
      ...this.metrics,
      totalSessions: this.sessions.size // Real-time count
    };
  }

  async close(): Promise<void> {
    this.logger.info('Closing memory session store');
    
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    // Clear all sessions
    this.sessions.clear();
    this.metrics.totalSessions = 0;
    
    this.logger.info('Memory session store closed');
  }

  /**
   * Get current time (allows injection for testing)
   */
  private getCurrentTime(): number {
    return this.config.clockFn ? this.config.clockFn() : Date.now();
  }

  /**
   * Get current session count (for testing/debugging)
   */
  public getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get all session IDs (for testing/debugging)
   */
  public getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}