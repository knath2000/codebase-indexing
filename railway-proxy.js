#!/usr/bin/env node

const axios = require('axios');

const RAILWAY_URL = 'https://codebase-indexing-production.up.railway.app';

// Simple stdio-based proxy that forwards JSON-RPC to Railway
process.stdin.setEncoding('utf8');

let buffer = '';

process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  
  // Process complete JSON-RPC messages (one per line)
  const lines = buffer.split('\n');
  buffer = lines.pop() || ''; // Keep incomplete line in buffer
  
  for (const line of lines) {
    if (line.trim()) {
      try {
        const request = JSON.parse(line);
        console.error(`🔄 Forwarding request: ${request.method} (id: ${request.id})`);
        
        // Forward request to Railway
        const response = await axios.post(`${RAILWAY_URL}/mcp`, request, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        });
        
        // Send response back via stdout
        process.stdout.write(JSON.stringify(response.data) + '\n');
        console.error(`✅ Request ${request.method} completed successfully`);
        
      } catch (error) {
        console.error(`❌ Error processing request:`, error.message);
        
        // Send error response
        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: error.message
          }
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    }
  }
});

process.stdin.on('end', () => {
  console.error('👋 Railway MCP Proxy stdin closed');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('👋 Railway MCP Proxy shutting down...');
  process.exit(0);
});

console.error('🚀 Railway MCP Proxy started - forwarding to:', RAILWAY_URL); 