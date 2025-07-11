import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
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
let servicesInitialized = false;

// Store active sessions
const activeSessions = new Map<string, { id: string; startTime: Date; lastHeartbeat: Date }>();

// Initialize MCP server quickly (without heavy network calls)
async function initializeMcpServer() {
  if (mcpServer) return;
  
  const config = loadConfig();
  validateConfig(config);
  
  // Create services but don't initialize them yet
  indexingService = new IndexingService(config);
  searchService = new SearchService(config);
  
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
  
  console.log('MCP server initialized (services will initialize on first use)');
}

// Initialize services lazily (on first tool use)
async function ensureServicesInitialized(): Promise<void> {
  if (servicesInitialized || !indexingService || !searchService) return;
  
  console.log('Initializing services...');
  
  try {
    // Initialize services with network calls
    await indexingService.initialize();
    await searchService.initialize();
    
    servicesInitialized = true;
    console.log('Services initialized successfully');
  } catch (error) {
    console.error('Failed to initialize services:', error);
    throw error;
  }
}

// Expose ensureServicesInitialized globally for tool handlers
(globalThis as any).ensureServicesInitialized = ensureServicesInitialized;

// Send SSE event helper
function sendSSEEvent(res: Response, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Handle GET requests for SSE connection
app.get('/mcp', async (_req: Request, res: Response) => {
  try {
    if (!mcpServer) {
      throw new Error('MCP server not initialized');
    }
    
    // Create new session
    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      startTime: new Date(),
      lastHeartbeat: new Date()
    };
    activeSessions.set(sessionId, session);
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    // Send server info event
    sendSSEEvent(res, 'server_info', {
      name: 'codebase-indexing-server',
      version: '1.0.0',
      capabilities: {
        methods: ['initialize', 'tools/list', 'tools/call'],
        tools: true,
        streaming: true
      },
      status: 'ready',
      protocol_version: '2024-11-05'
    });
    
    // Send session created event
    sendSSEEvent(res, 'session_created', {
      session_id: sessionId
    });
    
    // Send initial heartbeat
    sendSSEEvent(res, 'heartbeat', {
      timestamp: Date.now() / 1000
    });
    
    console.log(`SSE connection established with session: ${sessionId}`);
    
    // Set up heartbeat interval
    const heartbeatInterval = setInterval(() => {
      if (res.destroyed) {
        clearInterval(heartbeatInterval);
        activeSessions.delete(sessionId);
        return;
      }
      
      session.lastHeartbeat = new Date();
      sendSSEEvent(res, 'heartbeat', {
        timestamp: Date.now() / 1000
      });
    }, 30000); // Send heartbeat every 30 seconds
    
    // Handle client disconnect
    res.on('close', () => {
      clearInterval(heartbeatInterval);
      activeSessions.delete(sessionId);
      console.log(`SSE connection closed for session: ${sessionId}`);
    });
    
  } catch (error) {
    console.error('Failed to establish SSE connection:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to establish SSE connection' });
    }
  }
});

// Handle POST requests for JSON-RPC
app.post('/mcp', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!mcpServer) {
      throw new Error('MCP server not initialized');
    }
    
    const { jsonrpc, id, method, params } = req.body;
    
    if (jsonrpc !== '2.0') {
      res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC version'
        }
      });
      return;
    }
    
    console.log(`Received JSON-RPC request: ${method}`);
    
    try {
      let result;
      
      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'codebase-indexing-server',
              version: '1.0.0'
            }
          };
          break;
          
        case 'tools/list':
          // Get tools from MCP server
          const toolsResponse = await mcpServer.request(
            { method: 'tools/list', params: {} },
            ListToolsRequestSchema
          );
          result = toolsResponse;
          break;
          
        case 'tools/call':
          // Ensure services are initialized before tool execution
          await ensureServicesInitialized();
          
          const toolResponse = await mcpServer.request(
            { method: 'tools/call', params },
            CallToolRequestSchema
          );
          result = toolResponse;
          break;
          
        default:
          res.status(400).json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`
            }
          });
          return;
      }
      
      res.json({
        jsonrpc: '2.0',
        id,
        result
      });
      
      return;
      
    } catch (error) {
      console.error(`Error handling ${method}:`, error);
      res.status(500).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : 'Internal error'
        }
      });
    }
    
  } catch (error) {
    console.error('Failed to handle JSON-RPC request:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32000,
        message: 'Internal server error'
      }
    });
    return;
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