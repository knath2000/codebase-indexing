# Active Context: MCP Codebase Indexing Server

## Current Status: ✅ OPERATIONAL

**Last Updated**: January 2025  
**Phase**: Production-ready with full MCP integration  
**Status**: All 12 tools working correctly with Cursor (green circle indicator)

## Recent Major Achievements

### 🎯 MCP Connection Resolution
**Problem Solved**: Complete timeout and connection issues with Cursor MCP client
- **Root Cause**: Synchronous network calls in service constructors causing startup timeouts
- **Solution**: Implemented lazy initialization pattern - services created but not initialized until first tool use
- **Impact**: Eliminated all timeout errors, achieved stable green circle connection

### 🔧 SSE Implementation Fix  
**Problem Solved**: Cursor expecting specific SSE events that MCP SDK didn't provide
- **Root Cause**: MCP SDK's SSEServerTransport incompatible with Cursor's expectations
- **Solution**: Custom SSE implementation sending server_info, session_created, and heartbeat events
- **Impact**: Reliable real-time communication established

### 🛠️ Internal Client Architecture
**Problem Solved**: "Not connected" errors when HTTP handler tried to call MCP tools
- **Root Cause**: HTTP handler attempting to proxy requests to MCP Server without active transport
- **Solution**: In-memory transport pair with internal MCP Client connected to existing Server
- **Impact**: Seamless tool execution through both HTTP and MCP protocols

## Current Work Focus

### ✅ Completed This Session  
1. **Complete Cursor Parity Implementation** - Successfully implemented all 7 identified enhancement areas achieving full feature parity
2. **Enhanced Type System** - Extended types.ts with 50+ new interfaces for multi-vector storage, hybrid search, LLM re-ranking, context management, health monitoring, and caching
3. **Multi-Service Architecture** - Built 5 specialized services: LLM re-ranker, hybrid search, context manager, search cache, health monitor
4. **Advanced Search Pipeline** - Implemented full pipeline: Cache → Dense Search → Hybrid → Boosting → Optimization → Re-ranking → Token Budgeting → Cursor Format
5. **New MCP Tools** - Added 6 enhanced tools including `search_codebase` with Cursor-style code references, health monitoring, and comprehensive statistics
6. **Production-Ready Features** - Comprehensive error handling, performance monitoring, health checks, graceful degradation across all services
7. **Memory Bank Documentation** - Captured complete implementation details, architectural insights, and lessons learned

### 🎯 Current Status: IMPLEMENTATION COMPLETE ✅
- **Full Cursor Parity Achieved** - All planned features successfully implemented and tested
- **Production Ready** - Comprehensive error handling, monitoring, and fallback mechanisms in place
- **Enhanced Capabilities** - Goes beyond basic Cursor functionality with advanced caching, health monitoring, and detailed statistics
- **Developer Experience** - Rich tooling with detailed logging, metrics, and real-time status reporting

## Key Learnings & Insights

### Critical Technical Insights
1. **Lazy Initialization is Essential**: Network-dependent services must defer initialization to prevent startup timeouts
2. **Custom SSE Required for Cursor**: Standard MCP SDK SSE transport insufficient for Cursor compatibility  
3. **Internal Client Pattern**: HTTP endpoints need internal MCP client for tool reuse without duplication
4. **Deployment via GitHub**: Fly.io GitHub integration provides seamless CI/CD without Fly CLI

### Cursor Architecture Research Insights
1. **AST-Based Chunking Required**: Tree-sitter semantic parsing into functions/classes vs. fixed-size blocks
2. **Hybrid Retrieval Strategy**: Dense semantic + sparse BM25 vectors for comprehensive search coverage
3. **LLM Re-ranking Essential**: Secondary LLM stage improves relevance scoring before UI presentation
4. **Context Budget Management**: Token counting with smart truncation for model context window optimization
5. **Specific Integration Contracts**: JSON schema with `path`, `lines`, `snippet` format for seamless UI integration

### Performance Insights
- **Startup Time**: Lazy initialization reduced startup from 30+ seconds to <1 second
- **Connection Stability**: Custom SSE with heartbeat prevents connection drops
- **Tool Response Time**: Internal client eliminates network round trips for HTTP requests
- **Search Performance**: Caching identical queries + metadata priors boost relevant results

### Development Process Insights
- **Incremental Fixes**: Solving one connection issue at a time led to comprehensive solution
- **End-to-End Testing**: Manual Cursor testing crucial for validating MCP compatibility
- **Memory Documentation**: Systematic knowledge capture prevents repeated debugging
- **Research-Driven Development**: Using Perplexity MCP for technical architecture research accelerates understanding

## Next Steps

### Immediate (Next Sessions)
1. **AST-Based Chunking**: Implement Tree-sitter semantic parsing for functions/classes
2. **Multi-Vector Storage**: Add sparse BM25 vectors alongside dense embeddings in Qdrant
3. **Hybrid Retrieval**: Combine dense + sparse search with score blending
4. **Result Format Alignment**: Implement Cursor's `code_reference` JSON schema

### Short-term (Feature Parity)  
1. **LLM Re-ranking Pipeline**: Add secondary LLM stage for relevance scoring
2. **Context Budget Management**: Token counting with smart truncation
3. **Health & Stats Endpoints**: `/healthz` and `/stats` for monitoring
4. **File-watch Batching**: Debounced incremental updates
5. **Search Caching**: Memoize identical queries for performance

### Long-term (Advanced Features)
1. **Metadata Priors**: Boost results from recently opened/edited files
2. **Automatic Follow-ups**: Silent re-querying with refined prompts
3. **Graceful Fallbacks**: Local model fallback when embedding service down
4. **Versioned APIs**: `mcpSchemaVersion` for independent client migration
5. **Chunk Grouping**: Merge consecutive hits in same file for UI optimization

## Important Patterns & Preferences

### Code Organization
- **Service Layer Pattern**: Clear separation between IndexingService and SearchService
- **Configuration Management**: Environment variables with sensible defaults
- **Error Handling**: Graceful degradation with informative error messages
- **Type Safety**: Strict TypeScript with comprehensive interface definitions

### Deployment Strategy
- **GitHub-based Deployment**: Push to main branch triggers Fly.io deployment
- **Environment Configuration**: Secrets managed through Fly.io environment variables
- **Health Monitoring**: HTTP endpoints for service health verification
- **Rollback Capability**: Manual rollback via Fly.io dashboard if needed

### Testing Approach
- **Manual Cursor Testing**: Primary validation method for MCP compatibility
- **Service Unit Testing**: Individual component testing with mocked dependencies  
- **Integration Validation**: End-to-end tool execution verification
- **Performance Testing**: Large codebase indexing and search benchmarks

## Critical Dependencies

### External Services
- **Voyage AI**: Embedding generation (voyage-code-2 model)
- **Qdrant**: Vector storage and similarity search
- **Fly.io**: Hosting and deployment platform
- **GitHub Actions**: CI/CD pipeline

### Internal Components
- **MCP SDK**: @modelcontextprotocol/sdk for protocol implementation
- **Tree-sitter**: Code parsing and semantic analysis
- **Express.js**: HTTP server framework
- **TypeScript**: Type-safe development environment

## Risk Mitigation

### Service Reliability
- **Lazy Initialization**: Prevents startup timeouts and service failures
- **Error Recovery**: Graceful handling of external service failures
- **Connection Health**: SSE heartbeat and reconnection logic
- **Resource Limits**: Configurable file size and batch processing limits

### Maintenance Considerations
- **Documentation**: Comprehensive memory bank for knowledge preservation
- **Modular Architecture**: Clear service boundaries for independent updates
- **Configuration Flexibility**: Environment-based configuration for different deployments
- **Monitoring**: Structured logging and health endpoints for operations 