import { glob } from 'glob';
import { stat, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { EventEmitter } from 'events';
import { VoyageClient } from '../clients/voyage-client.js';
import { QdrantVectorClient } from '../clients/qdrant-client.js';
import { CodeParser } from '../parsers/code-parser.js';
import { WorkspaceManager, WorkspaceInfo } from './workspace-manager.js';
import {
  Config,
  CodeChunk,
  EmbeddingVector,
  EmbeddingPayload,
  IndexingProgress,
  IndexingStatus,
  IndexingError,
  IndexStats
} from '../types.js';

export class IndexingService extends EventEmitter {
  private voyageClient: VoyageClient;
  private qdrantClient: QdrantVectorClient;
  private codeParser: CodeParser;
  private config: Config;
  private progress: IndexingProgress;
  private stats: IndexStats;
  private workspaceManager: WorkspaceManager;
  private currentWorkspace: WorkspaceInfo | null = null;

  constructor(config: Config, workspaceManager?: WorkspaceManager) {
    super();
    this.config = config;
    this.workspaceManager = workspaceManager || new WorkspaceManager();
    this.voyageClient = new VoyageClient(config.voyageApiKey);
    
    // Create a temporary Qdrant client with default collection
    // This will be updated during initialize() with workspace-specific collection
    this.qdrantClient = new QdrantVectorClient(
      config.qdrantUrl,
      config.qdrantApiKey,
      config.collectionName, // Temporary, will be replaced
      this.voyageClient.getEmbeddingDimension(config.embeddingModel)
    );
    this.codeParser = new CodeParser(config);
    
    this.progress = {
      totalFiles: 0,
      processedFiles: 0,
      totalChunks: 0,
      processedChunks: 0,
      currentFile: '',
      status: IndexingStatus.IDLE,
      startTime: new Date(),
      errors: [],
      incrementalUpdates: 0,
      skippedFiles: 0,
      cacheHits: 0
    };

    this.stats = {
      totalFiles: 0,
      totalChunks: 0,
      totalSize: 0,
      languageDistribution: {},
      chunkTypeDistribution: {},
      lastIndexed: new Date(),
      indexingDuration: 0,
      averageChunkSize: 0,
      largestFile: '',
      errors: 0,
      warnings: 0,
      incrementalUpdates: 0,
      cacheHitRate: 0,
      averageComplexity: 0,
      tokensIndexed: 0,
      memoryUsage: 0,
      searchQueriesServed: 0,
      averageSearchLatency: 0
    };
  }

  /**
   * Initialize the indexing service with enhanced workspace detection
   */
  async initialize(): Promise<void> {
    try {
      // Detect current workspace first
      this.currentWorkspace = await this.workspaceManager.detectCurrentWorkspace();
      
      // Update Qdrant client to use workspace-specific collection
      this.updateQdrantClientForWorkspace(this.currentWorkspace);
      
      // Test connections
      const voyageTest = await this.voyageClient.testConnection();
      if (!voyageTest) {
        throw new Error('Failed to connect to Voyage AI');
      }

      const qdrantTest = await this.qdrantClient.testConnection();
      if (!qdrantTest) {
        throw new Error('Failed to connect to Qdrant');
      }

      // Initialize workspace-specific Qdrant collection
      await this.qdrantClient.initializeCollection();

      console.log(`🔧 IndexingService initialized for workspace: ${this.currentWorkspace.name}`);
      console.log(`📊 Using collection: ${this.currentWorkspace.collectionName}`);
      console.log(`📁 Workspace type: ${this.currentWorkspace.type}`);
      console.log(`🎯 Folders: ${this.currentWorkspace.folders.length} folder(s)`);
    } catch (error) {
      throw new Error(`Failed to initialize indexing service: ${error}`);
    }
  }

  /**
   * Update Qdrant client for workspace-specific collection
   */
  private updateQdrantClientForWorkspace(workspace: WorkspaceInfo): void {
    this.qdrantClient = new QdrantVectorClient(
      this.config.qdrantUrl,
      this.config.qdrantApiKey,
      workspace.collectionName, // Use workspace-specific collection name
      this.voyageClient.getEmbeddingDimension(this.config.embeddingModel)
    );
    
    console.log(`🔄 Updated Qdrant client for workspace collection: ${workspace.collectionName}`);
  }

  /**
   * Index a directory recursively
   */
  async indexDirectory(directoryPath: string): Promise<IndexStats> {
    const absolutePath = resolve(directoryPath);
    
    try {
      this.progress.status = IndexingStatus.SCANNING;
      this.progress.startTime = new Date();
      this.emit('progress', this.progress);

      // Find all files to index
      const files = await this.findFiles(absolutePath);
      this.progress.totalFiles = files.length;
      
      console.log(`Found ${files.length} files to index`);
      this.emit('progress', this.progress);

      // Process files in batches
      const batchSize = 10; // TODO: make configurable if needed
      const allChunks: CodeChunk[] = [];
      console.log(`📁 Processing ${files.length} files in batches of ${batchSize}`);

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        console.log(`🔄 Processing file batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(files.length/batchSize)}`);
        const batchChunks = await this.processBatch(batch);
        allChunks.push(...batchChunks);
        console.log(`📊 Accumulated ${allChunks.length} chunks so far`);
      }

      console.log(`🎯 Finished processing all files. Total chunks: ${allChunks.length}`);
      this.progress.totalChunks = allChunks.length;
      this.progress.status = IndexingStatus.EMBEDDING;
      this.emit('progress', this.progress);

      // Generate embeddings and store
      console.log(`🚀 Starting embedding and storage phase for ${allChunks.length} chunks`);
      await this.embedAndStore(allChunks);
      console.log('✅ Embedding and storage completed successfully');

      // Update stats
      this.updateStats(allChunks);
      
      this.progress.status = IndexingStatus.COMPLETED;
      this.emit('progress', this.progress);

      return this.stats;
    } catch (error) {
      this.progress.status = IndexingStatus.ERROR;
      this.progress.errors.push({
        filePath: '',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
        severity: 'critical'
      });
      this.emit('progress', this.progress);
      throw error;
    }
  }

  /**
   * Index a single file
   */
  async indexFile(filePath: string): Promise<CodeChunk[]> {
    const absolutePath = resolve(filePath);
    
    try {
      this.progress.status = IndexingStatus.PARSING;
      this.progress.currentFile = filePath;
      this.emit('progress', this.progress);

      // Check if file should be skipped
      if (this.shouldSkipFile(absolutePath)) {
        return [];
      }

      // Check file size and binary content
      const fileStats = await stat(absolutePath);
      if (fileStats.size > this.config.maxFileSize) {
        console.log(`⚠️  Skipping ${filePath}: too large (${Math.round(fileStats.size / 1024 / 1024 * 100) / 100}MB > ${Math.round(this.config.maxFileSize / 1024 / 1024)}MB)`);
        return [];
      }

      // Skip empty files
      if (fileStats.size === 0) {
        console.log(`⚠️  Skipping ${filePath}: empty file`);
        return [];
      }

      // Check if file is binary
      const isBinary = await this.isBinaryFile(absolutePath);
      if (isBinary) {
        console.log(`⚠️  Skipping ${filePath}: detected as binary file`);
        return [];
      }

      // Check if file is already indexed and up to date
      const isIndexed = await this.qdrantClient.isFileIndexed(
        absolutePath,
        fileStats.mtime.getTime()
      );

      if (isIndexed) {
        console.log(`File ${filePath} is already indexed and up to date`);
        return [];
      }

      // Parse the file
      const chunks = await this.codeParser.parseFile(absolutePath);
      
      if (chunks.length === 0) {
        return [];
      }

      // Generate embeddings and store
      await this.embedAndStore(chunks);

      return chunks;
    } catch (error) {
      const indexingError: IndexingError = {
        filePath,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
        severity: 'error'
      };
      
      this.progress.errors.push(indexingError);
      this.emit('progress', this.progress);
      
      console.error(`Error indexing file ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Re-index a file (force update)
   */
  async reindexFile(filePath: string): Promise<CodeChunk[]> {
    const absolutePath = resolve(filePath);
    
    try {
      // Delete existing embeddings for this file
      await this.qdrantClient.deleteByFilePath(absolutePath);
      
      // Index the file
      return await this.indexFile(filePath);
    } catch (error) {
      console.error(`Error re-indexing file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Remove a file from the index
   */
  async removeFile(filePath: string): Promise<void> {
    const absolutePath = resolve(filePath);
    
    try {
      await this.qdrantClient.deleteByFilePath(absolutePath);
      console.log(`Removed file ${filePath} from index`);
    } catch (error) {
      console.error(`Error removing file ${filePath} from index:`, error);
      throw error;
    }
  }

  /**
   * Clear entire index
   */
  async clearIndex(): Promise<void> {
    try {
      await this.qdrantClient.clearCollection();
      console.log('Index cleared successfully');
    } catch (error) {
      console.error('Error clearing index:', error);
      throw error;
    }
  }

  /**
   * Get indexing progress
   */
  getProgress(): IndexingProgress {
    return { ...this.progress };
  }

  /**
   * Get indexing statistics
   */
  getStats(): IndexStats {
    return { ...this.stats };
  }

  /**
   * Get collection info from Qdrant
   */
  async getCollectionInfo(): Promise<any> {
    return await this.qdrantClient.getCollectionInfo();
  }

  /**
   * Count total indexed chunks
   */
  async countIndexedChunks(): Promise<number> {
    return await this.qdrantClient.countPoints();
  }

  /**
   * Find files to index
   */
  private async findFiles(directoryPath: string): Promise<string[]> {
    const pattern = join(directoryPath, '**/*');
    const allFiles = await glob(pattern, {
      nodir: true,
      ignore: this.config.excludePatterns
    });

    console.log(`Found ${allFiles.length} files after exclude pattern filtering`);

    // Hardcoded filter to exclude node_modules paths
    const filteredFiles = allFiles.filter(file => !file.includes('node_modules'));

    // Filter by supported extensions
    const supportedFiles = filteredFiles.filter(file => {
      const ext = file.split('.').pop()?.toLowerCase();
      return ext && this.config.supportedExtensions.includes(`.${ext}`);
    });

       console.log(`📝 ${supportedFiles.length} files have supported extensions`);

    // Filter by file size and binary content
    const validFiles: string[] = [];
    let skippedSize = 0;
    let skippedBinary = 0;

    for (const file of supportedFiles) {
      try {
        const fileStat = await stat(file);
        
        // Check file size (1MB limit)
        if (fileStat.size > this.config.maxFileSize) {
          skippedSize++;
          console.log(`⚠️  Skipping ${file}: too large (${Math.round(fileStat.size / 1024 / 1024 * 100) / 100}MB > ${Math.round(this.config.maxFileSize / 1024 / 1024)}MB)`);
          continue;
        }

        // Skip empty files
        if (fileStat.size === 0) {
          console.log(`⚠️  Skipping ${file}: empty file`);
          continue;
        }

        // Check if file is binary
        const isBinary = await this.isBinaryFile(file);
        if (isBinary) {
          skippedBinary++;
          console.log(`⚠️  Skipping ${file}: detected as binary file`);
          continue;
        }

        validFiles.push(file);
      } catch (error) {
        console.warn(`❌ Could not process file ${file}:`, error);
      }
    }

    console.log(`✅ Final result: ${validFiles.length} valid files to index`);
    console.log(`📊 Filtering summary:`);
    console.log(`   - Skipped due to size (>${Math.round(this.config.maxFileSize / 1024 / 1024)}MB): ${skippedSize}`);
    console.log(`   - Skipped due to binary content: ${skippedBinary}`);
    console.log(`   - Valid text files: ${validFiles.length}`);

    return validFiles;
  }

  /**
   * Process a batch of files
   */
  private async processBatch(files: string[]): Promise<CodeChunk[]> {
    const chunks: CodeChunk[] = [];
    
    for (const file of files) {
      this.progress.currentFile = file;
      this.progress.status = IndexingStatus.PARSING;
      this.emit('progress', this.progress);

      try {
        const fileChunks = await this.codeParser.parseFile(file);
        chunks.push(...fileChunks);
        
        this.progress.processedFiles++;
        this.emit('progress', this.progress);
      } catch (error) {
        const indexingError: IndexingError = {
          filePath: file,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
          severity: 'error'
        };
        
        this.progress.errors.push(indexingError);
        this.emit('progress', this.progress);
      }
    }

    return chunks;
  }

  /**
   * Generate embeddings and store in Qdrant
   */
  private async embedAndStore(chunks: CodeChunk[]): Promise<void> {
    console.log(`🚀 Starting embedAndStore with ${chunks.length} chunks`);
    
    // Filter out any null/undefined chunks early
    const validChunksOnly = chunks.filter(chunk => chunk && chunk.content && chunk.content.trim().length > 0);
    console.log(`🔍 After filtering: ${validChunksOnly.length} valid chunks (${chunks.length - validChunksOnly.length} filtered out)`);
    
    if (validChunksOnly.length === 0) {
      console.log('❌ No valid chunks to process, returning early');
      return;
    }
    
    // Use filtered chunks for the rest of the method
    chunks = validChunksOnly;

    console.log('📊 Setting status to EMBEDDING');
    this.progress.status = IndexingStatus.EMBEDDING;
    this.emit('progress', this.progress);

    const batchSize = this.config.batchSize;
    console.log(`📦 Using batch size: ${batchSize}`);
    const embeddings: EmbeddingVector[] = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      // Filter out any null/undefined chunks that might have slipped through
      const validChunks = batch.filter(chunk => chunk && chunk.content);
      if (validChunks.length === 0) {
        console.log(`⚠️ Skipping batch ${Math.floor(i/batchSize) + 1} - no valid chunks`);
        continue;
      }
      
      const texts = validChunks.map(chunk => chunk.content);
      
      console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(chunks.length/batchSize)} with ${validChunks.length} valid chunks (${batch.length} total)`);
      console.log(`📝 First chunk preview: ${texts[0]?.substring(0, 100)}...`);
      
      try {
        console.log(`🌐 Calling Voyage API with model: ${this.config.embeddingModel}`);
        const vectors = await this.voyageClient.generateEmbeddingsBatch(
          texts,
          this.config.embeddingModel,
          'document',
          batchSize
        );
        console.log(`✅ Received ${vectors.length} embeddings from Voyage API`);

        for (let j = 0; j < validChunks.length; j++) {
          const chunk = validChunks[j];
          const vector = vectors[j];
          
          const payload: EmbeddingPayload = {
            content: chunk.content,
            filePath: chunk.filePath,
            language: chunk.language,
            chunkType: chunk.chunkType,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            functionName: chunk.functionName || undefined,
            className: chunk.className || undefined,
            moduleName: chunk.moduleName || undefined,
            contentHash: chunk.contentHash,
            tokenCount: this.estimateTokenCount(chunk.content),
            metadata: chunk.metadata,
            fileKind: this.getFileKind(chunk.filePath)
          };

          embeddings.push({
            id: chunk.id,
            vector,
            payload
          });
        }

        this.progress.processedChunks += validChunks.length;
        this.emit('progress', this.progress);
        console.log(`📈 Progress: ${this.progress.processedChunks}/${chunks.length} chunks processed`);
      } catch (error) {
        console.error(`❌ Error generating embeddings for batch:`, error);
        throw error;
      }
    }

    console.log(`🎯 Completed embedding generation for all ${embeddings.length} chunks`);
    
    // Store embeddings in Qdrant
    console.log('💾 Starting Qdrant storage phase');
    this.progress.status = IndexingStatus.STORING;
    this.emit('progress', this.progress);

    const storeBatchSize = 100; // TODO: make configurable if needed
    console.log(`📦 Storing in batches of ${storeBatchSize}`);
    
    for (let i = 0; i < embeddings.length; i += storeBatchSize) {
      const batch = embeddings.slice(i, i + storeBatchSize);
      console.log(`💾 Storing batch ${Math.floor(i/storeBatchSize) + 1}/${Math.ceil(embeddings.length/storeBatchSize)} with ${batch.length} embeddings`);
      await this.qdrantClient.storeEmbeddings(batch);
    }
    
    console.log('✅ Successfully completed embedAndStore process');
  }

  /**
   * Check if file should be skipped
   */
  private shouldSkipFile(filePath: string): boolean {
    // Check against exclude patterns
    for (const pattern of this.config.excludePatterns) {
      if (filePath.includes(pattern.replace('*', ''))) {
        return true;
      }
    }

    // Check file extension
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!ext || !this.config.supportedExtensions.includes(`.${ext}`)) {
      return true;
    }

    return false;
  }

  /**
   * Check if file is binary by examining its content
   */
  private async isBinaryFile(filePath: string): Promise<boolean> {
    try {
      // Read first 8KB of the file to check for binary content
      const buffer = await readFile(filePath, { flag: 'r' });
      const sampleSize = Math.min(8192, buffer.length);
      const sample = buffer.subarray(0, sampleSize);

      // Check for null bytes (common in binary files)
      for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0) {
          return true;
        }
      }

      // Check for high percentage of non-printable characters
      let nonPrintableCount = 0;
      for (let i = 0; i < sample.length; i++) {
        const byte = sample[i];
        // Consider bytes outside printable ASCII range (except common whitespace)
        if (byte < 9 || (byte > 13 && byte < 32) || byte > 126) {
          nonPrintableCount++;
        }
      }

      // If more than 30% of bytes are non-printable, consider it binary
      const nonPrintableRatio = nonPrintableCount / sample.length;
      if (nonPrintableRatio > 0.3) {
        return true;
      }

      // Check for common binary file signatures (magic numbers)
      const binarySignatures = [
        [0x89, 0x50, 0x4E, 0x47], // PNG
        [0xFF, 0xD8, 0xFF], // JPEG
        [0x47, 0x49, 0x46], // GIF
        [0x25, 0x50, 0x44, 0x46], // PDF
        [0x50, 0x4B, 0x03, 0x04], // ZIP
        [0x50, 0x4B, 0x05, 0x06], // ZIP (empty)
        [0x50, 0x4B, 0x07, 0x08], // ZIP (spanned)
        [0x1F, 0x8B], // GZIP
        [0x42, 0x5A, 0x68], // BZIP2
        [0x7F, 0x45, 0x4C, 0x46], // ELF executable
        [0x4D, 0x5A], // Windows PE executable
        [0xCA, 0xFE, 0xBA, 0xBE], // Java class file
        [0xFE, 0xED, 0xFA, 0xCE], // Mach-O binary (32-bit)
        [0xFE, 0xED, 0xFA, 0xCF], // Mach-O binary (64-bit)
      ];

      for (const signature of binarySignatures) {
        if (sample.length >= signature.length) {
          let matches = true;
          for (let i = 0; i < signature.length; i++) {
            if (sample[i] !== signature[i]) {
              matches = false;
              break;
            }
          }
          if (matches) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      // If we can't read the file, assume it might be binary to be safe
      console.warn(`Could not check if file ${filePath} is binary:`, error);
      return true;
    }
  }

  /**
   * Estimate token count for content (rough approximation)
   */
  private estimateTokenCount(content: string): number {
    // Rough approximation: 1 token ≈ 4 characters for code
    return Math.ceil(content.length / 4);
  }

  /**
   * Determines if a file contains implementation code or documentation
   */
  private getFileKind(filePath: string): 'code' | 'docs' {
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    const fileName = filePath.toLowerCase();
    
    // Documentation file extensions and patterns
    const docExtensions = ['md', 'txt', 'rst', 'adoc', 'asciidoc'];
    const docPatterns = ['readme', 'changelog', 'license', 'contributing', 'docs/', 'documentation/', 'memory-bank/'];
    
    // Check extension
    if (docExtensions.includes(extension)) {
      return 'docs';
    }
    
    // Check file path patterns
    if (docPatterns.some(pattern => fileName.includes(pattern))) {
      return 'docs';
    }
    
    // Default to code for programming language files
    return 'code';
  }

  /**
   * Update statistics
   */
  private updateStats(chunks: CodeChunk[]): void {
    // Filter out null chunks that might have been created during parsing
    const validChunks = chunks.filter(chunk => chunk && chunk.content != null);
    
    this.stats.totalFiles = this.progress.processedFiles;
    this.stats.totalChunks = validChunks.length;
    this.stats.totalSize = validChunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    this.stats.averageChunkSize = this.stats.totalSize / this.stats.totalChunks || 0;
    this.stats.lastIndexed = new Date();
    this.stats.indexingDuration = Date.now() - this.progress.startTime.getTime();
    this.stats.errors = this.progress.errors.filter(e => e.severity === 'error' || e.severity === 'critical').length;
    this.stats.warnings = this.progress.errors.filter(e => e.severity === 'warning').length;

    // Language distribution
    this.stats.languageDistribution = {};
    validChunks.forEach(chunk => {
      this.stats.languageDistribution[chunk.language] = 
        (this.stats.languageDistribution[chunk.language] || 0) + 1;
    });

    // Chunk type distribution
    this.stats.chunkTypeDistribution = {};
    validChunks.forEach(chunk => {
      this.stats.chunkTypeDistribution[chunk.chunkType] = 
        (this.stats.chunkTypeDistribution[chunk.chunkType] || 0) + 1;
    });

    // Find largest file - only if we have valid chunks
    if (validChunks.length > 0) {
      const largestChunk = validChunks.reduce((largest, chunk) => 
      chunk.content.length > largest.content.length ? chunk : largest
    );
    this.stats.largestFile = largestChunk.filePath;
    } else {
      this.stats.largestFile = 'N/A';
    }
  }
} 