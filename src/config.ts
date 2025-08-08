import { ConfigSchema, Config } from './types.js';
import { loadFeatureFlagsFromEnv } from './config/feature-flags.js'
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const flags = loadFeatureFlagsFromEnv()

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
    llmRerankerTimeoutMs: clampNumber(parseInt(process.env.LLM_RERANKER_TIMEOUT_MS || '25000'), 5000, 120000),
    llmRerankerBaseUrl: normalizeRerankerBaseUrl(
      process.env.LLM_RERANKER_BASE_URL,
      process.env.LLM_RERANKER_PROJECT_ID
    ),
    llmRerankerProjectId: process.env.LLM_RERANKER_PROJECT_ID, // LangDB Project ID
    keywordSearchTimeoutMs: parseInt(process.env.KEYWORD_SEARCH_TIMEOUT_MS || '10000'),
    keywordSearchMaxChunks: parseInt(process.env.KEYWORD_SEARCH_MAX_CHUNKS || '20000'),
    hybridSearchAlpha: clampNumber(parseFloat(process.env.HYBRID_SEARCH_ALPHA || '0.7'), 0, 1),
    enableLLMReranking: flags.enableLLMReranking,
    llmRerankerApiKey: process.env.LLM_RERANKER_API_KEY,
    llmRerankerModel: process.env.LLM_RERANKER_MODEL || 'anthropic/claude-3-haiku-20240307',
    // Expose normalized feature flags on config for easy DI
    flags,
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
  // Cross-field validation for Reranker base URL and project compatibility
  if (config.llmRerankerBaseUrl && config.llmRerankerProjectId) {
    if (config.llmRerankerBaseUrl.includes('/v1/')) {
      throw new Error('llmRerankerBaseUrl must not already include /v1 when llmRerankerProjectId is set');
    }
  }

  if (config.hybridSearchAlpha < 0 || config.hybridSearchAlpha > 1) {
    throw new Error('hybridSearchAlpha must be between 0 and 1');
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
  if ('flags' in config) {
    // @ts-ignore
    console.log(`  Feature Flags: ${JSON.stringify(config.flags)}`)
  }
}

/**
 * Ensure reranker base URL is normalized and consistent with project ID rules.
 * - If both base and projectId are provided, enforce single trailing /v1 and
 *   DO NOT duplicate project id if it is already part of the base url.
 * - If only base is provided, ensure it ends with /v1.
 * - If neither is provided, return undefined.
 */
function normalizeRerankerBaseUrl(base?: string, projId?: string): string | undefined {
  if (!base && !projId) return undefined
  if (!base && projId) throw new Error('LLM_RERANKER_PROJECT_ID provided without LLM_RERANKER_BASE_URL')

  let normalized = (base || '').replace(/\/$/, '') // strip trailing slash

  // If project id is present and not already embedded in base, append it
  if (projId && !normalized.includes(`/${projId}/`)) {
    normalized = `${normalized}/${projId}`
  }

  // Ensure single /v1 suffix
  normalized = normalized.replace(/\/(v1|v1\/)$/, '')
  normalized = `${normalized}/v1`

  return normalized
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(value, min), max)
}