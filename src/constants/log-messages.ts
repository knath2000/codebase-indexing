/**
 * Log message constants for consistent, syslog-safe logging
 * Removes magic strings and emojis from the codebase
 */

export const WATCHER_MESSAGES = {
  // Startup messages
  ALREADY_ACTIVE: 'Workspace watcher already active',
  STARTING: 'Starting workspace watcher',
  STARTED: 'Workspace watcher active - monitoring for file changes',
  
  // Configuration messages
  WATCHING_EXTENSIONS: 'Watching file extensions',
  EXCLUDING_PATTERNS: 'Excluding file patterns',
  
  // File operation messages
  FILE_ADDED: 'File added - scheduling index',
  FILE_ADDED_SUCCESS: 'File indexed successfully',
  FILE_ADDED_ERROR: 'Failed to index new file',
  
  FILE_CHANGED: 'File changed - scheduling re-index',
  FILE_CHANGED_SUCCESS: 'File re-indexed successfully', 
  FILE_CHANGED_ERROR: 'Failed to re-index changed file',
  
  FILE_REMOVED: 'File removed - removing from index',
  FILE_REMOVED_SUCCESS: 'File removed from index successfully',
  FILE_REMOVED_ERROR: 'Failed to remove file from index',
  
  // Error handling messages
  WATCHER_ERROR: 'File watcher error occurred',
  WATCHER_CRASHED: 'Watcher crashed - attempting restart',
  RESTART_SUCCESS: 'Watcher restarted successfully',
  RESTART_ERROR: 'Failed to restart watcher',
  
  // Queue messages
  QUEUE_TASK_ADDED: 'File operation queued',
  QUEUE_TASK_STARTED: 'Processing file operation',
  QUEUE_TASK_COMPLETED: 'File operation completed',
  QUEUE_TASK_FAILED: 'File operation failed',
  
  // Shutdown messages
  STOPPING: 'Stopping workspace watcher',
  STOPPED: 'Workspace watcher stopped',
  STOP_ERROR: 'Error stopping workspace watcher'
};

export const WATCHER_FIELDS = {
  COMPONENT: 'workspace-watcher',
  ROOT_DIR: 'rootDir',
  FILE_PATH: 'filePath',
  OPERATION: 'operation',
  EXTENSIONS: 'supportedExtensions',
  PATTERNS: 'excludePatterns',
  QUEUE_SIZE: 'queueSize',
  QUEUE_PENDING: 'queuePending',
  ERROR: 'error',
  DURATION: 'duration'
} as const;