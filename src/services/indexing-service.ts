import { glob } from 'glob';
import { stat } from 'fs/promises';
import { join, resolve } from 'path';
import { EventEmitter } from 'events';
import { VoyageClient } from '../clients/voyage-client.js';
import { QdrantVectorClient } from '../clients/qdrant-client.js';
import { CodeParser } from '../parsers/code-parser.js';
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

  constructor(config: Config) {
    super();
    this.config = config;
    this.voyageClient = new VoyageClient(config.voyageApiKey);
    this.qdrantClient = new QdrantVectorClient(
      config.qdrantUrl,
      config.qdrantApiKey,
      config.collectionName,
      this.voyageClient.getEmbeddingDimension(config.embeddingModel)
    );
    this.codeParser = new CodeParser();
    
    this.progress = {
      totalFiles: 0,
      processedFiles: 0,
      totalChunks: 0,
      processedChunks: 0,
      currentFile: '',
      status: IndexingStatus.IDLE,
      startTime: new Date(),
      errors: []
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
      warnings: 0
    };
  }

  /**
   * Initialize the indexing service
   */
  async initialize(): Promise<void> {
    try {
      // Test connections
      const voyageTest = await this.voyageClient.testConnection();
      if (!voyageTest) {
        throw new Error('Failed to connect to Voyage AI');
      }

      const qdrantTest = await this.qdrantClient.testConnection();
      if (!qdrantTest) {
        throw new Error('Failed to connect to Qdrant');
      }

      // Initialize Qdrant collection
      await this.qdrantClient.initializeCollection();

      console.log('Indexing service initialized successfully');
    } catch (error) {
      throw new Error(`Failed to initialize indexing service: ${error}`);
    }
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
      const batchSize = 10;
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

      // Check if file is already indexed and up to date
      const fileStat = await stat(absolutePath);
      const isIndexed = await this.qdrantClient.isFileIndexed(
        absolutePath,
        fileStat.mtime.getTime()
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

    // Filter by supported extensions
    const supportedFiles = allFiles.filter(file => {
      const ext = file.split('.').pop()?.toLowerCase();
      return ext && this.config.supportedExtensions.includes(`.${ext}`);
    });

    // Filter by file size
    const validFiles: string[] = [];
    for (const file of supportedFiles) {
      try {
        const fileStat = await stat(file);
        if (fileStat.size <= this.config.maxFileSize) {
          validFiles.push(file);
        }
      } catch (error) {
        console.warn(`Could not stat file ${file}:`, error);
      }
    }

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
    
    if (chunks.length === 0) {
      console.log('❌ No chunks to process, returning early');
      return;
    }

    console.log('📊 Setting status to EMBEDDING');
    this.progress.status = IndexingStatus.EMBEDDING;
    this.emit('progress', this.progress);

    const batchSize = this.config.batchSize;
    console.log(`📦 Using batch size: ${batchSize}`);
    const embeddings: EmbeddingVector[] = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map(chunk => chunk.content);
      
      console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(chunks.length/batchSize)} with ${batch.length} chunks`);
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

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
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
            metadata: chunk.metadata
          };

          embeddings.push({
            id: chunk.id,
            vector,
            payload
          });
        }

        this.progress.processedChunks += batch.length;
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

    const storeBatchSize = 100;
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
   * Update statistics
   */
  private updateStats(chunks: CodeChunk[]): void {
    this.stats.totalFiles = this.progress.processedFiles;
    this.stats.totalChunks = chunks.length;
    this.stats.totalSize = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    this.stats.averageChunkSize = this.stats.totalSize / this.stats.totalChunks || 0;
    this.stats.lastIndexed = new Date();
    this.stats.indexingDuration = Date.now() - this.progress.startTime.getTime();
    this.stats.errors = this.progress.errors.filter(e => e.severity === 'error' || e.severity === 'critical').length;
    this.stats.warnings = this.progress.errors.filter(e => e.severity === 'warning').length;

    // Language distribution
    this.stats.languageDistribution = {};
    chunks.forEach(chunk => {
      this.stats.languageDistribution[chunk.language] = 
        (this.stats.languageDistribution[chunk.language] || 0) + 1;
    });

    // Chunk type distribution
    this.stats.chunkTypeDistribution = {};
    chunks.forEach(chunk => {
      this.stats.chunkTypeDistribution[chunk.chunkType] = 
        (this.stats.chunkTypeDistribution[chunk.chunkType] || 0) + 1;
    });

    // Find largest file
    const largestChunk = chunks.reduce((largest, chunk) => 
      chunk.content.length > largest.content.length ? chunk : largest
    );
    this.stats.largestFile = largestChunk.filePath;
  }
} 