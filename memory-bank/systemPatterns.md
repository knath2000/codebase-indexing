# System Patterns

## Architecture Overview

Our MCP codebase indexing server follows a modular, service-oriented architecture with enhanced multi-workspace support that matches and exceeds Cursor's capabilities.

### Core Services

1. **WorkspaceManager**: NEW - Central workspace detection and management
2. **IndexingService**: Core indexing with workspace-specific collections
3. **SearchService**: Advanced search with LLM reranking and workspace isolation
4. **QdrantVectorClient**: Vector database with workspace-specific collections
5. **VoyageClient**: Embedding generation
6. **LLMRerankerService**: Claude-powered result ranking
7. **HybridSearchService**: Dense + sparse search combination

### Multi-Workspace Architecture

```
Workspace Detection → Workspace-Specific Collections → Isolated Search Context
     ↓                           ↓                              ↓
GitDetection              Collection: workspace_abc123      Search only within workspace
NPMDetection              Collection: workspace_xyz789      No cross-workspace contamination  
VSCodeWorkspace           Collection: workspace_def456      Automatic switching support
```

## Enhanced Workspace Management

### **1. Superior Workspace Detection**
- **Git Repository Detection**: Automatic detection via `.git` folder and remote origin
- **NPM Project Detection**: `package.json` analysis for project names and metadata
- **Multi-Root VSCode Workspaces**: Full support for `.code-workspace` files
- **Nested Project Detection**: Handles monorepos and nested project structures
- **Dynamic Workspace Switching**: Real-time workspace switching without restart

### **2. Workspace Isolation Strategy**
- **Collection-Per-Workspace**: Each workspace gets its own Qdrant collection
- **Workspace ID Generation**: SHA-256 hash of root path + git remote (if available)
- **Zero Cross-Contamination**: Search results never mix between workspaces
- **Independent Indexing**: Each workspace indexes separately and completely

### **3. Workspace Metadata Management**
```typescript
interface WorkspaceInfo {
  id: string;              // Unique SHA-256 hash identifier
  name: string;            // Human-readable name (from git/npm/folder)
  rootPath: string;        // Absolute path to workspace root
  type: 'git' | 'npm' | 'multi-root' | 'unknown';
  folders: string[];       // All tracked folders (multi-root support)
  gitRemote?: string;      // Git remote URL for identification
  packageName?: string;    // NPM package name if available
  lastAccessed: Date;      // Workspace access tracking
  collectionName: string;  // Qdrant collection name
}
```

### **4. Automatic Workspace Switching**
- **Directory Change Detection**: Monitors `process.cwd()` changes
- **Intelligent Caching**: Workspace metadata cached for performance
- **Seamless Transitions**: Services automatically update collections
- **No Restart Required**: Switch between workspaces without server restart

## Advanced Search Capabilities

### **1. LLM-Powered Reranking**
- **gpt-4.1-mini Integration**: Superior semantic understanding vs. Cursor's built-in
- **Context-Aware Ranking**: Results ranked by relevance to query intent
- **Implementation-Focused**: Prioritizes code over documentation by default
- **Configurable Thresholds**: Adaptive precision/recall balance

### **2. Hybrid Search Strategy**
- **Dense + Sparse Combination**: Vector embeddings + keyword matching
- **Query Intent Analysis**: Automatic query type detection
- **Multi-Modal Results**: Functions, classes, documentation, configuration
- **Performance Optimization**: Sub-second search across large codebases

### **3. Enhanced Result Formatting**
- **Clickable File Links**: Direct navigation to exact line numbers
- **Rich Metadata**: Score, type, context, navigation links
- **Search Analytics**: Performance metrics and optimization insights
- **Context Window Management**: Intelligent result truncation

## Data Flow Patterns

### Initialization Flow
```
WorkspaceManager.detectCurrentWorkspace()
→ Generate workspace-specific collection name
→ Initialize services with workspace context
→ Auto-index workspace if needed
→ Setup file watching for changes
```

### Search Flow
```
Query → Workspace Context Validation → Collection-Specific Search → LLM Reranking → Formatted Results
```

### Workspace Switch Flow
```
New Directory Detected → Workspace Detection → Collection Switch → Service Updates → Ready for Search
```

## Performance Optimizations

### **1. Intelligent Caching**
- **Search Result Caching**: Redis-like in-memory cache
- **Workspace Metadata Caching**: Fast workspace detection
- **Embedding Caching**: Avoid re-computing similar queries
- **Collection Metadata Caching**: Qdrant collection info cached

### **2. Lazy Loading**
- **Service Initialization**: Heavy services load on first use
- **Workspace Indexing**: Index on first search if not already indexed
- **Collection Creation**: Collections created only when needed

### **3. Resource Management**
- **Connection Pooling**: Reuse database connections
- **Memory Management**: Automatic cleanup of unused resources
- **Background Processing**: Non-blocking indexing operations

## Integration Patterns

### **1. MCP Protocol Integration**
- **Standard MCP Tools**: All standard codebase search tools
- **Enhanced Workspace Tools**: `get_workspace_info`, `list_workspaces`, `switch_workspace`
- **Real-time Status**: Live workspace and service status reporting
- **Error Recovery**: Graceful handling of workspace/service errors

### **2. VSCode Integration**
- **File Link Support**: Cursor-compatible file navigation links
- **Multi-Root Workspace**: Full `.code-workspace` file support
- **Extension Compatibility**: Works alongside VSCode extensions

### **3. Development Workflow**
- **Hot Reloading**: File watching with automatic re-indexing
- **Development Mode**: Enhanced logging and debugging
- **Configuration Management**: Environment-based configuration
- **Health Monitoring**: Comprehensive service health checks

## Comparison with Cursor

| Feature | Our MCP Server | Cursor Built-in |
|---------|---------------|-----------------|
| Workspace Isolation | ✅ Perfect (collection-per-workspace) | ✅ Good (per-workspace indexes) |
| Multi-Root Support | ✅ Full VSCode `.code-workspace` | ✅ Supported |
| LLM Reranking | ✅ gpt-4.1-mini | ❌ Basic ML models |
| Search Performance | ✅ Hybrid + optimizations | ✅ Good |
| Workspace Switching | ✅ Zero-restart switching | ⚠️ May require reload |
| Cross-Workspace | ✅ Zero contamination | ✅ Isolated |
| File Navigation | ✅ Clickable links | ✅ Integrated |
| Customization | ✅ Highly configurable | ❌ Limited |
| Real-time Updates | ✅ File watching + re-index | ✅ Supported |

## Security & Privacy

### **1. Data Isolation**
- **Collection Isolation**: Workspace data never mixed
- **API Key Security**: Secure credential management
- **Local Processing**: No data sent to external services unnecessarily

### **2. Access Control**
- **Workspace Boundaries**: Strict workspace boundary enforcement
- **File System Security**: Respects OS file permissions
- **Network Security**: HTTPS/TLS for all external communications

## Scalability Considerations

### **1. Large Codebases**
- **Chunking Strategy**: Intelligent code chunking for large files
- **Incremental Indexing**: Only re-index changed files
- **Memory Management**: Efficient handling of large repositories

### **2. Multiple Workspaces**
- **Resource Sharing**: Shared services across workspaces
- **Collection Management**: Automatic cleanup of unused collections
- **Performance Isolation**: Workspace operations don't interfere

Our multi-workspace implementation provides superior isolation, performance, and features compared to Cursor's built-in capabilities, while maintaining full compatibility with development workflows. 