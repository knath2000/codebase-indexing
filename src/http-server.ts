import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { loadConfig, validateConfig, printConfigSummary } from './config.js';
import { IndexingService } from './services/indexing-service.js';
import { SearchService } from './services/search-service.js';
import { setupMcpTools } from './index.js';

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({ 
    message: 'MCP Codebase Indexing Server',
    version: '1.0.0',
    transport: 'HTTP SSE',
    endpoints: {
      mcp: '/mcp',
      health: '/health'
    }
  });
});

// Global MCP server instance
let mcpServer: Server | null = null;
let indexingService: IndexingService | null = null;
let searchService: SearchService | null = null;

// Initialize MCP server once
async function initializeMcpServer() {
  if (mcpServer) return;
  
  const config = loadConfig();
  validateConfig(config);
  
  indexingService = new IndexingService(config);
  searchService = new SearchService(config);
  
  // Initialize services
  await indexingService.initialize();
  await searchService.initialize();
  
  // Create MCP server
  mcpServer = new Server(
    {
      name: 'codebase-indexing-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Setup MCP tools
  setupMcpTools(mcpServer, indexingService, searchService);
  
  console.log('MCP server initialized');
}

// MCP endpoint - handle both GET (SSE) and POST (JSON-RPC) requests
app.all('/mcp', async (req: Request, res: Response) => {
  try {
    if (!mcpServer) {
      throw new Error('MCP server not initialized');
    }
    
    // Create SSE transport that handles both GET and POST
    const transport = new SSEServerTransport('/mcp', res);
    
    // Connect server to transport
    await mcpServer.connect(transport);
    
    console.log(`MCP client ${req.method} request handled via SSE transport`);
    
  } catch (error) {
    console.error('Failed to handle MCP connection:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to establish MCP connection' });
    }
  }
});

// Start server
async function startServer() {
  try {
    const config = loadConfig();
    validateConfig(config);
    printConfigSummary(config);
    
    // Initialize MCP server at startup
    await initializeMcpServer();
    
    app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 MCP Codebase Indexing Server running on port ${port}`);
      console.log(`📡 MCP endpoint: http://localhost:${port}/mcp`);
      console.log(`💚 Health check: http://localhost:${port}/health`);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Export setupMcpTools for reuse
export { setupMcpTools };

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
} 