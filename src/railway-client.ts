#!/usr/bin/env node

import axios from 'axios';

const RAILWAY_URL = 'https://codebase-indexing-production.up.railway.app';

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: any;
  error?: any;
}

class RailwayMcpClient {
  private async forwardRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      const response = await axios.post(`${RAILWAY_URL}/mcp`, request, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      return response.data;
    } catch (error: any) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: error.message || 'Connection failed'
        }
      };
    }
  }

  async start() {
    // Set up stdin/stdout communication for MCP
    process.stdin.setEncoding('utf8');
    
    let buffer = '';
    
    process.stdin.on('data', async (chunk: string) => {
      buffer += chunk;
      
      // Process complete JSON-RPC messages (one per line)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const request: JsonRpcRequest = JSON.parse(line);
            const response = await this.forwardRequest(request);
            process.stdout.write(JSON.stringify(response) + '\n');
          } catch (error) {
            const errorResponse: JsonRpcResponse = {
              jsonrpc: '2.0',
              id: 0,
              error: {
                code: -32700,
                message: 'Parse error'
              }
            };
            process.stdout.write(JSON.stringify(errorResponse) + '\n');
          }
        }
      }
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });

    // Handle process termination
    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
  }
}

// Start the client
const client = new RailwayMcpClient();
client.start().catch(console.error); 