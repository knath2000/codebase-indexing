# Use Node.js 20 Slim image for glibc compatibility
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install system dependencies including tree-sitter requirements for Debian
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      git \
 && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install all dependencies for build
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Rebuild tree-sitter language grammars for the current platform
RUN npm rebuild tree-sitter tree-sitter-javascript tree-sitter-python tree-sitter-typescript

# Verify tree-sitter packages are properly installed
RUN node -e "console.log('Testing tree-sitter imports...'); \
  import('tree-sitter-javascript').then(m => console.log('JS:', Object.keys(m))).catch(e => console.error('JS error:', e)); \
  import('tree-sitter-typescript').then(m => console.log('TS:', Object.keys(m))).catch(e => console.error('TS error:', e)); \
  import('tree-sitter-python').then(m => console.log('PY:', Object.keys(m))).catch(e => console.error('PY error:', e));" || true

# Remove dev dependencies to reduce image size, but keep build tools for tree-sitter
RUN npm prune --omit=dev --legacy-peer-deps

# Create non-root user for Debian
RUN groupadd -g 1001 nodejs \
 && useradd -u 1001 -g nodejs -s /usr/sbin/nologin mcp

# Change ownership of the app directory
RUN chown -R mcp:nodejs /app
USER mcp

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (res) => { \
        res.statusCode === 200 ? process.exit(0) : process.exit(1); \
    }).on('error', () => process.exit(1));"

# Start the HTTP server with increased heap size (3GB for 4GB machine)
CMD ["node", "--max-old-space-size=3072", "dist/http-server.js"] 