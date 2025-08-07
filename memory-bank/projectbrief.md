# Project Brief: MCP Codebase Indexing Server

## Project Overview
A Model Context Protocol (MCP) server that provides intelligent codebase indexing and semantic search capabilities for AI assistants like Cursor. This server enables AI assistants to understand, search, and navigate codebases using semantic embeddings and vector search.

## Core Requirements

### Primary Objectives
1. **Semantic Code Search**: Enable AI assistants to search codebases using natural language queries
2. **Intelligent Indexing**: Parse and index code into meaningful semantic chunks (functions, classes, modules)
3. **MCP Integration**: Expose functionality through standard MCP protocol for compatibility with AI assistants
4. **Performance**: Provide fast, efficient search with minimal latency
5. **Scalability**: Handle large codebases with incremental indexing

### Functional Requirements
- Parse multiple programming languages (JS, TS, Python, etc.)
- Generate semantic embeddings using Voyage AI
- Store vectors in Qdrant for efficient similarity search
- Provide 12 MCP tools for indexing and search operations
- Support incremental updates and file tracking
- Offer configurable indexing parameters

### Technical Requirements
- Node.js/TypeScript implementation
- Tree-sitter for code parsing
- Voyage AI for embeddings
- Qdrant for vector storage
- HTTP server with SSE and JSON-RPC endpoints
- Deployable on Fly.io with GitHub Actions

## Success Criteria
1. **Functional**: All 12 MCP tools work correctly with Cursor
2. **Performance**: Index large codebases (10K+ files) within reasonable time
3. **Accuracy**: Semantic search returns relevant code chunks with high precision
4. **Reliability**: Stable connection and no timeouts during operation
5. **Usability**: Clear documentation and easy setup process

## Scope
- **In Scope**: Codebase indexing, semantic search, MCP protocol, basic language support
- **Out of Scope**: Code generation, syntax highlighting, IDE features, advanced language analysis

## Key Stakeholders
- **Primary Users**: AI assistants (Cursor) and their users
- **Developers**: Engineers building on top of the MCP server
- **Infrastructure**: Fly.io deployment, GitHub Actions CI/CD 