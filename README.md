# MCP Codebase Indexing Server

[![npm version](https://img.shields.io/npm/v/mcp-codebase-indexing-server.svg)](https://www.npmjs.com/package/mcp-codebase-indexing-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io/)

A Model Context Protocol (MCP) server that provides intelligent codebase indexing and semantic search capabilities for AI assistants like Cursor. This server uses Voyage AI for embeddings and Qdrant for vector storage to enable powerful semantic code search across your entire codebase.

## 📋 Table of Contents

- [✨ Features](#-features)
- [🏗️ Architecture](#️-architecture)
- [🚀 Quick Start](#-quick-start)
- [🎯 Cursor Integration Guide](#-cursor-integration-guide)
- [⚙️ Customization Guide](#️-customization-guide)
- [📝 Configuration](#-configuration)
- [🛠️ MCP Tools](#️-mcp-tools)
- [🌐 Supported Languages](#-supported-languages)
- [🔧 Troubleshooting](#-troubleshooting)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## ✨ Features

- 🧠 **Intelligent Code Parsing**: Uses tree-sitter to parse code into meaningful chunks (functions, classes, modules, etc.)
- 🔍 **Semantic Search**: Leverages Voyage AI embeddings for semantic code search beyond keyword matching
- 📊 **Vector Storage**: Uses Qdrant for efficient vector storage and lightning-fast similarity search
- 🌐 **Multiple Language Support**: Supports JavaScript, TypeScript, Python, and more
- ⚡ **Incremental Indexing**: Tracks file changes and only re-indexes when necessary
- 🎯 **Flexible Search**: Search by language, chunk type, file path, or semantic similarity
- 🔗 **Context-Aware**: Provides code context and related chunks for better understanding
- 🚀 **MCP Compatible**: Works seamlessly with Cursor and other MCP-compatible AI assistants
- 🛠️ **12 Powerful Tools**: Complete set of indexing and search tools for comprehensive codebase management

## 🏗️ Architecture

```mermaid
graph TB
    subgraph "AI Assistant"
        A[Cursor/Claude]
    end
    
    subgraph "MCP Server"
        B[HTTP Server<br/>Custom SSE + JSON-RPC]
        C[IndexingService]
        D[SearchService]
        E[Code Parser<br/>Tree-sitter]
    end
    
    subgraph "External Services"
        F[Voyage AI<br/>Embeddings]
        G[Qdrant<br/>Vector DB]
    end
    
    A ↔ B
    B → C
    B → D
    C → E
    C → F
    C → G
    D → F
    D → G
    
    style A fill:#e1f5fe
    style B fill:#f3e5f5
    style F fill:#fff3e0
    style G fill:#e8f5e8
```

The server consists of several key components:

1. **Code Parser**: Tree-sitter based parser that extracts semantic chunks from code
2. **Voyage Client**: Handles embedding generation via Voyage AI API
3. **Qdrant Client**: Manages vector storage and similarity search
4. **Indexing Service**: Orchestrates the indexing process
5. **Search Service**: Provides semantic search capabilities
6. **MCP Server**: Exposes tools via the Model Context Protocol

## 📦 Installation

### NPM Package (Recommended)

```bash
# Install globally
npm install -g mcp-codebase-indexing-server

# Or run directly with npx
npx mcp-codebase-indexing-server
```

### Docker

```bash
# Pull and run
docker run -p 3001:3001 ghcr.io/your-org/mcp-codebase-indexing-server:latest
```

### From Source

```bash
git clone <repository-url>
cd mcp-codebase-indexing-server
npm install
npm run build
npm start
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Voyage AI API key ([Get one here](https://www.voyageai.com/))
- Qdrant instance (local or cloud)
- AI assistant that supports MCP (like Cursor)

### 5-Minute Setup

1. **Get your services ready**:
```bash
# Start local Qdrant
docker run -d -p 6333:6333 --name qdrant qdrant/qdrant

# Get Voyage AI API key from https://www.voyageai.com/
```

2. **Deploy the server**:
```bash
git clone <repository-url>
cd mcp-codebase-indexing-server
npm install && npm run build
VOYAGE_API_KEY=your_key_here npm start
```

3. **Connect to Cursor**:
   - Add MCP server in Cursor settings
   - Use server URL: `http://localhost:3001`
   - You should see a green circle with 12 tools available

4. **Test it out**:
   - Index your codebase: "Index the current directory"  
   - Search your code: "Find authentication functions in TypeScript"

## Prerequisites (Detailed)

- Node.js 18+
- Voyage AI API key
- Qdrant instance (local or cloud)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd mcp-codebase-indexing-server
```

2. Install dependencies:
```bash
npm install
```

3. Build the server:
```bash
npm run build
```

## 🎯 Cursor Integration Guide

### Setting Up MCP Server in Cursor

1. **Open Cursor Settings**:
   - Go to Settings → Features → Model Context Protocol

2. **Add MCP Server**:
   ```json
   {
     "name": "codebase-indexing",
     "command": "node",
     "args": ["path/to/your/mcp-codebase-indexing-server/dist/index.js"],
     "env": {
       "VOYAGE_API_KEY": "your_voyage_api_key_here",
       "QDRANT_URL": "http://localhost:6333"
     }
   }
   ```

3. **Verify Connection**:
   - Look for green circle indicator in Cursor
   - Should show "12 tools" when connected
   - If red circle: check logs and troubleshooting section

### Using with Cursor

#### Indexing Your Codebase
```
"Index the current directory for semantic search"
"Index the src/ folder in my project"
"Re-index the modified files in my codebase"
```

#### Searching Your Code
```
"Find authentication functions in TypeScript"
"Search for error handling patterns"
"Look for database query functions"
"Find classes that handle user data"
"Show me similar functions to the one I'm looking at"
```

#### Getting Code Context
```
"Get context around the login function"
"Show me similar code to this authentication logic"
"Find related functions in this file"
```

### Troubleshooting Cursor Connection

| Issue | Solution |
|-------|----------|
| Red circle (0 tools) | Check VOYAGE_API_KEY is set correctly |
| "No server info found" | Restart Cursor completely |
| Connection timeout | Ensure Qdrant is running on correct port |
| Tools not responding | Check server logs for errors |

## ⚙️ Customization Guide

### For Different Project Types

#### Large Enterprise Codebases
```env
# Handle large codebases efficiently
BATCH_SIZE=50
MAX_FILE_SIZE=2097152
CHUNK_SIZE=1500
EXCLUDE_PATTERNS=node_modules,dist,build,.git,coverage,logs
```

#### AI/ML Projects  
```env
# Optimize for Python-heavy codebases
SUPPORTED_EXTENSIONS=.py,.ipynb,.md,.yaml,.yml
EMBEDDING_MODEL=voyage-code-2
CHUNK_SIZE=2000
```

#### Frontend Projects
```env
# Focus on web technologies
SUPPORTED_EXTENSIONS=.js,.jsx,.ts,.tsx,.vue,.svelte,.css,.scss
EXCLUDE_PATTERNS=node_modules,dist,build,.next,coverage
CHUNK_SIZE=800
```

#### Microservices Architecture
```env
# Index multiple service repositories
COLLECTION_NAME=microservices-org
BATCH_SIZE=100
# Consider separate instances per service
```

### Advanced Configuration Options

#### Performance Tuning
```env
# Memory optimization
BATCH_SIZE=25              # Smaller batches for memory-constrained environments
CHUNK_OVERLAP=100          # Reduce overlap to save storage
MAX_FILE_SIZE=1048576      # Limit file size (1MB default)

# Speed optimization  
BATCH_SIZE=200             # Larger batches for faster processing
EMBEDDING_MODEL=voyage-code-2  # Optimized model for code
```

#### Custom File Filtering
```env
# Include only specific file types
SUPPORTED_EXTENSIONS=.py,.js,.ts,.go,.rust

# Exclude testing and generated files
EXCLUDE_PATTERNS=*test*,*spec*,generated,vendor,node_modules

# Include documentation
SUPPORTED_EXTENSIONS=.md,.rst,.txt,.py,.js,.ts
```

#### Multi-Environment Setup
```env
# Development
COLLECTION_NAME=dev-codebase
QDRANT_URL=http://localhost:6333

# Staging  
COLLECTION_NAME=staging-codebase
QDRANT_URL=https://staging-qdrant.company.com

# Production
COLLECTION_NAME=prod-codebase
QDRANT_URL=https://qdrant.company.com
QDRANT_API_KEY=prod_api_key
```

## 📝 Configuration

The server is configured via environment variables:

### Required Environment Variables

- `VOYAGE_API_KEY`: Your Voyage AI API key

### Optional Environment Variables

- `QDRANT_URL`: Qdrant server URL (default: `http://localhost:6333`)
- `QDRANT_API_KEY`: Qdrant API key (if using cloud instance)
- `COLLECTION_NAME`: Name of the Qdrant collection (default: `codebase`)
- `EMBEDDING_MODEL`: Voyage AI model to use (default: `voyage-code-2`)
- `BATCH_SIZE`: Batch size for embedding generation (default: `100`)
- `CHUNK_SIZE`: Maximum chunk size in characters (default: `1000`)
- `CHUNK_OVERLAP`: Overlap between chunks (default: `200`)
- `MAX_FILE_SIZE`: Maximum file size to index in bytes (default: `1048576`)
- `EXCLUDE_PATTERNS`: Comma-separated patterns to exclude (default: see config)
- `SUPPORTED_EXTENSIONS`: Comma-separated file extensions to support (default: see config)

### Example Configuration

Create a `.env` file in the project root:

```env
VOYAGE_API_KEY=your_voyage_api_key_here
QDRANT_URL=http://localhost:6333
COLLECTION_NAME=my_codebase
EMBEDDING_MODEL=voyage-code-2
BATCH_SIZE=50
MAX_FILE_SIZE=2097152
```

## Usage

### Running the Server

```bash
npm start
```

Or in development mode:
```bash
npm run dev
```

### Setting up Qdrant

#### Local Qdrant (Docker)
```bash
docker run -p 6333:6333 qdrant/qdrant
```

#### Qdrant Cloud
Sign up at [Qdrant Cloud](https://cloud.qdrant.io/) and get your API key and URL.

### 🛠️ MCP Tools

The server provides **16 powerful tools** organized by functionality:

<details>
<summary><strong>📁 Indexing Tools (5 tools)</strong></summary>

- **`index_directory`**: Index all files in a directory recursively
- **`index_file`**: Index a single file
- **`reindex_file`**: Re-index a file (force update)
- **`remove_file`**: Remove a file from the index
- **`clear_index`**: Clear the entire search index

</details>

<details>
<summary><strong>🔍 Search Tools (6 tools)</strong></summary>

- **`codebase_search`**: 🌟 **Natural language search** for codebase understanding (e.g., "How is user authentication handled?", "Database connection setup", "Error handling patterns")
- **`search_code`**: Search for code chunks using semantic similarity
- **`search_functions`**: Search for functions by name or description
- **`search_classes`**: Search for classes by name or description
- **`find_similar`**: Find code chunks similar to a given chunk
- **`get_code_context`**: Get code context around a specific chunk

</details>

<details>
<summary><strong>📊 Statistics & Health Tools (5 tools)</strong></summary>

- **`get_indexing_stats`**: Get statistics about the indexed codebase
- **`get_search_stats`**: Get statistics about the search index
- **`get_enhanced_stats`**: Get enhanced statistics including cache and hybrid search metrics
- **`get_health_status`**: Get comprehensive health status of all services
- **`clear_search_cache`**: Clear search cache for fresh results
- **`invalidate_file_cache`**: Invalidate cache for a specific file

</details>

### Example Usage

1. **Index a directory**:
```json
{
  "tool": "index_directory",
  "arguments": {
    "directory_path": "/path/to/your/codebase"
  }
}
```

2. **🌟 Natural language codebase search**:
```json
{
  "tool": "codebase_search",
  "arguments": {
    "query": "How is user authentication handled?",
    "limit": 5,
    "enable_hybrid": true,
    "enable_reranking": true
  }
}
```

3. **Search for authentication functions**:
```json
{
  "tool": "search_functions",
  "arguments": {
    "query": "authentication login user",
    "language": "typescript",
    "limit": 5
  }
}
```

3. **Search for error handling patterns**:
```json
{
  "tool": "search_code",
  "arguments": {
    "query": "error handling exception try catch",
    "chunk_type": "function",
    "threshold": 0.7
  }
}
```

### 🌟 Natural Language Search Examples

The `codebase_search` tool understands natural language queries and provides:
- **Relevant code snippets** with syntax highlighting
- **File paths with line numbers** for direct navigation
- **Similarity scores** as percentages
- **Clickable navigation links** to jump to specific locations

**Example queries that work great:**
- `"How is user authentication handled?"`
- `"Database connection setup"`
- `"Error handling patterns"`
- `"API endpoint definitions"`
- `"Component state management"`
- `"Configuration loading"`
- `"Logging implementation"`

**Sample output format:**
```markdown
# 🔍 Natural Language Codebase Search

**Query:** "How is user authentication handled?"

## 📊 Search Results
- **Found:** 8 relevant code references
- **Search Time:** 45ms
- **Hybrid Search:** ✅ (Dense + Sparse)
- **LLM Re-ranked:** ✅ (Relevance optimized)

## 📝 Code References with Navigation Links

### 1. [📂 src/auth/auth-service.ts:15](file://src/auth/auth-service.ts#L15)
**Lines 15-28** | **function** | **typescript** | **Similarity: 94.2%**

```typescript
async authenticateUser(token: string): Promise<User | null> {
  try {
    const decoded = jwt.verify(token, this.secretKey);
    return await this.userRepository.findById(decoded.userId);
  } catch (error) {
    logger.error('Authentication failed:', error);
    return null;
  }
}
```
```

## 🌐 Supported Languages

| Language | File Extensions | Status |
|----------|----------------|--------|
| **JavaScript** | `.js`, `.jsx` | ✅ Full Support |
| **TypeScript** | `.ts`, `.tsx` | ✅ Full Support |
| **Python** | `.py` | ✅ Full Support |
| **Go** | `.go` | 🔄 Coming Soon |
| **Rust** | `.rs` | 🔄 Coming Soon |
| **Java** | `.java` | 🔄 Coming Soon |

> 💡 **Extensible**: Additional languages can be added by installing the corresponding tree-sitter grammars and updating the configuration.

## API Reference

### Indexing Service

The `IndexingService` class provides:

```typescript
// Initialize the service
await indexingService.initialize();

// Index a directory
const stats = await indexingService.indexDirectory('/path/to/code');

// Index a single file
const chunks = await indexingService.indexFile('/path/to/file.ts');

// Remove a file from index
await indexingService.removeFile('/path/to/file.ts');

// Clear entire index
await indexingService.clearIndex();
```

### Search Service

The `SearchService` class provides:

```typescript
// Initialize the service
await searchService.initialize();

// Basic search
const results = await searchService.search({
  query: 'authentication',
  language: 'typescript',
  limit: 10
});

// Search functions
const functions = await searchService.searchFunctions('login', 'typescript');

// Find similar chunks
const similar = await searchService.findSimilar('chunk_id', 5);

// Get code context
const context = await searchService.getCodeContext('chunk_id', 5);
```

## Performance Considerations

- **Batch Processing**: The server processes files in batches to avoid memory issues
- **Incremental Updates**: Only re-indexes files that have changed
- **Embedding Caching**: Consider caching embeddings to reduce API calls
- **Vector Storage**: Qdrant provides efficient vector storage and retrieval

## 🔧 Troubleshooting

### Common Issues

#### MCP Connection Issues

| Problem | Symptoms | Solution |
|---------|----------|----------|
| **Server won't start** | `Error: EADDRINUSE` | Port 3001 already in use. Change PORT env var or kill existing process |
| **Connection timeout** | Cursor shows "connecting..." forever | Check VOYAGE_API_KEY is valid and Qdrant is running |
| **Red circle in Cursor** | 0 tools shown | Restart Cursor completely, verify server is running |
| **"Not connected" error** | Tools fail with connection error | Server restarted automatically, wait 30 seconds |

#### Service Connection Issues

1. **Connection to Qdrant fails**:
   ```bash
   # Check if Qdrant is running
   curl http://localhost:6333/collections
   
   # Start Qdrant if not running
   docker run -d -p 6333:6333 --name qdrant qdrant/qdrant
   
   # Check firewall settings
   netstat -tulpn | grep 6333
   ```

2. **Voyage AI API errors**:
   ```bash
   # Test API key
   curl -H "Authorization: Bearer YOUR_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"input": ["test"], "model": "voyage-code-2"}' \
        https://api.voyageai.com/v1/embeddings
   
   # Check quota at https://www.voyageai.com/dashboard
   ```

#### Performance Issues

3. **Out of memory during indexing**:
   ```env
   # Reduce memory usage
   BATCH_SIZE=25
   MAX_FILE_SIZE=524288
   CHUNK_SIZE=500
   
   # Exclude large directories
   EXCLUDE_PATTERNS=node_modules,dist,build,.git,logs,coverage,vendor
   ```

4. **Slow indexing performance**:
   ```env
   # Optimize for speed
   BATCH_SIZE=100
   CHUNK_OVERLAP=100
   
   # Use faster embedding model if available
   EMBEDDING_MODEL=voyage-code-2
   ```

#### Code Parsing Issues

5. **Tree-sitter parsing errors**:
   - **Error**: `Language not supported`
     - **Solution**: Add tree-sitter grammar for your language
   - **Error**: `Failed to parse file`
     - **Solution**: Check file encoding (must be UTF-8)
   - **Error**: `File too large`
     - **Solution**: Increase MAX_FILE_SIZE or exclude the file

### Diagnostic Commands

#### Check Server Health
```bash
# Test server is running
curl http://localhost:3001/health

# Test MCP endpoint
curl http://localhost:3001/sse

# Check server logs
npm start 2>&1 | tee server.log
```

#### Check Services
```bash
# Test Qdrant
curl http://localhost:6333/collections

# Test Voyage AI
curl -H "Authorization: Bearer $VOYAGE_API_KEY" \
     https://api.voyageai.com/v1/embeddings \
     -d '{"input":["test"],"model":"voyage-code-2"}'
```

#### Debug Indexing
```bash
# Enable debug mode
DEBUG=1 npm start

# Test specific directory
curl -X POST http://localhost:3001/tools/call \
  -H "Content-Type: application/json" \
  -d '{"tool":"index_directory","arguments":{"directory_path":"./test"}}'
```

### Debug Mode

Enable comprehensive logging:
```bash
# Full debug output
DEBUG=1 npm start

# Service-specific debugging
DEBUG=indexing npm start
DEBUG=search npm start
DEBUG=mcp npm start
```

### Log Analysis

Look for these patterns in logs:

| Log Pattern | Meaning | Action |
|-------------|---------|--------|
| `Error: VOYAGE_API_KEY is required` | Missing API key | Set VOYAGE_API_KEY environment variable |
| `Failed to connect to Qdrant` | Vector DB unavailable | Check Qdrant is running and accessible |
| `Rate limit exceeded` | API quota reached | Wait or upgrade Voyage AI plan |
| `Memory usage warning` | High memory usage | Reduce BATCH_SIZE or exclude more files |
| `Lazy initialization completed` | Services ready | Normal startup, server ready for requests |

### Getting Help

1. **Check server logs** for specific error messages
2. **Test each service individually** using diagnostic commands  
3. **Verify environment variables** are set correctly
4. **Restart services** in order: Qdrant → MCP Server → Cursor
5. **Create minimal reproduction** with a small test directory

If issues persist, create a GitHub issue with:
- Complete error logs
- Environment configuration (without API keys)
- Steps to reproduce
- System information (OS, Node.js version, etc.)

## Development

### Project Structure

```
src/
├── types.ts              # Type definitions
├── index.ts              # Main MCP server
├── clients/
│   ├── voyage-client.ts  # Voyage AI client
│   └── qdrant-client.ts  # Qdrant client
├── parsers/
│   └── code-parser.ts    # Tree-sitter based parser
└── services/
    ├── indexing-service.ts # Indexing orchestration
    └── search-service.ts   # Search functionality
```

### Adding New Languages

1. Install the tree-sitter grammar:
```bash
npm install tree-sitter-rust
```

2. Update the `loadLanguage` function in `code-parser.ts`
3. Add language configuration in `initializeLanguageConfigs`
4. Update the file extension mapping

### Testing

Run tests with:
```bash
npm test
```

### Linting

Check code style with:
```bash
npm run lint
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License

## Acknowledgments

- [Voyage AI](https://www.voyageai.com/) for embedding API
- [Qdrant](https://qdrant.tech/) for vector database
- [Tree-sitter](https://tree-sitter.github.io/) for code parsing
- [Model Context Protocol](https://modelcontextprotocol.io/) for the protocol specification

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone the repository
git clone <repository-url>
cd mcp-codebase-indexing-server

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev

# Run tests
npm test
```

### Adding New Languages

1. Install the tree-sitter grammar:
   ```bash
   npm install tree-sitter-rust
   ```

2. Update the `loadLanguage` function in `src/parsers/code-parser.ts`
3. Add language configuration in `initializeLanguageConfigs`
4. Update the file extension mapping

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Voyage AI](https://www.voyageai.com/) for providing excellent code embeddings
- [Qdrant](https://qdrant.tech/) for the powerful vector database
- [Tree-sitter](https://tree-sitter.github.io/) for robust code parsing
- [Model Context Protocol](https://modelcontextprotocol.io/) for the standardized AI integration protocol

## 📈 Changelog

### v1.0.0 - Production Release
- ✅ Complete MCP protocol implementation with 12 tools
- ✅ Lazy initialization to prevent connection timeouts
- ✅ Custom SSE implementation for Cursor compatibility
- ✅ Support for JavaScript, TypeScript, Python
- ✅ Voyage AI integration for semantic embeddings
- ✅ Qdrant integration for vector storage
- ✅ Incremental indexing with file change tracking
- ✅ Automated Fly.io deployment with GitHub Actions

## 🔗 Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io/) - Official MCP documentation
- [MCP Servers](https://github.com/modelcontextprotocol/servers) - Official MCP server implementations
- [Cursor](https://cursor.sh/) - AI-powered code editor with MCP support 