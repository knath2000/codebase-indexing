import chokidar, { FSWatcher } from 'chokidar';
import { extname } from 'path';
import { IndexingService } from './indexing-service.js';
import { createModuleLogger } from '../logging/logger.js'

/**
 * Watches the workspace directory for file changes and triggers incremental re-indexing.
 */
export class WorkspaceWatcher {
  private readonly rootDir: string;
  private readonly indexingService: IndexingService;
  private readonly supportedExtensions: Set<string>;
  private readonly excludePatterns: string[];
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingEvents = new Map<string, 'add' | 'change' | 'unlink'>();
  private readonly debounceMs: number;
  private readonly log = createModuleLogger('workspace-watcher')

  constructor(
    rootDir: string,
    indexingService: IndexingService,
    supportedExtensions: string[],
    excludePatterns: string[]
  ) {
    this.rootDir = rootDir;
    this.indexingService = indexingService;
    this.supportedExtensions = new Set(supportedExtensions);
    this.excludePatterns = excludePatterns;
    // Prefer config-driven debounce from types.Config (passed into service that constructs us)
    // Fallback to env or 500ms if not available
    this.debounceMs = parseInt(process.env.FILE_WATCH_DEBOUNCE_MS || '', 10) || 500
  }

  /** Start watching the workspace directory. */
  start() {
    if (this.watcher) {
      this.log.info('Workspace watcher already active');
      return; // already watching
    }

    this.log.info({ rootDir: this.rootDir }, 'Starting workspace watcher');
    this.log.debug({ extensions: Array.from(this.supportedExtensions), exclude: this.excludePatterns }, 'Watcher config');

    this.watcher = chokidar.watch(this.rootDir, {
      ignored: this.excludePatterns,
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher
      .on('add', (filePath: string) => this.queueEvent('add', filePath))
      .on('change', (filePath: string) => this.queueEvent('change', filePath))
      .on('unlink', (filePath: string) => this.queueEvent('unlink', filePath))
      .on('ready', () => this.log.info('Workspace watcher ready'))
      .on('error', (err: Error) => this.log.error({ err }, 'File watcher error'));

    this.log.info('Workspace watcher active - monitoring for file changes');
  }

  /** Stop watching the workspace directory. */
  stop() {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.pendingEvents.clear()
    this.log.info('Workspace watcher stopped')
  }

  private isSupportedFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return this.supportedExtensions.has(ext);
  }

  /**
   * Queue events and process them in a debounced batch to avoid thrashing.
   */
  private queueEvent(kind: 'add' | 'change' | 'unlink', filePath: string) {
    if (!this.isSupportedFile(filePath)) return
    // Coalesce by path; unlink overrides others, change overrides add
    const existing = this.pendingEvents.get(filePath)
    if (existing) {
      if (kind === 'unlink' || (kind === 'change' && existing === 'add')) {
        this.pendingEvents.set(filePath, kind)
      }
    } else {
      this.pendingEvents.set(filePath, kind)
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.flushEvents(), this.debounceMs)
  }

  private async flushEvents() {
    const batch = Array.from(this.pendingEvents.entries())
    this.pendingEvents.clear()
    this.log.debug({ count: batch.length }, 'Processing watcher batch')
    for (const [filePath, kind] of batch) {
      try {
        if (kind === 'add') await this.handleAdd(filePath)
        else if (kind === 'change') await this.handleChange(filePath)
        else await this.handleUnlink(filePath)
      } catch (err) {
        this.log.error({ err, filePath, kind }, 'Batch event failed')
      }
    }
  }

  private async handleAdd(filePath: string) {
    if (!this.isSupportedFile(filePath)) return;
    try {
      this.log.info({ filePath }, 'File added - indexing')
      await this.indexingService.indexFile(filePath);
      this.log.info({ filePath }, 'File indexed')
    } catch (err) {
      this.log.error({ err, filePath }, 'Failed to index new file')
    }
  }

  private async handleChange(filePath: string) {
    if (!this.isSupportedFile(filePath)) return;
    try {
      this.log.info({ filePath }, 'File changed - re-indexing')
      await this.indexingService.reindexFile(filePath);
      this.log.info({ filePath }, 'File re-indexed')
    } catch (err) {
      this.log.error({ err, filePath }, 'Failed to re-index changed file')
    }
  }

  private async handleUnlink(filePath: string) {
    if (!this.isSupportedFile(filePath)) return;
    try {
      this.log.info({ filePath }, 'File removed - removing from index')
      await this.indexingService.removeFile(filePath);
      this.log.info({ filePath }, 'File removed from index')
    } catch (err) {
      this.log.error({ err, filePath }, 'Failed to remove file from index')
    }
  }
} 