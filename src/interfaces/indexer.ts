/**
 * Interface for indexing operations
 * Allows WorkspaceWatcher to depend on abstraction rather than concrete implementation
 * Improves testability and follows dependency inversion principle
 */
export interface IIndexer {
  /**
   * Index a newly added file
   */
  indexFile(filePath: string): Promise<void>;

  /**
   * Re-index an existing file that has been modified
   */
  reindexFile(filePath: string): Promise<void>;

  /**
   * Remove a deleted file from the index
   */
  removeFile(filePath: string): Promise<void>;
}

/**
 * Configuration type for WorkspaceWatcher
 * Centralizes all watcher-related configuration
 */
export interface WatcherConfig {
  /** Root directory to watch */
  workspaceRoot: string;
  
  /** File extensions to watch (with or without leading dot) */
  supportedExtensions: string[];
  
  /** Glob patterns to exclude from watching */
  excludePatterns: string[];
  
  /** Debounce delay for file change events in milliseconds */
  debounceMs: number;
  
  /** Queue concurrency (1 = serial processing) */
  queueConcurrency: number;
  
  /** Whether to auto-restart watcher on errors */
  autoRestart: boolean;
  
  /** Whether file watching is enabled */
  enabled: boolean;
}