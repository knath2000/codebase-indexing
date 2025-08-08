import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { loadConfig, validateConfig, printConfigSummary } from './config.js';
import { IndexingService } from './services/indexing-service.js';
import { SearchService } from './services/search-service.js';
import { HealthMonitorService } from './services/health-monitor.js';
import { VoyageClient } from './clients/voyage-client.js';
import { QdrantVectorClient } from './clients/qdrant-client.js';
import { WorkspaceWatcher } from './services/workspace-watcher.js';
import { WorkspaceManager } from './services/workspace-manager.js';
import { setupMcpTools, TOOL_DEFINITIONS } from './index.js';

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION 🚨');
  console.error('An unhandled promise rejection occurred:');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  // Forcing a crash with a clear stack trace in a containerized environment
  // is often better than a silent exit.
  throw reason;
});

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(cors());
app.use(express.json());

// -----------------------------------------------------------------------------
// 1. Helper handler functions so we can reuse logic without relying on _router
// -----------------------------------------------------------------------------

// (A) JSON-RPC handler – shared by POST /mcp and POST /
async function handleJsonRpc(req: Request, res: Response) {
  try {
    if (!mcpClient) {
      // Ensure core server is ready
      await initializeMcpServer();
    }

    const { jsonrpc, id, method, params } = req.body || {};

    if (jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC version'
        }
      });
    }

    let result: any = null;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'codebase-indexing-server', version: '1.0.0' }
        };
        break;
      case 'tools/list':
        result = { tools: TOOL_DEFINITIONS };
        break;
      case 'tools/call': {
        if (!mcpClient) {
          throw new Error('MCP client not initialized');
        }
        // Ensure heavy services are up before executing a tool
        if ('ensureServicesInitialized' in globalThis) {
          await (globalThis as any).ensureServicesInitialized();
        }
        result = await mcpClient.callTool(params);
        break;
      }
      case 'notifications/initialized':
        // No-op acknowledgement
        result = null;
        break;
      default:
        return res.status(400).json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        });
    }

    return res.json({ jsonrpc: '2.0', id, result });
  } catch (error) {
    console.error('Failed to process JSON-RPC request:', error);
    return res.status(500).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'Internal server error'
      }
    });
  }
}

// (B) SSE handler – used by GET / (when Accept: text/event-stream)
function handleSse(_req: Request, res: Response) {
  // Simply redirect the client to the canonical SSE endpoint.
  // Using 307 preserves the HTTP method (GET) and headers.
  res.redirect(307, '/mcp');
}

// -----------------------------------------------------------------------------
// 2. Public HTTP routes
// -----------------------------------------------------------------------------

// Health check endpoint (already defined earlier) – keep as is

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  const wantsSse = (req.headers.accept || '').includes('text/event-stream');
  if (wantsSse) {
    // Route to SSE handler directly
    // @ts-ignore – Express types don’t know this returns Promise<void>
    return handleSse(req, res);
  }
  return res.json({
    message: 'MCP Codebase Indexing Server',
    version: '1.0.0',
    transport: 'HTTP SSE',
    endpoints: { mcp: '/mcp', health: '/health' }
  });
});

// POST / (streamableHttp fallback)
app.post('/', handleJsonRpc);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// POST /mcp (streamableHttp primary endpoint)
app.post('/mcp', handleJsonRpc);

// Global MCP server instance
let mcpServer: Server | null = null;
let mcpClient: Client | null = null;
let indexingService: IndexingService | null = null;
let searchService: SearchService | null = null;
let workspaceWatcher: WorkspaceWatcher | null = null;
let workspaceManager: WorkspaceManager | null = null;
let servicesInitialized = false;
let healthMonitor: HealthMonitorService | null = null;

// Store active sessions with SSE response objects
const activeSessions = new Map<string, { 
  id: string; 
  startTime: Date; 
  lastHeartbeat: Date;
  sseResponse?: Response;
}>();

// Initialize MCP server quickly (without heavy network calls)
async function initializeMcpServer() {
  if (mcpServer && mcpClient) return;

  console.log('diag: 1. Starting initialization');
  const config = loadConfig();
  console.log('diag: 2. Config loaded');
  validateConfig(config);
  console.log('diag: 3. Config validated');

  // Create shared workspace manager
  workspaceManager = new WorkspaceManager();
  console.log('diag: 4. WorkspaceManager created');

  // Create services but don't initialize them yet (with shared workspace manager)
  indexingService = new IndexingService(config, workspaceManager);
  console.log('diag: 5. IndexingService created');
  searchService = new SearchService(config, workspaceManager);
  console.log('diag: 6. SearchService created');
  // Create health monitor (will be started after initialize())
  const voyageClient = new VoyageClient(config.voyageApiKey)
  const qdrantClient = new QdrantVectorClient(
    config.qdrantUrl,
    config.qdrantApiKey,
    config.collectionName,
    voyageClient.getEmbeddingDimension(config.embeddingModel)
  )
  healthMonitor = new HealthMonitorService(config, voyageClient, qdrantClient)

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
  console.log('diag: 7. MCP Server object created');

  // Setup MCP tools (register handlers on the server)
  setupMcpTools(mcpServer, indexingService, searchService, healthMonitor || undefined);
  console.log('diag: 8. MCP tools setup');

  // Wire up an in-memory transport so we can invoke tool handlers locally via a client instance.
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  console.log('diag: 9. In-memory transport created');

  // Connect server side of the transport
  await mcpServer.connect(serverTransport);
  console.log('diag: 10. MCP Server connected to transport');

  // Create an internal client with minimal capabilities (just tools)
  mcpClient = new Client(
    {
      name: 'http-proxy',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  console.log('diag: 11. MCP Client object created');

  await mcpClient.connect(clientTransport);
  console.log('diag: 12. MCP Client connected to transport');

  console.log('MCP server and internal client initialized (in-memory transport)');
}

// Initialize services lazily (on first tool use)
async function ensureServicesInitialized(): Promise<void> {
  if (servicesInitialized || !indexingService || !searchService) return;
  
  console.log('🔧 Initializing services...');
  
  try {
    // Initialize services with network calls
    await indexingService.initialize();
    await searchService.initialize();
    healthMonitor?.start();
    
    // Setup workspace auto-indexing and file watching
    await ensureWorkspaceIndexed();
    setupWorkspaceWatcher();
    
    servicesInitialized = true;
    console.log('✅ Services initialized successfully');
    console.log('🔍 Auto-indexing: Enabled');
    console.log('👁️  File watching: Active');
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    throw error;
  }
}

/**
 * Ensure the current workspace is indexed, automatically indexing if needed
 */
async function ensureWorkspaceIndexed(): Promise<void> {
  if (!indexingService) return;
  
  try {
    console.log('🔍 Checking if workspace is already indexed...');
    const existingChunks = await indexingService.countIndexedChunks();
    const workspaceDir = process.cwd();
    
    if (existingChunks === 0) {
      console.log('📁 No existing index detected – automatically indexing workspace...');
      console.log(`📂 Indexing directory: ${workspaceDir}`);
      
      const startTime = Date.now();
      await indexingService.indexDirectory(workspaceDir);
      const duration = Date.now() - startTime;
      
      const finalCount = await indexingService.countIndexedChunks();
      console.log(`✅ Workspace indexing completed in ${duration}ms`);
      console.log(`📊 Indexed ${finalCount} code chunks`);
    } else {
      console.log(`✅ Found existing index with ${existingChunks} code chunks`);
      console.log('🔄 Workspace is ready - file watcher will handle incremental updates');
    }
  } catch (error) {
    console.error('❌ Error during workspace indexing:', error);
    console.error('⚠️  Server will continue but workspace may not be fully indexed');
    // Don't throw - allow server to start even if auto-indexing fails
  }
}

/**
 * Setup workspace file watcher for real-time updates
 */
function setupWorkspaceWatcher(): void {
  if (!indexingService || workspaceWatcher) return;
  
  try {
    const config = loadConfig();
    const workspaceDir = process.cwd();
    
    workspaceWatcher = new WorkspaceWatcher(
      workspaceDir,
      indexingService,
      config.supportedExtensions,
      config.excludePatterns
    );
    
    console.log('👁️  Starting workspace file watcher for real-time updates...');
    workspaceWatcher.start();
  } catch (error) {
    console.error('❌ Error setting up workspace watcher:', error);
    console.error('⚠️  File watching disabled - manual reindexing will be required');
  }
}

// Expose ensureServicesInitialized globally for tool handlers
(globalThis as any).ensureServicesInitialized = ensureServicesInitialized;



// Handle GET requests for SSE connection (server-to-client messages)
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
      lastHeartbeat: new Date(),
      sseResponse: res
    };
    
    // Set SSE headers with session affinity
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Session-ID': sessionId,  // Help clients identify the session for debugging
      'X-Instance-ID': process.env.FLY_ALLOC_ID || 'local'  // Help identify which instance served this
    });
    
    // Store session BEFORE sending endpoint event to prevent race condition
    activeSessions.set(sessionId, session);
    const instanceId = process.env.FLY_ALLOC_ID || 'local';
    console.log(`🔗 SSE connection established with session: ${sessionId} on instance: ${instanceId}`);
    console.log(`Total active sessions: ${activeSessions.size}`);
    console.log(`Session stored with keys:`, Array.from(activeSessions.keys()));
    
    // Send the endpoint event with the message endpoint URL and session ID
    res.write(`event: endpoint\n`);
    res.write(`data: /message?sessionId=${sessionId}\n\n`);
    console.log(`📡 Sent endpoint event with URL: /message?sessionId=${sessionId}`);
    
    // Keep connection alive with periodic comments (standard SSE keepalive)
    const keepAliveInterval = setInterval(() => {
      if (res.destroyed) {
        clearInterval(keepAliveInterval);
        activeSessions.delete(sessionId);
        return;
      }
      
      session.lastHeartbeat = new Date();
      // Send comment to keep connection alive (standard SSE practice)
      res.write(': keepalive\n\n');
    }, 30000); // Send keepalive every 30 seconds
    
    // Handle client disconnect
    res.on('close', () => {
      clearInterval(keepAliveInterval);
      activeSessions.delete(sessionId);
      console.log(`🔌 SSE connection closed for session: ${sessionId}`);
      console.log(`Remaining active sessions: ${activeSessions.size}`);
    });
    
    res.on('error', (error) => {
      console.error(`💥 SSE connection error for session ${sessionId}:`, error);
      clearInterval(keepAliveInterval);
      activeSessions.delete(sessionId);
      console.log(`Session ${sessionId} cleaned up due to error`);
      console.log(`Remaining active sessions: ${activeSessions.size}`);
    });
    
  } catch (error) {
    console.error('Failed to establish SSE connection:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to establish SSE connection' });
    }
  }
});

// Handle GET requests to /message – support both SSE (Cursor main channel) and simple JSON health checks
app.get('/message', (req: Request, res: Response) => {
  const wantsSse = (req.headers.accept || '').includes('text/event-stream');

  // ---------------------------------------------------------------------------
  //  A. SSE: this is the primary message stream AFTER the initial /mcp redirect
  // ---------------------------------------------------------------------------
  if (wantsSse) {
    // 1. Extract & validate sessionId
    const sessionId = (req.query.sessionId as string) || '';
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing sessionId query param' }));
      return;
    }

    const session = activeSessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown sessionId: ${sessionId}` }));
      return;
    }

    // 2. Promote this Response to the persistent SSE channel for that session
    session.sseResponse = res;

    // 3. Standard SSE headers (mirrors /mcp)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Session-ID': sessionId,
      'X-Instance-ID': process.env.FLY_ALLOC_ID || 'local',
    });

    console.log(`✅ /message SSE connected for session ${sessionId}`);

    // 4. Send the REQUIRED JSON-RPC notification so Cursor knows we are ready
    const initNotification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: null
    };
    // Explicitly use `event: message` which is a common requirement for SSE-based RPC
    res.write('event: message\n');
    res.write(`data: ${JSON.stringify(initNotification)}\n\n`);
    console.log('📨 Sent notifications/initialized JSON-RPC via SSE using event: message');

    // 5. Keep-alive comment ping every 30 s
    const keepAliveInterval = setInterval(() => {
      if (res.destroyed) {
        clearInterval(keepAliveInterval);
        return;
      }
      res.write(': keepalive\n\n');
      session.lastHeartbeat = new Date();
    }, 30000);

    // 6. Cleanup on close / error
    res.on('close', () => {
      clearInterval(keepAliveInterval);
      activeSessions.delete(sessionId);
      console.log(`🔌 /message SSE closed for session ${sessionId}`);
    });

    res.on('error', (err) => {
      clearInterval(keepAliveInterval);
      activeSessions.delete(sessionId);
      console.error(`💥 /message SSE error for session ${sessionId}:`, err);
    });

    return; // Important – do not fall through to JSON handler
  }

  // ---------------------------------------------------------------------------
  //  B. Non-SSE: lightweight health/OK response
  // ---------------------------------------------------------------------------
  res.json({ status: 'ok', endpoint: '/message' });
});

// Handle POST requests for JSON-RPC messages (client-to-server)
app.post('/message', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!mcpServer) {
      throw new Error('MCP server not initialized');
    }
    
    console.log('Received POST request body:', JSON.stringify(req.body, null, 2));
    console.log('Request URL:', req.url);
    console.log('Query params:', req.query);
    
    // Get session ID from query params
    const sessionId = req.query.sessionId as string;
    console.log(`Extracted sessionId: "${sessionId}"`);
    
    if (!sessionId) {
      console.log('❌ Missing sessionId parameter');
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Missing sessionId parameter'
        }
      });
      return;
    }
    
    console.log(`Looking up session: ${sessionId}`);
    console.log(`Available sessions: [${Array.from(activeSessions.keys()).join(', ')}]`);
    console.log(`Total active sessions: ${activeSessions.size}`);
    
    // Find the session
    const session = activeSessions.get(sessionId);
    console.log(`Session lookup result:`, session ? 'FOUND' : 'NOT FOUND');
    
    if (!session) {
      console.log('❌ Session not found in activeSessions map');
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid or expired session'
        }
      });
      return;
    }
    
    if (!session.sseResponse) {
      console.log('❌ Session found but sseResponse is missing');
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid or expired session - no SSE response'
        }
      });
      return;
    }
    
    if (session.sseResponse.destroyed) {
      console.log('❌ Session found but sseResponse is destroyed');
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message: 'Invalid or expired session - SSE response destroyed'
        }
      });
      return;
    }
    
    console.log('✅ Session validation passed');
    console.log('Session details:', {
      id: session.id,
      startTime: session.startTime,
      lastHeartbeat: session.lastHeartbeat,
      hasSSEResponse: !!session.sseResponse,
      sseDestroyed: session.sseResponse?.destroyed
    });
    
    const { jsonrpc, id, method, params } = req.body;
    
    if (jsonrpc !== '2.0') {
      console.error(`Invalid JSON-RPC version: ${jsonrpc}`);
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
    
    console.log(`Processing JSON-RPC request: ${method} (id: ${id})`);
    
    try {
      let result;
      
      switch (method) {
        case 'initialize':
          // Provide server information so that Cursor can mark the MCP server as healthy
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
          // Return the statically defined tools list
          result = { tools: TOOL_DEFINITIONS };
          break;
          
        case 'tools/call':
          console.log('🔧 Processing tools/call request:', JSON.stringify(params, null, 2));
          if (!mcpClient) {
            throw new Error('MCP client not initialized');
          }

          // Ensure services are initialized before tool execution
          await ensureServicesInitialized();
          console.log('✅ Services initialized for tool call');

          // Forward the tool call through the in-memory client to reuse existing handlers
          console.log('📞 Forwarding tool call to mcpClient...');
          const toolResponse = await mcpClient.callTool(params);
          console.log('📨 Received tool response:', JSON.stringify(toolResponse, null, 2));
          result = toolResponse;
          break;

        // Handle notification that does not expect a response
        case 'notifications/initialized':
          // The client may send this as a JSON-RPC notification (no id) _or_ as a
          // regular request (with an id). If it's a pure notification we must
          // NOT return a body (per the JSON-RPC spec). When an id is supplied
          // return a standard success response so the client doesn’t treat the
          // call as an unknown-method error.
          if (id === undefined || id === null) {
            res.status(204).send();
          } else {
            res.json({
              jsonrpc: '2.0',
              id,
              result: null
            });
          }
          return;
          
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
      
      const response = {
        jsonrpc: '2.0',
        id,
        result
      };
      
      console.log(`Sending JSON-RPC response for ${method} (id: ${id}):`, JSON.stringify(response, null, 2));
      
      // Return the response in the HTTP body (Cursor expects this)
      res.status(200).json(response);
      
      return;
      
    } catch (error) {
      console.error(`Error handling ${method} (id: ${id}):`, error);
      const errorResponse = {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : 'Internal error'
        }
      };
      console.log('Sending error response:', JSON.stringify(errorResponse, null, 2));
      
      // Return error in HTTP body
      res.status(500).json(errorResponse);
    }
    
  } catch (error) {
    console.error('Failed to handle JSON-RPC request:', error);
    console.error('Request body was:', JSON.stringify(req.body, null, 2));
    const errorResponse = {
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32000,
        message: 'Internal server error'
      }
    };
    console.log('Sending critical error response:', JSON.stringify(errorResponse, null, 2));
    
    // Try to get session and send via SSE if possible
    const sessionId = req.query.sessionId as string;
    if (sessionId) {
      const session = activeSessions.get(sessionId);
      if (session?.sseResponse && !session.sseResponse.destroyed) {
        session.sseResponse.write(`event: message\n`);
        session.sseResponse.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
      }
    }
    
    res.status(500).send('Critical error processed');
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

    // Add a keepalive log to diagnose premature exit
    setInterval(() => {
      console.log('❤️ Server process is still alive...');
    }, 2000);
    
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