# MCP Codebase Indexing Server

A Model Context Protocol (MCP) server that provides intelligent codebase indexing and semantic search capabilities, similar to the Roo Code VSCode extension. This server uses Voyage AI for embeddings and Qdrant for vector storage to enable powerful semantic code search.

## Features

- **Intelligent Code Parsing**: Uses tree-sitter to parse code into meaningful chunks (functions, classes, modules, etc.)
- **Semantic Search**: Leverages Voyage AI embeddings for semantic code search
- **Vector Storage**: Uses Qdrant for efficient vector storage and retrieval
- **Multiple Language Support**: Supports JavaScript, TypeScript, Python, and more
- **Incremental Indexing**: Tracks file changes and only re-indexes when necessary
- **Flexible Search**: Search by language, chunk type, file path, or similarity
- **Context-Aware**: Provides code context and related chunks

## Architecture

The server consists of several key components:

1. **Code Parser**: Tree-sitter based parser that extracts semantic chunks from code
2. **Voyage Client**: Handles embedding generation via Voyage AI API
3. **Qdrant Client**: Manages vector storage and similarity search
4. **Indexing Service**: Orchestrates the indexing process
5. **Search Service**: Provides semantic search capabilities
6. **MCP Server**: Exposes tools via the Model Context Protocol

## Prerequisites

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

## Configuration

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

### MCP Tools

The server provides the following tools:

#### Indexing Tools

- **`index_directory`**: Index all files in a directory recursively
- **`index_file`**: Index a single file
- **`reindex_file`**: Re-index a file (force update)
- **`remove_file`**: Remove a file from the index
- **`clear_index`**: Clear the entire search index

#### Search Tools

- **`search_code`**: Search for code chunks using semantic similarity
- **`search_functions`**: Search for functions by name or description
- **`search_classes`**: Search for classes by name or description
- **`find_similar`**: Find code chunks similar to a given chunk
- **`get_code_context`**: Get code context around a specific chunk

#### Statistics Tools

- **`get_indexing_stats`**: Get statistics about the indexed codebase
- **`get_search_stats`**: Get statistics about the search index

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

2. **Search for authentication functions**:
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

## Supported Languages

Currently supports:
- JavaScript (.js, .jsx)
- TypeScript (.ts, .tsx)
- Python (.py)

Additional languages can be added by installing the corresponding tree-sitter grammars and updating the configuration.

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

## Troubleshooting

### Common Issues

1. **Connection to Qdrant fails**:
   - Check if Qdrant is running
   - Verify the QDRANT_URL is correct
   - Check firewall settings

2. **Voyage AI API errors**:
   - Verify your API key is correct
   - Check your API quota and limits
   - Ensure you have access to the specified model

3. **Out of memory during indexing**:
   - Reduce batch size
   - Increase the exclude patterns
   - Reduce max file size

4. **Tree-sitter parsing errors**:
   - Check if the language is supported
   - Verify file encoding (should be UTF-8)
   - Some files might be too large or malformed

### Debug Mode

Set `DEBUG=1` to enable verbose logging:
```bash
DEBUG=1 npm start
```

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

## Changelog

### v1.0.0
- Initial release
- Support for JavaScript, TypeScript, Python
- Voyage AI integration
- Qdrant integration
- MCP server implementation
- Semantic search capabilities
- Incremental indexing 