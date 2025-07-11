import { z } from 'zod';

// Configuration schema
export const ConfigSchema = z.object({
  voyageApiKey: z.string(),
  qdrantUrl: z.string().default('http://localhost:6333'),
  qdrantApiKey: z.string().optional(),
  collectionName: z.string().default('codebase'),
  embeddingModel: z.enum(['voyage-code-2', 'voyage-code-3', 'voyage-2', 'voyage-large-2']).default('voyage-code-2'),
  batchSize: z.number().default(100),
  chunkSize: z.number().default(1000),
  chunkOverlap: z.number().default(200),
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
  ])
});

export type Config = z.infer<typeof ConfigSchema>;

// Code chunk types
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
  GENERIC = 'generic'
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
}

// Embedding types
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
  [key: string]: unknown;
}

// Search types
export interface SearchQuery {
  query: string;
  language?: string | undefined;
  filePath?: string | undefined;
  chunkType?: ChunkType | undefined;
  limit?: number | undefined;
  threshold?: number | undefined;
  includeMetadata?: boolean | undefined;
}

export interface SearchResult {
  id: string;
  score: number;
  chunk: CodeChunk;
  snippet: string;
  context?: string | undefined;
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
}

export enum IndexingStatus {
  IDLE = 'idle',
  SCANNING = 'scanning',
  PARSING = 'parsing',
  EMBEDDING = 'embedding',
  STORING = 'storing',
  COMPLETED = 'completed',
  ERROR = 'error'
}

export interface IndexingError {
  filePath: string;
  error: string;
  timestamp: Date;
  severity: 'warning' | 'error' | 'critical';
}

// Parser types
export interface ParsedNode {
  type: string;
  startPosition: Position;
  endPosition: Position;
  text: string;
  children?: ParsedNode[];
  name?: string;
  kind?: string;
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
}

export interface ChunkStrategy {
  nodeType: string;
  chunkType: ChunkType;
  nameExtractor?: (node: ParsedNode) => string;
  includeContext?: boolean;
  minSize?: number;
  maxSize?: number;
}

// Statistics
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
}

// MCP Tool types
export interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
}

// Voyage AI API types
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
} 