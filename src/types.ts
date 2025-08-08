import { z } from 'zod';

// Configuration schema
export const ConfigSchema = z.object({
  voyageApiKey: z.string(),
  qdrantUrl: z.string().default('http://localhost:6333'),
  qdrantApiKey: z.string().optional(),
  collectionName: z.string().default('codebase'),
  embeddingModel: z.enum(['voyage-code-3', 'voyage-3.5', 'voyage-3-large', 'voyage-code-2', 'voyage-2', 'voyage-large-2']).default('voyage-code-3'),
  batchSize: z.number().default(100),
  chunkSize: z.number().min(100).max(1000).default(800), // Privacy-enforced: 100-1000 chars
  chunkOverlap: z.number().default(100), // Reduced for privacy
  maxFileSize: z.number().default(1024 * 1024), // 1MB
  excludePatterns: z.array(z.string()).default([
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
    '*.map'
  ]),
  supportedExtensions: z.array(z.string()).default([
    '.ts', '.js', '.tsx', '.jsx',
    '.py', '.java', '.cpp', '.c', '.h',
    '.go', '.rs', '.cs', '.php',
    '.rb', '.swift', '.kt', '.scala',
    '.md', '.txt', '.json', '.yaml', '.yml',
    '.html', '.css', '.scss', '.less'
  ]),
  // New configuration options for Cursor parity
  enableHybridSearch: z.boolean().default(true),
  enableLLMReranking: z.boolean().default(true),
  llmRerankerModel: z.string().default('claude-3-haiku-20240307'),
  llmRerankerApiKey: z.string().optional(),
  llmRerankerTimeoutMs: z.number().default(45000),
  llmRerankerBaseUrl: z.string().optional(),
  llmRerankerProjectId: z.string().optional(), // LangDB Project ID for x-project-id header
  keywordSearchTimeoutMs: z.number().default(10000),
  keywordSearchMaxChunks: z.number().default(20000),
  searchCacheTTL: z.number().default(300), // 5 minutes
  searchCacheMaxSize: z.number().default(500),
  contextWindowSize: z.number().default(32000), // tokens
  maxContextChunks: z.number().default(20),
  hybridSearchAlpha: z.number().default(0.7), // weight for dense vs sparse
  fileWatchDebounceMs: z.number().default(1000),
  mcpSchemaVersion: z.string().default('2024-11-05')
});

export type Config = z.infer<typeof ConfigSchema> & {
  // Optional grouped surfaces for organization (back-compat: we keep flat too)
  flags?: {
    enableLLMReranking: boolean
    enableHybridSparse: boolean
    autoIndexOnConnect: boolean
  }
};

// Code chunk types with enhanced metadata
export interface CodeChunk {
  id: string;
  content: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  chunkType: ChunkType;
  functionName?: string | undefined;
  className?: string | undefined;
  moduleName?: string | undefined;
  metadata: ChunkMetadata;
  // New fields for Cursor parity
  contentHash: string; // for incremental updates
  astNodeType?: string;
  parentChunkId?: string;
  childChunkIds?: string[];
  complexity?: number;
  tokenCount?: number;
}

export enum ChunkType {
  FUNCTION = 'function',
  CLASS = 'class',
  MODULE = 'module',
  INTERFACE = 'interface',
  TYPE = 'type',
  VARIABLE = 'variable',
  IMPORT = 'import',
  COMMENT = 'comment',
  GENERIC = 'generic',
  // New chunk types for better AST coverage
  METHOD = 'method',
  PROPERTY = 'property',
  CONSTRUCTOR = 'constructor',
  ENUM = 'enum',
  NAMESPACE = 'namespace',
  DECORATOR = 'decorator',
  // Markdown-specific chunk types
  SECTION = 'section',
  CODE_BLOCK = 'code_block',
  PARAGRAPH = 'paragraph',
  LIST = 'list',
  TABLE = 'table',
  BLOCKQUOTE = 'blockquote'
}

export interface ChunkMetadata {
  fileSize: number;
  lastModified: number;
  language: string;
  extension: string;
  relativePath: string;
  isTest: boolean;
  complexity?: number;
  dependencies?: string[];
  exports?: string[];
  imports?: string[];
  // New metadata for enhanced search
  isRecentlyModified?: boolean;
  isCurrentlyOpen?: boolean;
  editDistance?: number;
  semanticParent?: string;
}

// Multi-vector embedding types
export interface MultiVectorEmbedding {
  id: string;
  denseVector: number[];
  sparseVector?: SparseVector;
  payload: EmbeddingPayload;
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface EmbeddingVector {
  id: string;
  vector: number[];
  payload: EmbeddingPayload;
}

export interface EmbeddingPayload {
  content: string;
  filePath: string;
  language: string;
  chunkType: ChunkType;
  startLine: number;
  endLine: number;
  functionName?: string | undefined;
  className?: string | undefined;
  moduleName?: string | undefined;
  metadata: ChunkMetadata;
  // New payload fields
  contentHash: string;
  tokenCount: number;
  astNodeType?: string;
  parentChunkId?: string;
  childChunkIds?: string[];
  complexity?: number;
  fileKind: 'code' | 'docs'; // Distinguishes implementation code from documentation
  [key: string]: unknown;
}

// Enhanced search types
export interface SearchQuery {
  query: string;
  language?: string;
  chunkType?: ChunkType;
  filePath?: string;
  limit?: number;
  threshold?: number; // Minimum similarity threshold (default 0.25)
  enableHybrid?: boolean;
  enableReranking?: boolean;
  llmRerankerTimeoutMs?: number;
  /** Maximum number of results to keep per file type (function/class/etc.). */
  maxFilesPerType?: number;
  /** Boost functions when true (overrides automatic heuristics). */
  preferFunctions?: boolean;
  /** Boost classes when true (overrides automatic heuristics). */
  preferClasses?: boolean;
  /** Prefer implementation code over documentation (default true). */
  preferImplementation?: boolean;
}

// Cursor-style code reference format
export interface CodeReference {
  type: 'code_reference';
  path: string;
  lines: [number, number]; // [startLine, endLine]
  snippet: string;
  score?: number;
  chunkType?: ChunkType;
  language?: string;
  metadata?: {
    functionName?: string;
    className?: string;
    complexity?: number;
    isTest?: boolean;
  };
}

export interface SearchResult {
  id: string;
  score: number;
  chunk: CodeChunk;
  snippet: string;
  context?: string | undefined;
  // New fields for enhanced results
  rerankedScore?: number;
  hybridScore?: {
    dense: number;
    sparse?: number;
    combined: number;
  };
  codeReference?: CodeReference;
}

// Hybrid search result types
export interface HybridSearchResult {
  denseResults: SearchResult[];
  sparseResults?: SearchResult[];
  combinedResults: SearchResult[];
  alpha: number; // blending weight used
}

// LLM re-ranking types
export interface LLMRerankerRequest {
  query: string;
  candidates: SearchResult[];
  maxResults: number;
}

export interface LLMRerankerResponse {
  rerankedResults: SearchResult[];
  reasoning?: string;
  confidence?: number;
}

// Indexing types
export interface IndexingProgress {
  totalFiles: number;
  processedFiles: number;
  totalChunks: number;
  processedChunks: number;
  currentFile: string;
  status: IndexingStatus;
  startTime: Date;
  estimatedTimeRemaining?: number;
  errors: IndexingError[];
  // New progress tracking
  incrementalUpdates: number;
  skippedFiles: number;
  cacheHits: number;
}

export enum IndexingStatus {
  IDLE = 'idle',
  SCANNING = 'scanning',
  PARSING = 'parsing',
  EMBEDDING = 'embedding',
  STORING = 'storing',
  COMPLETED = 'completed',
  ERROR = 'error',
  // New statuses
  WATCHING = 'watching',
  INCREMENTAL_UPDATE = 'incremental_update'
}

export interface IndexingError {
  filePath: string;
  error: string;
  timestamp: Date;
  severity: 'warning' | 'error' | 'critical';
}

// Enhanced parser types
export interface ParsedNode {
  type: string;
  startPosition: Position;
  endPosition: Position;
  text: string;
  children?: ParsedNode[];
  name?: string;
  kind?: string;
  // New AST node properties
  nodeId?: string;
  parentId?: string;
  depth: number;
  isExported?: boolean;
  isAsync?: boolean;
  visibility?: 'public' | 'private' | 'protected';
}

export interface Position {
  row: number;
  column: number;
}

// Language support
export interface LanguageConfig {
  name: string;
  extensions: string[];
  grammar: string;
  chunkStrategies: ChunkStrategy[];
  keywords: string[];
  commentPatterns: string[];
  // Enhanced language configuration
  astNodeMappings: Record<string, ChunkType>;
  contextualChunking: boolean;
  supportsSparseSearch: boolean;
}

export interface ChunkStrategy {
  nodeType: string;
  chunkType: ChunkType;
  nameExtractor?: (node: ParsedNode) => string;
  includeContext?: boolean;
  minSize?: number;
  maxSize?: number;
  // New strategy options
  preserveHierarchy?: boolean;
  includeSignature?: boolean;
  includeDocstring?: boolean;
  priority?: number;
}

// Enhanced statistics
export interface IndexStats {
  totalFiles: number;
  totalChunks: number;
  totalSize: number;
  languageDistribution: Record<string, number>;
  chunkTypeDistribution: Partial<Record<ChunkType, number>>;
  lastIndexed: Date;
  indexingDuration: number;
  averageChunkSize: number;
  largestFile: string;
  errors: number;
  warnings: number;
  // New statistics
  incrementalUpdates: number;
  cacheHitRate: number;
  averageComplexity: number;
  tokensIndexed: number;
  memoryUsage: number;
  searchQueriesServed: number;
  averageSearchLatency: number;
}

// Search statistics
export interface SearchStats {
  totalQueries: number;
  averageLatency: number;
  cacheHitRate: number;
  hybridSearchUsage: number;
  llmRerankerUsage: number;
  topLanguages: Record<string, number>;
  topChunkTypes: Record<string, number>;
  errorRate: number;
  lastQuery: Date;
  totalChunks: number; // Add this line
  embeddingModel: string;
  embeddingDimension: number;
  collectionStatus: string;
  searchCacheSize: number;
  searchCacheMemory: number;
  rerankerCacheSize: number;
  rerankerCacheMemory: number;
  llmRerankerAverageLatency: number;
  llmRerankerErrorRate: number;
  qdrantClientLatency: number;
}

// Health check types
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  services: {
    qdrant: ServiceHealth;
    voyage: ServiceHealth;
    llmReranker?: ServiceHealth;
    fileWatcher: ServiceHealth;
  };
  metrics: {
    uptime: number;
    memoryUsage: number;
    cpuUsage?: number;
    diskUsage?: number;
  };
  version: string;
  mcpSchemaVersion: string;
}

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'disabled'; // Add 'disabled'
  latency?: number;
  errorRate?: number;
  lastCheck: Date;
  message?: string;
}

// Cache types
export interface SearchCache {
  query: string;
  queryHash: string;
  results: SearchResult[];
  timestamp: Date;
  ttl: number;
  metadata: {
    language?: string;
    chunkType?: ChunkType;
    filePath?: string;
  };
}

// File watching types
export interface FileChangeEvent {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;
  timestamp: Date;
  size?: number;
  hash?: string;
}

export interface FileWatchBatch {
  events: FileChangeEvent[];
  batchId: string;
  timestamp: Date;
  processed: boolean;
}

// MCP Tool types
export interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface VoyageEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

export interface VoyageEmbeddingRequest {
  input: string | string[];
  model: string;
  input_type?: 'query' | 'document';
  truncation?: boolean;
  output_dimension?: number;  // Support for custom embedding dimensions
} 

// Context management types
export interface ContextWindow {
  maxTokens: number;
  usedTokens: number;
  chunks: CodeReference[];
  truncated: boolean;
  summary?: string;
}

export interface TokenBudget {
  total: number;
  reserved: number; // for system prompts, etc.
  available: number;
  used: number;
} 