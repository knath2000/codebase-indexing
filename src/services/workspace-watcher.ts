import chokidar, { FSWatcher } from 'chokidar';
import { extname } from 'path';
import { IndexingService } from './indexing-service.js';

/**
 * Watches the workspace directory for file changes and triggers incremental re-indexing.
 */
export class WorkspaceWatcher {
  private readonly rootDir: string;
  private readonly indexingService: IndexingService;
  private readonly supportedExtensions: Set<string>;
  private readonly excludePatterns: string[];
  private watcher: FSWatcher | null = null;

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
  }

  /** Start watching the workspace directory. */
  start() {
    if (this.watcher) return; // already watching

    this.watcher = chokidar.watch(this.rootDir, {
      ignored: this.excludePatterns,
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher
      .on('add', (filePath: string) => void this.handleAdd(filePath))
      .on('change', (filePath: string) => void this.handleChange(filePath))
      .on('unlink', (filePath: string) => void this.handleUnlink(filePath))
      .on('error', (err: Error) => console.error('File watcher error:', err));

    console.log(`WorkspaceWatcher: watching ${this.rootDir} for changes...`);
  }

  /** Stop watching the workspace directory. */
  stop() {
    this.watcher?.close();
    this.watcher = null;
  }

  private isSupportedFile(filePath: string): boolean {
    return this.supportedExtensions.has(extname(filePath));
  }

  private async handleAdd(filePath: string) {
    if (!this.isSupportedFile(filePath)) return;
    try {
      console.log(`WorkspaceWatcher: file added – ${filePath}`);
      await this.indexingService.indexFile(filePath);
    } catch (err) {
      console.error(`Failed to index new file ${filePath}:`, err);
    }
  }

  private async handleChange(filePath: string) {
    if (!this.isSupportedFile(filePath)) return;
    try {
      console.log(`WorkspaceWatcher: file changed – ${filePath}`);
      await this.indexingService.reindexFile(filePath);
    } catch (err) {
      console.error(`Failed to re-index changed file ${filePath}:`, err);
    }
  }

  private async handleUnlink(filePath: string) {
    if (!this.isSupportedFile(filePath)) return;
    try {
      console.log(`WorkspaceWatcher: file removed – ${filePath}`);
      await this.indexingService.removeFile(filePath);
    } catch (err) {
      console.error(`Failed to remove file ${filePath} from index:`, err);
    }
  }
} 