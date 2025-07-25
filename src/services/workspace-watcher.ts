import chokidar, { FSWatcher } from 'chokidar';
import { extname } from 'path';
import { createLogger } from '../utils/logger.js';
import { DebouncedTaskQueue } from '../utils/task-queue.js';
import { IIndexer, WatcherConfig } from '../interfaces/indexer.js';
import { WATCHER_MESSAGES, WATCHER_FIELDS } from '../constants/log-messages.js';
import { createPerfLogger } from '../utils/logger.js';
import type { Config } from '../types.js';

/**
 * File system operation types
 */
type FileOperation = 'add' | 'change' | 'unlink';

/**
 * Metrics for workspace watcher performance monitoring
 */
export interface WatcherMetrics {
  filesProcessed: number;
  operationsQueued: number;
  operationsFailed: number;
  restartCount: number;
  lastRestartTime?: Date;
  queueMetrics: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
}

/**
 * Enhanced WorkspaceWatcher with improved reliability, observability, and performance
 * 
 * Improvements implemented:
 * - Structured logging with configurable levels
 * - Debounced task queue for handling file bursts
 * - Auto-restart capability on watcher errors
 * - Interface-based dependency injection for better testability
 * - Centralized configuration management
 * - Comprehensive metrics collection
 * - Memory-safe extension handling
 * - Proper async resource management
 */
export class WorkspaceWatcher {
  private watcher?: FSWatcher;
  private readonly logger = createLogger().child({ 
    [WATCHER_FIELDS.COMPONENT]: WATCHER_FIELDS.COMPONENT 
  });
  private readonly queue: DebouncedTaskQueue;
  private readonly supportedExtensions: ReadonlySet<string>;
  private readonly metrics: WatcherMetrics = {
    filesProcessed: 0,
    operationsQueued: 0,
    operationsFailed: 0,
    restartCount: 0,
    queueMetrics: { pending: 0, running: 0, completed: 0, failed: 0 }
  };
  private isStarted = false;
  private isRestarting = false;

  constructor(
    private readonly config: WatcherConfig,
    private readonly indexer: IIndexer
  ) {
    // Initialize task queue with debouncing
    this.queue = new DebouncedTaskQueue(
      config.queueConcurrency,
      config.debounceMs
    );

    // Normalize extension list to ensure consistent format (with leading dots)
    this.supportedExtensions = new Set(
      config.supportedExtensions.map(ext => this.normalizeExtension(ext))
    );

    this.logger.debug({
      [WATCHER_FIELDS.ROOT_DIR]: config.workspaceRoot,
      [WATCHER_FIELDS.EXTENSIONS]: Array.from(this.supportedExtensions),
      [WATCHER_FIELDS.PATTERNS]: config.excludePatterns,
      debounceMs: config.debounceMs,
      queueConcurrency: config.queueConcurrency
    }, 'WorkspaceWatcher initialized');
  }

  /**
   * Factory method to create WorkspaceWatcher from Config
   */
  static fromConfig(config: Config, indexer: IIndexer, workspaceRoot: string): WorkspaceWatcher {
    const watcherConfig: WatcherConfig = {
      workspaceRoot,
      supportedExtensions: config.supportedExtensions,
      excludePatterns: config.excludePatterns,
      debounceMs: config.watcherDebounceMs,
      queueConcurrency: config.watcherQueueConcurrency,
      autoRestart: config.watcherAutoRestart,
      enabled: config.watcherEnabled
    };

    return new WorkspaceWatcher(watcherConfig, indexer);
  }

  /**
   * Start watching the workspace directory
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('File watcher disabled by configuration');
      return;
    }

    if (this.isStarted) {
      this.logger.warn(WATCHER_MESSAGES.ALREADY_ACTIVE);
      return;
    }

    this.logger.info({
      [WATCHER_FIELDS.ROOT_DIR]: this.config.workspaceRoot,
      [WATCHER_FIELDS.EXTENSIONS]: Array.from(this.supportedExtensions),
      [WATCHER_FIELDS.PATTERNS]: this.config.excludePatterns
    }, WATCHER_MESSAGES.STARTING);

    try {
      await this.initializeWatcher();
      this.isStarted = true;
      
      this.logger.info({
        [WATCHER_FIELDS.ROOT_DIR]: this.config.workspaceRoot,
        extensionCount: this.supportedExtensions.size,
        patternCount: this.config.excludePatterns.length
      }, WATCHER_MESSAGES.STARTED);
    } catch (error) {
      this.logger.error({
        [WATCHER_FIELDS.ERROR]: error,
        [WATCHER_FIELDS.ROOT_DIR]: this.config.workspaceRoot
      }, 'Failed to start workspace watcher');
      throw error;
    }
  }

  /**
   * Stop watching the workspace directory
   */
  async stop(): Promise<void> {
    this.logger.info(WATCHER_MESSAGES.STOPPING);
    
    try {
      this.isStarted = false;
      
      // Clear queue and stop processing new tasks
      this.queue.clear();
      
      // Close file watcher
      if (this.watcher) {
        await this.watcher.close();
        this.watcher = undefined;
      }
      
      this.logger.info(WATCHER_MESSAGES.STOPPED);
    } catch (error) {
      this.logger.error({
        [WATCHER_FIELDS.ERROR]: error
      }, WATCHER_MESSAGES.STOP_ERROR);
      throw error;
    }
  }

  /**
   * Get current watcher metrics for monitoring
   */
  getMetrics(): WatcherMetrics {
    return {
      ...this.metrics,
      queueMetrics: this.queue.getMetrics()
    };
  }

  /**
   * Check if watcher is currently active
   */
  isActive(): boolean {
    return this.isStarted && this.watcher !== undefined;
  }

  /**
   * Initialize the chokidar file watcher
   */
  private async initializeWatcher(): Promise<void> {
    this.watcher = chokidar.watch(this.config.workspaceRoot, {
      ignored: this.config.excludePatterns,
      persistent: true,
      ignoreInitial: true,
      // Optimize for performance
      usePolling: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });

    // Set up event handlers
    this.watcher
      .on('add', (filePath: string) => this.enqueueFileOperation(filePath, 'add'))
      .on('change', (filePath: string) => this.enqueueFileOperation(filePath, 'change'))
      .on('unlink', (filePath: string) => this.enqueueFileOperation(filePath, 'unlink'))
      .on('error', (error: Error) => this.handleWatcherError(error));

    // Wait for watcher to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Watcher initialization timeout'));
      }, 5000);

      this.watcher!.on('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Enqueue a file operation with debouncing
   */
  private enqueueFileOperation(filePath: string, operation: FileOperation): void {
    if (!this.isSupportedFile(filePath)) {
      return;
    }

    this.metrics.operationsQueued++;
    
    this.logger.debug({
      [WATCHER_FIELDS.FILE_PATH]: filePath,
      [WATCHER_FIELDS.OPERATION]: operation,
      [WATCHER_FIELDS.QUEUE_SIZE]: this.queue.getMetrics().pending
    }, WATCHER_MESSAGES.QUEUE_TASK_ADDED);

    // Use debounced queue to handle rapid file changes
    const taskId = `${operation}:${filePath}`;
    
    this.queue.addDebounced(
      () => this.executeFileOperation(filePath, operation),
      taskId
    ).catch(error => {
      this.metrics.operationsFailed++;
      this.logger.error({
        [WATCHER_FIELDS.FILE_PATH]: filePath,
        [WATCHER_FIELDS.OPERATION]: operation,
        [WATCHER_FIELDS.ERROR]: error
      }, WATCHER_MESSAGES.QUEUE_TASK_FAILED);
    });
  }

  /**
   * Execute a file operation (non-blocking)
   */
  private async executeFileOperation(filePath: string, operation: FileOperation): Promise<void> {
    const perfLogger = createPerfLogger(this.logger, `file-${operation}`);
    
    this.logger.debug({
      [WATCHER_FIELDS.FILE_PATH]: filePath,
      [WATCHER_FIELDS.OPERATION]: operation
    }, WATCHER_MESSAGES.QUEUE_TASK_STARTED);

    try {
      switch (operation) {
        case 'add':
          await this.indexer.indexFile(filePath);
          this.logger.debug({
            [WATCHER_FIELDS.FILE_PATH]: filePath
          }, WATCHER_MESSAGES.FILE_ADDED_SUCCESS);
          break;
          
        case 'change':
          await this.indexer.reindexFile(filePath);
          this.logger.debug({
            [WATCHER_FIELDS.FILE_PATH]: filePath
          }, WATCHER_MESSAGES.FILE_CHANGED_SUCCESS);
          break;
          
        case 'unlink':
          await this.indexer.removeFile(filePath);
          this.logger.debug({
            [WATCHER_FIELDS.FILE_PATH]: filePath
          }, WATCHER_MESSAGES.FILE_REMOVED_SUCCESS);
          break;
      }

      this.metrics.filesProcessed++;
      perfLogger.end({ success: true });
      
    } catch (error) {
      this.metrics.operationsFailed++;
      
      const errorMessage = operation === 'add' ? WATCHER_MESSAGES.FILE_ADDED_ERROR :
                          operation === 'change' ? WATCHER_MESSAGES.FILE_CHANGED_ERROR :
                          WATCHER_MESSAGES.FILE_REMOVED_ERROR;
      
      this.logger.error({
        [WATCHER_FIELDS.FILE_PATH]: filePath,
        [WATCHER_FIELDS.OPERATION]: operation,
        [WATCHER_FIELDS.ERROR]: error
      }, errorMessage);
      
      perfLogger.end({ success: false, error: String(error) });
      throw error;
    }
  }

  /**
   * Handle watcher errors with auto-restart capability
   */
  private async handleWatcherError(error: Error): Promise<void> {
    this.logger.error({
      [WATCHER_FIELDS.ERROR]: error,
      restartCount: this.metrics.restartCount
    }, WATCHER_MESSAGES.WATCHER_ERROR);

    if (!this.config.autoRestart || this.isRestarting) {
      return;
    }

    this.isRestarting = true;
    this.metrics.restartCount++;
    this.metrics.lastRestartTime = new Date();

    try {
      this.logger.warn(WATCHER_MESSAGES.WATCHER_CRASHED);
      
      // Stop current watcher
      if (this.watcher) {
        await this.watcher.close();
        this.watcher = undefined;
      }

      // Wait a bit before restarting
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Restart watcher
      await this.initializeWatcher();
      
      this.logger.info({
        restartCount: this.metrics.restartCount
      }, WATCHER_MESSAGES.RESTART_SUCCESS);
      
    } catch (restartError) {
      this.logger.error({
        [WATCHER_FIELDS.ERROR]: restartError,
        originalError: error
      }, WATCHER_MESSAGES.RESTART_ERROR);
    } finally {
      this.isRestarting = false;
    }
  }

  /**
   * Check if a file is supported based on its extension
   */
  private isSupportedFile(filePath: string): boolean {
    const extension = extname(filePath);
    return this.supportedExtensions.has(extension);
  }

  /**
   * Normalize file extension to ensure consistent format with leading dot
   */
  private normalizeExtension(ext: string): string {
    return ext.startsWith('.') ? ext : `.${ext}`;
  }
} 