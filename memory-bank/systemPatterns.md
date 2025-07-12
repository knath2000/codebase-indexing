# System Patterns: MCP Codebase Indexing Server

## Architecture Overview

### High-Level Architecture
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   AI Assistant  │────│  MCP Server      │────│  Vector DB      │
│    (Cursor)     │    │  HTTP + SSE      │    │   (Qdrant)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                       ┌──────────────────┐
                       │  Embedding API   │
                       │  (Voyage AI)     │
                       └──────────────────┘
```

### Component Architecture
- **HTTP Server**: Handles MCP protocol via SSE and JSON-RPC
- **IndexingService**: Orchestrates code parsing and embedding generation
- **SearchService**: Manages semantic search and similarity queries
- **VoyageClient**: Interfaces with Voyage AI for embeddings
- **QdrantVectorClient**: Manages vector storage and retrieval
- **Code Parser**: Tree-sitter based semantic code analysis

## Key Design Patterns

### 1. Lazy Initialization Pattern
**Problem**: Service constructors were making synchronous network calls causing timeouts
**Solution**: Services created but not initialized until first use
```typescript
async ensureServicesInitialized() {
  if (!this.servicesInitialized) {
    await this.indexingService.initialize();
    await this.searchService.initialize();
    this.servicesInitialized = true;
  }
}
```

### 2. Internal Client-Server Pattern
**Problem**: HTTP handler needs to call MCP tools without external transport
**Solution**: In-memory transport pair with internal MCP Client
```typescript
// Create internal transport pair
const [clientTransport, serverTransport] = createInMemoryTransport();
this.internalClient = new Client(clientTransport, { name: "internal-client" });
await this.server.connect(serverTransport);
```

### 3. Tool Definition Extraction Pattern
**Problem**: Avoid code duplication between HTTP and MCP handlers
**Solution**: Shared tool definitions constant
```typescript
export const TOOL_DEFINITIONS = [
  { name: "index_directory", description: "...", inputSchema: {...} },
  // ... other tools
];
```

### 4. Custom SSE Implementation Pattern
**Problem**: MCP SDK SSE transport incompatible with Cursor expectations
**Solution**: Custom SSE implementation with required events
```typescript
// Send required SSE events for Cursor compatibility
res.write(`data: ${JSON.stringify({ type: 'server_info', info: serverInfo })}\n\n`);
res.write(`data: ${JSON.stringify({ type: 'session_created', sessionId: uuidv4() })}\n\n`);
// Start heartbeat for connection health
```

## Critical Implementation Paths

### 1. MCP Connection Flow
1. **SSE Handshake**: Custom SSE endpoint sends server_info and session_created events
2. **Capability Exchange**: Client requests tools/list via JSON-RPC  
3. **Tool Execution**: Client calls tools/call with lazy service initialization
4. **Error Handling**: Proper JSON-RPC error responses with 204/200 status codes

### 2. Indexing Pipeline
1. **File Discovery**: Recursive directory traversal with pattern exclusion
2. **Code Parsing**: Tree-sitter extracts semantic chunks (functions, classes, etc.)
3. **Embedding Generation**: Voyage AI creates vector embeddings for code chunks
4. **Vector Storage**: Qdrant stores embeddings with metadata for retrieval
5. **Change Tracking**: File modification timestamps for incremental updates

### 3. Search Pipeline  
1. **Query Processing**: User query converted to embedding via Voyage AI
2. **Vector Search**: Qdrant similarity search with configurable threshold
3. **Result Filtering**: Language, chunk type, and file path filters applied
4. **Context Enrichment**: Additional context and related chunks included
5. **Response Formatting**: Structured results with metadata and scoring

## Deployment Architecture

### Fly.io Deployment
- **GitHub Actions CI/CD**: Automatic deployment on push to main
- **Docker Containerization**: Multi-stage build for production optimization
- **Environment Configuration**: Secret management via Fly.io environment variables
- **Health Checks**: HTTP endpoints for monitoring service health

### Service Dependencies
- **Qdrant**: Vector database (local Docker or cloud instance)
- **Voyage AI**: Embedding generation API
- **Tree-sitter**: Code parsing (bundled dependencies)
- **Node.js Runtime**: 18+ with TypeScript compilation

## Error Handling Patterns

### Connection Resilience
- **Timeout Prevention**: Lazy initialization avoids startup timeouts
- **Graceful Degradation**: Services fail gracefully with clear error messages
- **Retry Logic**: Automatic retry for transient network failures
- **Circuit Breaker**: Prevent cascade failures in embedding/vector operations

### MCP Protocol Compliance
- **JSON-RPC Standards**: Proper error codes and message formatting
- **SSE Event Handling**: Custom events for client compatibility
- **Notification Handling**: 204 responses for notifications, 200 for requests
- **CORS Support**: Proper headers for cross-origin requests

## Scalability Considerations

### Performance Optimizations
- **Batch Processing**: Embedding generation in configurable batches
- **Vector Indexing**: Qdrant HNSW index for fast similarity search
- **Memory Management**: Stream processing for large files
- **Caching Strategy**: File modification time caching for incremental updates

### Resource Management
- **File Size Limits**: Configurable maximum file size for indexing
- **Concurrent Processing**: Async/await patterns for I/O operations
- **Memory Footprint**: Efficient chunk processing without loading entire files
- **Connection Pooling**: Reuse HTTP connections for external services 