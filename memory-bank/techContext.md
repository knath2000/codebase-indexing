# Tech Context: MCP Codebase Indexing Server

## Technology Stack

### Core Runtime
- **Node.js 18+**: JavaScript runtime with ES modules and async/await support
- **TypeScript 5.x**: Type-safe development with strict configuration
- **ES Modules**: Modern module system for better tree-shaking and performance

### Key Dependencies

#### MCP Protocol
- **@modelcontextprotocol/sdk**: Official MCP SDK for server implementation
- **uuid**: Session ID generation for SSE connections

#### Code Analysis
- **tree-sitter**: Universal parser for extracting semantic code structures
- **tree-sitter-javascript**: JavaScript/TypeScript grammar
- **tree-sitter-python**: Python grammar  
- **tree-sitter-web-tree-sitter**: WebAssembly tree-sitter runtime

#### AI & Vector Services
- **Voyage AI API**: Embedding generation service (voyage-code-2 model)
- **Qdrant Client**: Vector database for similarity search
- **HNSW Index**: Hierarchical Navigable Small World for fast vector search

#### HTTP & Communication
- **Express.js**: HTTP server framework
- **Server-Sent Events**: Real-time communication for MCP protocol
- **JSON-RPC 2.0**: Remote procedure call protocol for MCP

### Development Environment

#### Build System
```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch & node --watch dist/index.js",
    "start": "node dist/index.js",
    "test": "jest"
  }
}
```

#### TypeScript Configuration
- **Strict Mode**: Full type checking with null checks
- **ES2022 Target**: Modern JavaScript features
- **Node16 Module Resolution**: Proper ES module handling
- **Source Maps**: Debugging support in production

#### Development Tools
- **Nodemon/Watch**: Auto-restart during development
- **TypeScript Compiler**: Real-time type checking
- **ESLint**: Code quality and consistency
- **Prettier**: Code formatting

## Technical Constraints

### Performance Constraints
- **Memory Usage**: Large codebases can consume significant memory during indexing
- **Embedding API Limits**: Voyage AI rate limits and token constraints
- **Vector Storage**: Qdrant memory requirements scale with corpus size
- **Startup Time**: Lazy initialization required to prevent connection timeouts

### Scalability Constraints
- **Single Instance**: Current architecture doesn't support horizontal scaling
- **File Size Limits**: Maximum file size configurable (default 1MB)
- **Batch Processing**: Embedding generation limited by API batch sizes
- **Concurrent Connections**: Limited by Node.js event loop capacity

### Integration Constraints
- **MCP Protocol**: Must maintain compatibility with official MCP specification
- **Cursor Compatibility**: Custom SSE implementation required for proper connection
- **CORS Requirements**: Cross-origin requests from browser-based clients
- **JSON-RPC Compliance**: Strict adherence to JSON-RPC 2.0 specification

## Configuration Management

### Environment Variables
```bash
# Required
VOYAGE_API_KEY=your_voyage_api_key

# Optional with defaults
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=optional_for_cloud
COLLECTION_NAME=codebase
EMBEDDING_MODEL=voyage-code-2
BATCH_SIZE=100
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
MAX_FILE_SIZE=1048576
PORT=3001
```

### Runtime Configuration
- **Config Loading**: Environment variables with fallback defaults
- **Validation**: Type checking and required variable validation
- **Hot Reload**: Configuration changes require restart
- **Security**: Sensitive values stored in environment, not code

## Deployment Architecture

### Containerization (Docker)
```dockerfile
# Multi-stage build for optimization
FROM node:18-alpine AS builder
# Install dependencies and build
FROM node:18-alpine AS runtime  
# Copy artifacts and run
```

### Fly.io Deployment
- **App Configuration**: fly.toml with service definitions
- **Environment Secrets**: Secure storage for API keys
- **Auto Scaling**: Based on CPU/memory usage
- **Health Checks**: HTTP endpoint monitoring
- **GitHub Integration**: Automatic deployment on main branch push

### CI/CD Pipeline
- **GitHub Actions**: Automated testing and deployment
- **Build Triggers**: Push to main branch
- **Deployment Steps**: Build, test, deploy to Fly.io
- **Rollback**: Manual rollback capability via Fly.io dashboard

## External Service Dependencies

### Voyage AI
- **API Endpoint**: https://api.voyageai.com
- **Model**: voyage-code-2 (specialized for code)
- **Rate Limits**: Per-minute request and token limits
- **Authentication**: API key in Authorization header
- **Retry Strategy**: Exponential backoff for rate limit errors

### Qdrant Vector Database
- **Local Development**: Docker container on port 6333
- **Production**: Qdrant Cloud or self-hosted instance
- **Collection Management**: Automatic collection creation
- **Index Configuration**: HNSW with cosine similarity
- **Backup Strategy**: Regular snapshots for data protection

### Tree-sitter Grammars
- **JavaScript/TypeScript**: Built-in support with comprehensive parsing
- **Python**: Additional grammar for Python code analysis
- **Extensibility**: Additional languages via grammar installation
- **WASM Runtime**: WebAssembly for universal parsing support

## Development Setup

### Prerequisites
```bash
# Node.js 18 or higher
node --version  # v18.0.0+

# Docker for local Qdrant
docker --version

# Git for version control
git --version
```

### Local Development
```bash
# Clone and install
git clone <repository>
cd mcp-codebase-indexing-server
npm install

# Start Qdrant
docker run -p 6333:6333 qdrant/qdrant

# Configure environment
cp config.example.env .env
# Edit .env with your Voyage API key

# Development mode
npm run dev
```

### Testing Strategy
- **Unit Tests**: Jest for individual component testing
- **Integration Tests**: Full MCP protocol testing
- **Manual Testing**: Cursor integration validation
- **Load Testing**: Large codebase indexing performance
- **Error Testing**: Network failure and timeout scenarios

## Security Considerations

### API Key Management
- **Environment Variables**: Never commit API keys to version control
- **Fly.io Secrets**: Secure storage for production keys
- **Key Rotation**: Support for updating API keys without downtime
- **Access Control**: Limit API key permissions to minimum required

### Network Security
- **HTTPS**: TLS encryption for all external API calls
- **CORS**: Proper origin validation for browser clients
- **Input Validation**: Sanitize file paths and user inputs
- **Rate Limiting**: Prevent abuse of indexing endpoints

### Data Privacy & Code Protection

#### **Privacy-First Architecture**
- **Small Code Chunks**: Only 100-1000 character segments sent for embedding
- **Automatic Truncation**: Chunks exceeding 1000 chars are automatically truncated
- **No Full Files**: Complete files never sent to external services
- **Local Processing**: All parsing and chunking happens locally

#### **One-Way Mathematical Representations**
- **Embeddings Only**: Code converted to irreversible mathematical vectors
- **No Code Storage**: Original code never stored in external services
- **Semantic Vectors**: Embeddings capture meaning, not exact text
- **Vector Dimensions**: 1024-dimensional vectors (voyage-code-3 model)

#### **Chunk Size Enforcement**
```typescript
// Privacy-focused chunk size enforcement
const MIN_CHUNK_SIZE = 100;  // Minimum for meaningful context
const MAX_CHUNK_SIZE = 1000; // Maximum for privacy protection

// Automatic truncation with logging
if (chunkContent.length > MAX_CHUNK_SIZE) {
  chunkContent = chunkContent.substring(0, MAX_CHUNK_SIZE);
  console.log(`🔒 Privacy: Truncated chunk to ${MAX_CHUNK_SIZE} chars`);
}
```

#### **Configuration Validation**
- **Range Enforcement**: Chunk size must be 100-1000 characters
- **Privacy Logging**: Validation logs privacy settings on startup
- **Overlap Limits**: Chunk overlap must be less than chunk size
- **File Size Limits**: Maximum 1MB file size for indexing

### Data Privacy
- **Local Processing**: Code never sent to external services beyond embeddings
- **Embedding Only**: Only vector representations stored, not source code
- **Temporary Storage**: Minimal temporary file handling
- **Access Logs**: Limited logging of sensitive information
- **Privacy Validation**: Startup logging confirms privacy settings 