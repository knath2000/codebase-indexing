#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const axios = require('axios');

const RAILWAY_URL = 'https://codebase-indexing-production.up.railway.app';

// Create proxy MCP server
const server = new Server(
  {
    name: 'codebase-indexing-railway-proxy',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle initialization
server.setRequestHandler('initialize', async (request) => {
  try {
    const response = await axios.post(`${RAILWAY_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: request.params
    });
    console.error('✅ Initialized with Railway server');
    return response.data.result;
  } catch (error) {
    console.error('Error during initialization:', error.message);
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'codebase-indexing-railway-proxy', version: '1.0.0' }
    };
  }
});

// Forward tools/list requests
server.setRequestHandler('tools/list', async () => {
  try {
    console.error('📋 Fetching tools list from Railway...');
    const response = await axios.post(`${RAILWAY_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    });
    console.error(`✅ Retrieved ${response.data.result.tools.length} tools from Railway`);
    return response.data.result;
  } catch (error) {
    console.error('Error fetching tools list:', error.message);
    return { tools: [] };
  }
});

// Forward tools/call requests
server.setRequestHandler('tools/call', async (request) => {
  try {
    console.error(`🔧 Calling tool: ${request.params.name}`);
    const response = await axios.post(`${RAILWAY_URL}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: request.params
    });
    console.error(`✅ Tool ${request.params.name} completed successfully`);
    return response.data.result;
  } catch (error) {
    console.error(`Error calling tool ${request.params.name}:`, error.message);
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
});

// Handle notifications/initialized
server.setNotificationHandler('notifications/initialized', async () => {
  console.error('🎉 MCP client notifications initialized');
});

// Start the proxy server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('🚀 Railway MCP Proxy connected and running...');
    
    // Keep the process alive
    process.on('SIGINT', () => {
      console.error('👋 Railway MCP Proxy shutting down...');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start Railway MCP Proxy:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 