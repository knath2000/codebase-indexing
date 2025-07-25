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
      'node_modules/**',
      'dist/**',
      'build/**',
      '*.git*',
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
    llmRerankerTimeoutMs: parseInt(process.env.LLM_RERANKER_TIMEOUT_MS || '25000'),
    llmRerankerBaseUrl: process.env.LLM_RERANKER_BASE_URL && process.env.LLM_RERANKER_PROJECT_ID 
      ? `${process.env.LLM_RERANKER_BASE_URL}/${process.env.LLM_RERANKER_PROJECT_ID}/v1`
      : process.env.LLM_RERANKER_BASE_URL,
    llmRerankerProjectId: process.env.LLM_RERANKER_PROJECT_ID, // LangDB Project ID
    keywordSearchTimeoutMs: parseInt(process.env.KEYWORD_SEARCH_TIMEOUT_MS || '10000'),
    keywordSearchMaxChunks: parseInt(process.env.KEYWORD_SEARCH_MAX_CHUNKS || '20000'),
    hybridSearchAlpha: parseFloat(process.env.HYBRID_SEARCH_ALPHA || '0.7'),
    enableLLMReranking: process.env.ENABLE_LLM_RERANKING ? process.env.ENABLE_LLM_RERANKING !== 'false' : true,
    llmRerankerApiKey: process.env.LLM_RERANKER_API_KEY,
    llmRerankerModel: process.env.LLM_RERANKER_MODEL || 'anthropic/claude-3-haiku-20240307',
    fileWatchDebounceMs: parseInt(process.env.FILE_WATCH_DEBOUNCE_MS || '1000'),
    mcpSchemaVersion: process.env.MCP_SCHEMA_VERSION || '2024-11-05',
    // Logging configuration
    logLevel: (process.env.LOG_LEVEL || 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    logPretty: process.env.LOG_PRETTY === 'true',
    logRequestIds: process.env.LOG_REQUEST_IDS !== 'false',
    // Rate limiting configuration
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    rateLimitTokens: parseInt(process.env.RATE_LIMIT_TOKENS || '30'),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    rateLimitMemoryTTLMs: parseInt(process.env.RATE_LIMIT_MEMORY_TTL_MS || '300000'),
    rateLimitUseSessionId: process.env.RATE_LIMIT_USE_SESSION_ID !== 'false',
    // File watcher configuration
    watcherEnabled: process.env.WATCHER_ENABLED !== 'false',
    watcherDebounceMs: parseInt(process.env.WATCHER_DEBOUNCE_MS || '300'),
    watcherQueueConcurrency: parseInt(process.env.WATCHER_QUEUE_CONCURRENCY || '1'),
    watcherAutoRestart: process.env.WATCHER_AUTO_RESTART !== 'false',
    // Session store configuration
    sessionStoreEnabled: process.env.SESSION_STORE_ENABLED !== 'false',
    sessionStorePath: process.env.SESSION_STORE_PATH || '/data/session-store.sqlite',
    sessionStoreTTLMs: parseInt(process.env.SESSION_STORE_TTL_MS || '600000'),
    sessionStoreCleanupIntervalMs: parseInt(process.env.SESSION_STORE_CLEANUP_INTERVAL_MS || '60000'),
    sessionStoreRetryCount: parseInt(process.env.SESSION_STORE_RETRY_COUNT || '3'),
    sessionStoreRetryDelayMs: parseInt(process.env.SESSION_STORE_RETRY_DELAY_MS || '100')
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
    console.warn('Warning: Embedding model ' + config.embeddingModel + ' may not be supported');
  }
}

// Add back the printConfigSummary export
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
  console.log(`  LLM Reranker Base URL: ${config.llmRerankerBaseUrl}`);
  console.log(`  Exclude Patterns: ${config.excludePatterns.join(', ')}`);
  console.log(`  Keyword Search Timeout: ${config.keywordSearchTimeoutMs} ms`);
  console.log(`  Keyword Search Max Chunks: ${config.keywordSearchMaxChunks}`);
  console.log(`  Hybrid Search α: ${config.hybridSearchAlpha}`);
}