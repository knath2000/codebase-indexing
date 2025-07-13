import { ConfigSchema, Config } from './types.js';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const config = {
    voyageApiKey: process.env.VOYAGE_API_KEY || '',
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantApiKey: process.env.QDRANT_API_KEY,
    collectionName: process.env.COLLECTION_NAME || 'codebase',
    embeddingModel: process.env.EMBEDDING_MODEL || 'voyage-code-3',
    batchSize: parseInt(process.env.BATCH_SIZE || '100'),
    chunkSize: parseInt(process.env.CHUNK_SIZE || '800'), // Privacy-optimized: 800 chars max
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '100'), // Reduced overlap for privacy
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '1048576'), // 1MB
    excludePatterns: process.env.EXCLUDE_PATTERNS?.split(',') || [
      '*.git*',
      'node_modules/**',
      'dist/**',
      'build/**',
      '*.log',
      '*.tmp',
      '*.temp',
      '*.cache',
      '*.lock',
      '*.min.js',
      '*.min.css',
      '*.map',
      // Binary and executable files
      '*.exe',
      '*.bin',
      '*.dll',
      '*.so',
      '*.dylib',
      '*.app',
      '*.deb',
      '*.rpm',
      '*.msi',
      // Archive files
      '*.zip',
      '*.tar',
      '*.gz',
      '*.bz2',
      '*.xz',
      '*.7z',
      '*.rar',
      '*.jar',
      '*.war',
      '*.ear',
      // Image files
      '*.jpg',
      '*.jpeg',
      '*.png',
      '*.gif',
      '*.bmp',
      '*.tiff',
      '*.tif',
      '*.webp',
      '*.svg',
      '*.ico',
      '*.icns',
      // Video files
      '*.mp4',
      '*.avi',
      '*.mov',
      '*.wmv',
      '*.flv',
      '*.webm',
      '*.mkv',
      '*.m4v',
      // Audio files
      '*.mp3',
      '*.wav',
      '*.flac',
      '*.aac',
      '*.ogg',
      '*.wma',
      '*.m4a',
      // Font files
      '*.ttf',
      '*.otf',
      '*.woff',
      '*.woff2',
      '*.eot',
      // Database files
      '*.db',
      '*.sqlite',
      '*.sqlite3',
      '*.mdb',
      // Document files (binary formats)
      '*.pdf',
      '*.doc',
      '*.docx',
      '*.xls',
      '*.xlsx',
      '*.ppt',
      '*.pptx',
      // Other binary formats
      '*.dmg',
      '*.iso',
      '*.img',
      '*.vdi',
      '*.vmdk',
      '*.qcow2'
    ],
    supportedExtensions: process.env.SUPPORTED_EXTENSIONS?.split(',') || [
      '.ts', '.js', '.tsx', '.jsx',
      '.py', '.java', '.cpp', '.c', '.h',
      '.go', '.rs', '.cs', '.php',
      '.rb', '.swift', '.kt', '.scala',
      '.md', '.txt', '.json', '.yaml', '.yml',
      '.html', '.css', '.scss', '.less'
    ],
    llmRerankerTimeoutMs: parseInt(process.env.LLM_RERANKER_TIMEOUT_MS || '45000')
  };

  // Validate configuration
  const validatedConfig = ConfigSchema.parse(config);
  
  if (!validatedConfig.voyageApiKey) {
    throw new Error('VOYAGE_API_KEY environment variable is required');
  }
  
  return validatedConfig;
}

/**
 * Validate configuration
 */
export function validateConfig(config: Config): void {
  if (!config.voyageApiKey) {
    throw new Error('Voyage API key is required');
  }

  if (!config.qdrantUrl) {
    throw new Error('Qdrant URL is required');
  }

  if (config.batchSize <= 0) {
    throw new Error('Batch size must be greater than 0');
  }

  if (config.chunkSize <= 0) {
    throw new Error('Chunk size must be greater than 0');
  }

  // Privacy-focused chunk size validation
  if (config.chunkSize < 100) {
    throw new Error('Chunk size must be at least 100 characters for meaningful code context');
  }

  if (config.chunkSize > 1000) {
    throw new Error('Chunk size must not exceed 1000 characters for privacy protection');
  }

  if (config.chunkOverlap >= config.chunkSize) {
    throw new Error('Chunk overlap must be less than chunk size');
  }

  if (config.maxFileSize <= 0) {
    throw new Error('Max file size must be greater than 0');
  }

  if (config.llmRerankerTimeoutMs < 10000) {
    throw new Error('LLM reranker timeout must be at least 10000 ms');
  }

  if (!config.supportedExtensions.length) {
    throw new Error('At least one supported extension must be specified');
  }

  if (!['voyage-code-3', 'voyage-3.5', 'voyage-3-large', 'voyage-code-2', 'voyage-2', 'voyage-large-2'].includes(config.embeddingModel)) {
    console.warn(`Warning: Embedding model '${config.embeddingModel}' may not be supported`);
  }

  // Privacy validation logging
  console.log(`🔒 Privacy Settings Validated:`);
  console.log(`   - Chunk Size: ${config.chunkSize} chars (100-1000 range)`);
  console.log(`   - Chunk Overlap: ${config.chunkOverlap} chars`);
  console.log(`   - Max File Size: ${Math.round(config.maxFileSize / 1024 / 1024)}MB`);
  console.log(`   - Embeddings: One-way mathematical representations only`);
}

/**
 * Print configuration summary
 */
export function printConfigSummary(config: Config): void {
  console.log('Configuration Summary:');
  console.log(`  Qdrant URL: ${config.qdrantUrl}`);
  console.log(`  Collection: ${config.collectionName}`);
  console.log(`  Embedding Model: ${config.embeddingModel}`);
  console.log(`  Batch Size: ${config.batchSize}`);
  console.log(`  Chunk Size: ${config.chunkSize}`);
  console.log(`  Max File Size: ${config.maxFileSize} bytes`);
  console.log(`  Supported Extensions: ${config.supportedExtensions.join(', ')}`);
  console.log(`  LLM Reranker Timeout: ${config.llmRerankerTimeoutMs} ms`);
  console.log(`  Exclude Patterns: ${config.excludePatterns.join(', ')}`);
} 