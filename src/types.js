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
    keywordSearchTimeoutMs: z.number().default(10000),
    keywordSearchMaxChunks: z.number().default(20000),
    searchCacheTTL: z.number().default(300), // 5 minutes
    contextWindowSize: z.number().default(32000), // tokens
    maxContextChunks: z.number().default(20),
    hybridSearchAlpha: z.number().default(0.7), // weight for dense vs sparse
    fileWatchDebounceMs: z.number().default(1000),
    mcpSchemaVersion: z.string().default('2024-11-05')
});
export var ChunkType;
(function (ChunkType) {
    ChunkType["FUNCTION"] = "function";
    ChunkType["CLASS"] = "class";
    ChunkType["MODULE"] = "module";
    ChunkType["INTERFACE"] = "interface";
    ChunkType["TYPE"] = "type";
    ChunkType["VARIABLE"] = "variable";
    ChunkType["IMPORT"] = "import";
    ChunkType["COMMENT"] = "comment";
    ChunkType["GENERIC"] = "generic";
    // New chunk types for better AST coverage
    ChunkType["METHOD"] = "method";
    ChunkType["PROPERTY"] = "property";
    ChunkType["CONSTRUCTOR"] = "constructor";
    ChunkType["ENUM"] = "enum";
    ChunkType["NAMESPACE"] = "namespace";
    ChunkType["DECORATOR"] = "decorator";
    // Markdown-specific chunk types
    ChunkType["SECTION"] = "section";
    ChunkType["CODE_BLOCK"] = "code_block";
    ChunkType["PARAGRAPH"] = "paragraph";
    ChunkType["LIST"] = "list";
    ChunkType["TABLE"] = "table";
    ChunkType["BLOCKQUOTE"] = "blockquote";
})(ChunkType || (ChunkType = {}));
export var IndexingStatus;
(function (IndexingStatus) {
    IndexingStatus["IDLE"] = "idle";
    IndexingStatus["SCANNING"] = "scanning";
    IndexingStatus["PARSING"] = "parsing";
    IndexingStatus["EMBEDDING"] = "embedding";
    IndexingStatus["STORING"] = "storing";
    IndexingStatus["COMPLETED"] = "completed";
    IndexingStatus["ERROR"] = "error";
    // New statuses
    IndexingStatus["WATCHING"] = "watching";
    IndexingStatus["INCREMENTAL_UPDATE"] = "incremental_update";
})(IndexingStatus || (IndexingStatus = {}));
