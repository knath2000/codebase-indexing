import { createHash } from 'crypto';
import { createModuleLogger } from '../logging/logger.js'
import { readdir, stat, readFile } from 'fs/promises';
import { join, resolve, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

export interface WorkspaceInfo {
  id: string;
  name: string;
  rootPath: string;
  type: 'single' | 'multi-root' | 'git' | 'npm' | 'unknown';
  folders: string[];
  gitRemote?: string;
  packageName?: string;
  lastAccessed: Date;
  collectionName: string;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  excludePatterns: string[];
  supportedExtensions: string[];
  chunkSize: number;
  enableLLMReranking: boolean;
  customSettings: Record<string, any>;
}

/**
 * Enhanced Workspace Manager that provides superior multi-workspace handling
 * compared to Cursor's built-in capabilities
 */
export class WorkspaceManager extends EventEmitter {
  private workspaces = new Map<string, WorkspaceInfo>();
  private currentWorkspace: WorkspaceInfo | null = null;
  private workspaceProfiles = new Map<string, WorkspaceProfile>();
  private readonly log = createModuleLogger('workspace-manager')

  constructor() {
    super();
  }

  /**
   * Detect and register current workspace with enhanced intelligence
   */
  async detectCurrentWorkspace(workspacePath: string = process.cwd()): Promise<WorkspaceInfo> {
    const absolutePath = resolve(workspacePath);
    this.log.info({ path: absolutePath }, 'Detecting workspace type')

    // Check for VSCode multi-root workspace files
    const multiRootWorkspace = await this.detectMultiRootWorkspace(absolutePath);
    if (multiRootWorkspace) {
      this.log.info({ name: multiRootWorkspace.name }, 'Detected multi-root workspace')
      return this.registerWorkspace(multiRootWorkspace);
    }

    // Check for Git repository
    const gitWorkspace = await this.detectGitWorkspace(absolutePath);
    if (gitWorkspace) {
      this.log.info({ name: gitWorkspace.name }, 'Detected Git workspace')
      return this.registerWorkspace(gitWorkspace);
    }

    // Check for npm/package.json workspace
    const npmWorkspace = await this.detectNpmWorkspace(absolutePath);
    if (npmWorkspace) {
      this.log.info({ name: npmWorkspace.name }, 'Detected npm workspace')
      return this.registerWorkspace(npmWorkspace);
    }

    // Fallback to directory-based workspace
    const directoryWorkspace = await this.createDirectoryWorkspace(absolutePath);
    this.log.info({ name: directoryWorkspace.name }, 'Created directory workspace')
    return this.registerWorkspace(directoryWorkspace);
  }

  /**
   * Detect VSCode multi-root workspace from .code-workspace files
   */
  private async detectMultiRootWorkspace(rootPath: string): Promise<WorkspaceInfo | null> {
    try {
      const files = await readdir(rootPath);
      const workspaceFiles = files.filter(f => f.endsWith('.code-workspace'));
      
      if (workspaceFiles.length === 0) return null;

      // Use the first .code-workspace file found
      const workspaceFile = workspaceFiles[0];
      const workspaceFilePath = join(rootPath, workspaceFile);
      const content = await readFile(workspaceFilePath, 'utf-8');
      const config = JSON.parse(content);

      if (!config.folders || !Array.isArray(config.folders)) return null;

      const folders = config.folders
        .map((folder: any) => {
          if (typeof folder === 'string') return resolve(rootPath, folder);
          if (folder.path) return resolve(rootPath, folder.path);
          return null;
        })
        .filter(Boolean) as string[];

      const workspaceId = this.generateWorkspaceId('multi-root', rootPath, folders);
      const workspaceName = basename(workspaceFile, '.code-workspace');

      return {
        id: workspaceId,
        name: workspaceName,
        rootPath,
        type: 'multi-root',
        folders,
        lastAccessed: new Date(),
        collectionName: `workspace_${workspaceId.substring(0, 12)}`
      };
    } catch (error) {
      this.log.warn({ err: error }, 'Failed to detect multi-root workspace')
      return null;
    }
  }

  /**
   * Detect Git workspace with remote tracking
   */
  private async detectGitWorkspace(rootPath: string): Promise<WorkspaceInfo | null> {
    try {
      // Check if .git directory exists
      const gitDir = join(rootPath, '.git');
      const gitStat = await stat(gitDir);
      if (!gitStat.isDirectory()) return null;

      // Get git remote origin
      let gitRemote: string | undefined;
      try {
        const { stdout } = await execAsync('git remote get-url origin', { cwd: rootPath });
        gitRemote = stdout.trim();
      } catch {
        // No remote configured
      }

      // Get repository name from remote or directory
      let repoName = basename(rootPath);
      if (gitRemote) {
        const match = gitRemote.match(/\/([^\/]+?)(?:\.git)?$/);
        if (match) repoName = match[1];
      }

      const workspaceId = this.generateWorkspaceId('git', rootPath, [rootPath], gitRemote);

             const workspace: WorkspaceInfo = {
         id: workspaceId,
         name: repoName,
         rootPath,
         type: 'git',
         folders: [rootPath],
         lastAccessed: new Date(),
         collectionName: `workspace_${workspaceId.substring(0, 12)}`
       };
       
       if (gitRemote) {
         workspace.gitRemote = gitRemote;
       }
       
       return workspace;
    } catch (error) {
      return null;
    }
  }

  /**
   * Detect npm workspace from package.json
   */
  private async detectNpmWorkspace(rootPath: string): Promise<WorkspaceInfo | null> {
    try {
      const packagePath = join(rootPath, 'package.json');
      const packageStat = await stat(packagePath);
      if (!packageStat.isFile()) return null;

      const content = await readFile(packagePath, 'utf-8');
      const pkg = JSON.parse(content);
      
      const packageName = pkg.name || basename(rootPath);
      const workspaceId = this.generateWorkspaceId('npm', rootPath, [rootPath], packageName);

      return {
        id: workspaceId,
        name: packageName,
        rootPath,
        type: 'npm',
        folders: [rootPath],
        packageName,
        lastAccessed: new Date(),
        collectionName: `workspace_${workspaceId.substring(0, 12)}`
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Create basic directory workspace as fallback
   */
  private async createDirectoryWorkspace(rootPath: string): Promise<WorkspaceInfo> {
    const dirName = basename(rootPath);
    const workspaceId = this.generateWorkspaceId('single', rootPath, [rootPath]);

    return {
      id: workspaceId,
      name: dirName,
      rootPath,
      type: 'single',
      folders: [rootPath],
      lastAccessed: new Date(),
      collectionName: `workspace_${workspaceId.substring(0, 12)}`
    };
  }

  /**
   * Generate cryptographic workspace ID for perfect isolation
   */
  private generateWorkspaceId(type: string, rootPath: string, folders: string[], extra?: string): string {
    const hash = createHash('sha256');
    hash.update(type);
    hash.update(rootPath);
    folders.forEach(folder => hash.update(folder));
    if (extra) hash.update(extra);
    return hash.digest('hex');
  }

  /**
   * Register workspace and set as current
   */
  private registerWorkspace(workspace: WorkspaceInfo): WorkspaceInfo {
    this.workspaces.set(workspace.id, workspace);
    
    // Check if workspace has changed
    const wasCurrentWorkspace = this.currentWorkspace?.id === workspace.id;
    this.currentWorkspace = workspace;
    
    if (!wasCurrentWorkspace) {
      this.log.info({
        name: workspace.name,
        type: workspace.type,
        collection: workspace.collectionName,
        folders: workspace.folders.length
      }, 'Workspace changed')
      this.emit('workspace-changed', workspace);
    } else {
      this.log.debug({ name: workspace.name }, 'Current workspace confirmed')
    }

    return workspace;
  }

  /**
   * Get current workspace info
   */
  getCurrentWorkspace(): WorkspaceInfo | null {
    return this.currentWorkspace;
  }

  /**
   * Get workspace by ID
   */
  getWorkspace(id: string): WorkspaceInfo | null {
    return this.workspaces.get(id) || null;
  }

  /**
   * List all registered workspaces
   */
  getAllWorkspaces(): WorkspaceInfo[] {
    return Array.from(this.workspaces.values())
      .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());
  }

  /**
   * Switch to a different workspace
   */
  async switchToWorkspace(workspaceId: string): Promise<WorkspaceInfo | null> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      this.log.warn({ workspaceId }, 'Workspace not found')
      return null;
    }

    workspace.lastAccessed = new Date();
    this.currentWorkspace = workspace;
    
    this.log.info({ name: workspace.name }, 'Switched workspace')
    this.emit('workspace-changed', workspace);
    
    return workspace;
  }

  /**
   * Create workspace profile for custom settings
   */
  createWorkspaceProfile(workspace: WorkspaceInfo, customSettings: Partial<WorkspaceProfile>): WorkspaceProfile {
    const profile: WorkspaceProfile = {
      id: workspace.id,
      name: workspace.name,
      excludePatterns: customSettings.excludePatterns || [],
      supportedExtensions: customSettings.supportedExtensions || [],
      chunkSize: customSettings.chunkSize || 800,
      enableLLMReranking: customSettings.enableLLMReranking ?? true,
      customSettings: customSettings.customSettings || {}
    };

    this.workspaceProfiles.set(workspace.id, profile);
    this.log.info({ name: workspace.name }, 'Created workspace profile')
    
    return profile;
  }

  /**
   * Get workspace profile with fallbacks
   */
  getWorkspaceProfile(workspaceId: string): WorkspaceProfile | null {
    return this.workspaceProfiles.get(workspaceId) || null;
  }

  /**
   * Clean up stale workspaces (not accessed in 30 days)
   */
  async cleanupStaleWorkspaces(): Promise<string[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const staleWorkspaces: string[] = [];

    for (const [id, workspace] of this.workspaces) {
      if (workspace.lastAccessed < thirtyDaysAgo) {
        staleWorkspaces.push(id);
        this.workspaces.delete(id);
        this.workspaceProfiles.delete(id);
      }
    }

    if (staleWorkspaces.length > 0) {
      this.log.info({ count: staleWorkspaces.length }, 'Cleaned up stale workspaces')
    }

    return staleWorkspaces;
  }

  /**
   * Get workspace statistics
   */
  getWorkspaceStats(): { totalWorkspaces: number; currentWorkspace: string | null; recentWorkspaces: string[] } {
    const recentWorkspaces = this.getAllWorkspaces()
      .slice(0, 5)
      .map(w => w.name);

    return {
      totalWorkspaces: this.workspaces.size,
      currentWorkspace: this.currentWorkspace?.name || null,
      recentWorkspaces
    };
  }

  /**
   * Export workspace configuration for backup/sync
   */
  exportConfiguration(): { workspaces: WorkspaceInfo[]; profiles: WorkspaceProfile[] } {
    return {
      workspaces: Array.from(this.workspaces.values()),
      profiles: Array.from(this.workspaceProfiles.values())
    };
  }

  /**
   * Import workspace configuration from backup/sync
   */
  importConfiguration(config: { workspaces: WorkspaceInfo[]; profiles: WorkspaceProfile[] }): void {
    // Import workspaces
    config.workspaces.forEach(workspace => {
      this.workspaces.set(workspace.id, workspace);
    });

    // Import profiles
    config.profiles.forEach(profile => {
      this.workspaceProfiles.set(profile.id, profile);
    });

    this.log.info({ workspaces: config.workspaces.length, profiles: config.profiles.length }, 'Imported workspace configuration')
  }
} 