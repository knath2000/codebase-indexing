import Parser from 'tree-sitter';
import { readFileSync } from 'fs';
import { extname } from 'path';
import { createHash } from 'crypto';
import { 
  CodeChunk, 
  ChunkType, 
  ChunkMetadata, 
  ParsedNode, 
  LanguageConfig, 
  ChunkStrategy 
} from '../types.js';

// Dynamic imports for tree-sitter language grammars with error handling
const loadLanguage = async (language: string): Promise<any> => {
  try {
    switch (language) {
      case 'javascript': {
        const jsModule = await import('tree-sitter-javascript');
        console.log(`JavaScript module loaded:`, { 
          hasDefault: !!jsModule.default, 
          keys: Object.keys(jsModule),
          defaultType: typeof jsModule.default 
        });
        
        // Try different export patterns
        let grammar = jsModule.default;
        if (!grammar && typeof jsModule === 'function') {
          grammar = jsModule;
        }
        if (!grammar && (jsModule as any).javascript) {
          grammar = (jsModule as any).javascript;
        }
        
        if (!grammar) {
          throw new Error('JavaScript grammar not found in module');
        }
        return grammar;
      }
      case 'typescript': {
        const tsModule = await import('tree-sitter-typescript');
        console.log(`TypeScript module loaded:`, { 
          hasTypescript: !!tsModule.typescript, 
          hasTsx: !!tsModule.tsx,
          keys: Object.keys(tsModule),
          typescriptType: typeof tsModule.typescript,
          defaultType: typeof tsModule.default,
          defaultKeys: tsModule.default ? Object.keys(tsModule.default) : []
        });
        
        // Try different export patterns
        let grammar = tsModule.typescript;
        if (!grammar && tsModule.default) {
          // The default export contains both typescript and tsx grammars
          grammar = tsModule.default.typescript;
        }
        
        if (!grammar) {
          throw new Error(`TypeScript grammar not found in module. Available: ${Object.keys(tsModule)}, Default: ${tsModule.default ? Object.keys(tsModule.default) : 'none'}`);
        }
        return grammar;
      }
      case 'tsx': {
        const tsxModule = await import('tree-sitter-typescript');
        console.log(`TSX module loaded:`, { 
          hasTypescript: !!tsxModule.typescript, 
          hasTsx: !!tsxModule.tsx,
          keys: Object.keys(tsxModule),
          tsxType: typeof tsxModule.tsx,
          defaultType: typeof tsxModule.default,
          defaultKeys: tsxModule.default ? Object.keys(tsxModule.default) : []
        });
        
        // Try different export patterns
        let grammar = tsxModule.tsx;
        if (!grammar && tsxModule.default) {
          // The default export contains both typescript and tsx grammars
          grammar = tsxModule.default.tsx;
        }
        
        if (!grammar) {
          throw new Error(`TSX grammar not found in module. Available: ${Object.keys(tsxModule)}, Default: ${tsxModule.default ? Object.keys(tsxModule.default) : 'none'}`);
        }
        return grammar;
      }
      case 'python': {
        const pyModule = await import('tree-sitter-python');
        console.log(`Python module loaded:`, { 
          hasDefault: !!pyModule.default, 
          keys: Object.keys(pyModule),
          defaultType: typeof pyModule.default 
        });
        
        // Try different export patterns
        let grammar = pyModule.default;
        if (!grammar && typeof pyModule === 'function') {
          grammar = pyModule;
        }
        if (!grammar && (pyModule as any).python) {
          grammar = (pyModule as any).python;
        }
        
        if (!grammar) {
          throw new Error('Python grammar not found in module');
        }
        return grammar;
      }
      case 'markdown': {
        const mdModule = await import('tree-sitter-markdown');
        console.log(`Markdown module loaded:`, { 
          hasDefault: !!mdModule.default, 
          keys: Object.keys(mdModule),
          defaultType: typeof mdModule.default 
        });
        
        // Try different export patterns for markdown
        let grammar = mdModule.default;
        if (!grammar && typeof mdModule === 'function') {
          grammar = mdModule;
        }
        if (!grammar && (mdModule as any).markdown) {
          grammar = (mdModule as any).markdown;
        }
        
        if (!grammar) {
          throw new Error('Markdown grammar not found in module');
        }
        return grammar;
      }
      default:
        throw new Error(`Language parser not available for: ${language}`);
    }
  } catch (error) {
    console.warn(`Failed to load Tree-sitter language grammar for ${language}:`, error);
    throw error;
  }
};

export class CodeParser {
  private parser: Parser;
  private languageConfigs: Map<string, LanguageConfig>;

  constructor() {
    this.parser = new Parser();
    this.languageConfigs = new Map();
    this.initializeLanguageConfigs();
  }

  /**
   * Parse a file and extract code chunks
   */
  async parseFile(filePath: string): Promise<CodeChunk[]> {
    const content = readFileSync(filePath, 'utf-8');
    const language = this.getLanguageFromFile(filePath);
    console.log(`[DEBUG] Parsing file: ${filePath} (language: ${language})`);
    
    if (!language) {
      const genericChunks = this.parseGenericFile(filePath, content);
      console.log(`[DEBUG] [${filePath}] No language detected. Generic chunk count: ${genericChunks.length}`);
      return genericChunks;
    }

    try {
      const grammar = await loadLanguage(language);
      if (!grammar) {
        throw new Error(`Grammar is null or undefined for language: ${language}`);
      }
      this.parser.setLanguage(grammar);
      
      const tree = this.parser.parse(content);
      const chunks = this.extractChunks(tree.rootNode, content, filePath, language);
      console.log(`[DEBUG] [${filePath}] Chunks extracted with language parser: ${chunks.length}`);
      if (chunks.length === 0) {
        // Fallback: generic chunking to ensure every file is represented
        const genericChunks = this.parseGenericContent(content, filePath);
        console.log(`[DEBUG] [${filePath}] Fallback to generic chunking. Generic chunk count: ${genericChunks.length}`);
        chunks.push(...genericChunks);
      }
      return chunks;
    } catch (error) {
      console.warn(`[DEBUG] [${filePath}] Failed to parse with ${language} parser, falling back to generic:`, error);
      const genericChunks = this.parseGenericFile(filePath, content);
      console.log(`[DEBUG] [${filePath}] Exception fallback. Generic chunk count: ${genericChunks.length}`);
      return genericChunks;
    }
  }

  /**
   * Parse content directly without file I/O
   */
  async parseContent(content: string, filePath: string, language?: string): Promise<CodeChunk[]> {
    const detectedLanguage = language || this.getLanguageFromFile(filePath);
    
    if (!detectedLanguage) {
      return this.parseGenericContent(content, filePath);
    }

    try {
      const grammar = await loadLanguage(detectedLanguage);
      this.parser.setLanguage(grammar);
      
      const tree = this.parser.parse(content);
      const chunks = this.extractChunks(tree.rootNode, content, filePath, detectedLanguage);
      
      if (chunks.length === 0) {
        // Fallback: generic chunking to ensure every file is represented
        const genericChunks = this.parseGenericContent(content, filePath);
        chunks.push(...genericChunks);
      }
      
      return chunks;
    } catch (error) {
      console.warn(`Failed to parse content with ${detectedLanguage} parser, falling back to generic:`, error);
      return this.parseGenericContent(content, filePath);
    }
  }

  /**
   * Extract code chunks from a tree-sitter node
   */
  private extractChunks(node: Parser.SyntaxNode, content: string, filePath: string, language: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const config = this.languageConfigs.get(language);
    
    if (!config) {
      return this.parseGenericContent(content, filePath);
    }

    const lines = content.split('\n');
    this.traverseNode(node, content, filePath, language, config, chunks, lines);
    
    // Include any deferred sub-chunks generated for large nodes
    if ((this as any)._deferredChunks && (this as any)._deferredChunks.length > 0) {
      chunks.push(...(this as any)._deferredChunks);
      delete (this as any)._deferredChunks;
    }

    return chunks;
  }

  /**
   * Recursively traverse tree-sitter nodes
   */
  private traverseNode(
    node: Parser.SyntaxNode,
    content: string,
    filePath: string,
    language: string,
    config: LanguageConfig,
    chunks: CodeChunk[],
    lines: string[]
  ): void {
    // Check if this node matches any chunk strategies
    for (const strategy of config.chunkStrategies) {
      if (node.type === strategy.nodeType) {
        const chunk = this.createChunkFromNode(node, content, filePath, language, strategy, lines);
        if (chunk) {
          chunks.push(chunk);
        }
      }
    }

    // Recursively process children
    for (const child of node.children) {
      this.traverseNode(child, content, filePath, language, config, chunks, lines);
    }
  }

  /**
   * Create a code chunk from a tree-sitter node
   */
  private createChunkFromNode(
    node: Parser.SyntaxNode,
    content: string,
    filePath: string,
    language: string,
    strategy: ChunkStrategy,
    _lines: string[]
  ): CodeChunk | null {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    let chunkContent = node.text;

    // Privacy-focused chunk size enforcement (100-1000 characters)
    const MIN_CHUNK_SIZE = 100;
    const MAX_CHUNK_SIZE = 1000;

    // Skip if chunk is too small
    if (chunkContent.length < MIN_CHUNK_SIZE) {
      return null;
    }

    // Truncate if chunk is too large (privacy protection)
    if (chunkContent.length > MAX_CHUNK_SIZE) {
      chunkContent = chunkContent.substring(0, MAX_CHUNK_SIZE);
      console.log(`🔒 Privacy: Truncated chunk in ${filePath}:${startLine} to ${MAX_CHUNK_SIZE} chars`);
    }

    // Apply strategy-specific size limits (secondary validation)
    if (strategy.minSize && chunkContent.length < strategy.minSize) {
      return null;
    }
    if (strategy.maxSize && chunkContent.length > strategy.maxSize) {
      chunkContent = chunkContent.substring(0, strategy.maxSize);
    }

    // Extract name if strategy provides name extractor
    let name: string | undefined;
    if (strategy.nameExtractor) {
      name = strategy.nameExtractor(this.nodeToParser(node));
    }

    const metadata: ChunkMetadata = {
      fileSize: content.length,
      lastModified: Date.now(),
      language,
      extension: extname(filePath),
      relativePath: filePath,
      isTest: this.isTestFile(filePath),
      complexity: this.calculateComplexity(chunkContent),
      dependencies: this.extractDependencies(chunkContent, language),
      exports: this.extractExports(chunkContent, language),
      imports: this.extractImports(chunkContent, language)
    };

    // If the chunk is larger than MAX_CHUNK_SIZE, split it into multiple overlapping sub-chunks
    if (chunkContent.length > MAX_CHUNK_SIZE) {
      const SUB_CHUNK_OVERLAP = 100; // 100 char overlap for context preservation
      const subChunks: CodeChunk[] = [];

      for (let offset = 0; offset < chunkContent.length; offset += MAX_CHUNK_SIZE - SUB_CHUNK_OVERLAP) {
        const subContent = chunkContent.slice(offset, offset + MAX_CHUNK_SIZE);

        if (subContent.length < MIN_CHUNK_SIZE) {
          continue; // skip tiny trailing slice
        }

        // Estimate line numbers inside the parent chunk for metadata
        const offsetLines = chunkContent.slice(0, offset).split('\n').length - 1;
        const subStartLine = startLine + offsetLines;
        const subEndLine = Math.min(subStartLine + subContent.split('\n').length - 1, endLine);

        const subMetadata: ChunkMetadata = {
          ...metadata,
          complexity: this.calculateComplexity(subContent)
        };

        subChunks.push({
          id: this.generateChunkId(filePath, subStartLine, subEndLine, strategy.chunkType),
          content: subContent,
          filePath,
          language,
          startLine: subStartLine,
          endLine: subEndLine,
          chunkType: strategy.chunkType,
          functionName: strategy.chunkType === ChunkType.FUNCTION ? name : undefined,
          className: strategy.chunkType === ChunkType.CLASS ? name : undefined,
          moduleName: strategy.chunkType === ChunkType.MODULE ? name : undefined,
          contentHash: this.generateContentHash(subContent),
          metadata: subMetadata
        });
      }

      // Return null here; traverseNode will handle pushing subChunks separately
      (this as any)._deferredChunks = ((this as any)._deferredChunks || []).concat(subChunks);
      return null;
    }

    return {
      id: this.generateChunkId(filePath, startLine, endLine, strategy.chunkType),
      content: chunkContent,
      filePath,
      language,
      startLine,
      endLine,
      chunkType: strategy.chunkType,
      functionName: strategy.chunkType === ChunkType.FUNCTION ? name : undefined,
      className: strategy.chunkType === ChunkType.CLASS ? name : undefined,
      moduleName: strategy.chunkType === ChunkType.MODULE ? name : undefined,
      contentHash: this.generateContentHash(chunkContent),
      metadata
    };
  }

  /**
   * Parse generic files (non-code files or unsupported languages)
   */
  private parseGenericFile(filePath: string, content: string): CodeChunk[] {
    return this.parseGenericContent(content, filePath);
  }

  /**
   * Parse generic content by splitting into logical chunks
   */
  private parseGenericContent(content: string, filePath: string): CodeChunk[] {
    const ext = extname(filePath).toLowerCase();
    
    // Special handling for markdown files without tree-sitter
    if (ext === '.md' || ext === '.markdown') {
      return this.parseMarkdownContentFallback(content, filePath);
    }
    
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    const chunkSize = 50; // Lines per chunk
    const overlap = 5;

    // Privacy-focused chunk size enforcement
    const MIN_CHUNK_SIZE = 100;
    const MAX_CHUNK_SIZE = 1000;

    for (let i = 0; i < lines.length; i += chunkSize - overlap) {
      const chunkLines = lines.slice(i, i + chunkSize);
      const startLine = i + 1;
      const endLine = Math.min(i + chunkSize, lines.length);
      
      let chunkContent = chunkLines.join('\n');
      
      if (chunkContent.trim().length === 0) {
        continue;
      }

      // Privacy protection: enforce size limits
      if (chunkContent.length < MIN_CHUNK_SIZE) {
        continue; // Skip chunks that are too small
      }

      if (chunkContent.length > MAX_CHUNK_SIZE) {
        chunkContent = chunkContent.substring(0, MAX_CHUNK_SIZE);
        console.log(`🔒 Privacy: Truncated generic chunk in ${filePath}:${startLine} to ${MAX_CHUNK_SIZE} chars`);
      }

      const metadata: ChunkMetadata = {
        fileSize: content.length,
        lastModified: Date.now(),
        language: 'text',
        extension: extname(filePath),
        relativePath: filePath,
        isTest: this.isTestFile(filePath)
      };

      chunks.push({
        id: this.generateChunkId(filePath, startLine, endLine, ChunkType.GENERIC),
        content: chunkContent,
        filePath,
        language: 'text',
        startLine,
        endLine,
        chunkType: ChunkType.GENERIC,
        contentHash: this.generateContentHash(chunkContent),
        metadata
      });
    }

    return chunks;
  }

  /**
   * Parse markdown content without tree-sitter (fallback)
   */
  private parseMarkdownContentFallback(content: string, filePath: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    let currentChunk = '';
    let currentStartLine = 1;
    let currentChunkType = ChunkType.PARAGRAPH;
    let currentName = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // Check for ATX headings (# ## ### etc)
      const atxHeadingMatch = line.match(/^(#{1,6})\s*(.+?)(?:\s*#*)?$/);
      if (atxHeadingMatch) {
        // Save previous chunk if it exists
        if (currentChunk.trim()) {
          chunks.push(this.createMarkdownChunk(
            currentChunk.trim(),
            filePath,
            currentStartLine,
            lineNumber - 1,
            currentChunkType,
            currentName,
            content
          ));
        }

        // Start new section chunk
        currentChunk = line;
        currentStartLine = lineNumber;
        currentChunkType = ChunkType.SECTION;
        currentName = atxHeadingMatch[2].trim();
        continue;
      }

      // Check for setext headings (underlined with = or -)
      if (i > 0 && line.match(/^[=\-]{3,}$/)) {
        const prevLine = lines[i - 1];
        if (prevLine.trim()) {
          // Save previous chunk if it exists and is not the heading line
          if (currentChunk.trim() && currentChunk.trim() !== prevLine.trim()) {
            chunks.push(this.createMarkdownChunk(
              currentChunk.trim(),
              filePath,
              currentStartLine,
              lineNumber - 2,
              currentChunkType,
              currentName,
              content
            ));
          }

          // Create section chunk with heading and underline
          const sectionContent = prevLine + '\n' + line;
          chunks.push(this.createMarkdownChunk(
            sectionContent,
            filePath,
            lineNumber - 1,
            lineNumber,
            ChunkType.SECTION,
            prevLine.trim(),
            content
          ));

          currentChunk = '';
          currentStartLine = lineNumber + 1;
          currentChunkType = ChunkType.PARAGRAPH;
          currentName = '';
          continue;
        }
      }

      // Check for fenced code blocks
      if (line.match(/^```/)) {
        // Save previous chunk if it exists
        if (currentChunk.trim()) {
          chunks.push(this.createMarkdownChunk(
            currentChunk.trim(),
            filePath,
            currentStartLine,
            lineNumber - 1,
            currentChunkType,
            currentName,
            content
          ));
        }

        // Find the end of the code block
        const langMatch = line.match(/^```\s*([a-zA-Z0-9_+-]*)/);
        const language = langMatch && langMatch[1] ? langMatch[1] : 'code';
        
        let codeBlockContent = line + '\n';
        let j = i + 1;
        while (j < lines.length && !lines[j].match(/^```\s*$/)) {
          codeBlockContent += lines[j] + '\n';
          j++;
        }
        if (j < lines.length) {
          codeBlockContent += lines[j]; // Add closing ```
        }

        chunks.push(this.createMarkdownChunk(
          codeBlockContent.trim(),
          filePath,
          lineNumber,
          j + 1,
          ChunkType.CODE_BLOCK,
          language,
          content
        ));

        i = j; // Skip to after the code block
        currentChunk = '';
        currentStartLine = j + 2;
        currentChunkType = ChunkType.PARAGRAPH;
        currentName = '';
        continue;
      }

      // Add line to current chunk
      currentChunk += line + '\n';
    }

    // Save final chunk if it exists
    if (currentChunk.trim()) {
      chunks.push(this.createMarkdownChunk(
        currentChunk.trim(),
        filePath,
        currentStartLine,
        lines.length,
        currentChunkType,
        currentName,
        content
      ));
    }

    return chunks;
  }

  /**
   * Create a markdown chunk with proper metadata
   */
  private createMarkdownChunk(
    content: string,
    filePath: string,
    startLine: number,
    endLine: number,
    chunkType: ChunkType,
    name: string,
    fullContent: string
  ): CodeChunk {
    // Privacy-focused chunk size enforcement
    const MIN_CHUNK_SIZE = 100;
    const MAX_CHUNK_SIZE = 1000;

    // Skip if content is too small
    if (content.length < MIN_CHUNK_SIZE) {
      return null as any; // This will be filtered out
    }

    // Truncate if content is too large (privacy protection)
    if (content.length > MAX_CHUNK_SIZE) {
      content = content.substring(0, MAX_CHUNK_SIZE);
      console.log(`🔒 Privacy: Truncated markdown chunk in ${filePath}:${startLine} to ${MAX_CHUNK_SIZE} chars`);
    }
    const metadata: ChunkMetadata = {
      fileSize: fullContent.length,
      lastModified: Date.now(),
      language: 'markdown',
      extension: extname(filePath),
      relativePath: filePath,
      isTest: this.isTestFile(filePath),
      complexity: this.calculateComplexity(content)
    };

    return {
      id: this.generateChunkId(filePath, startLine, endLine, chunkType),
      content,
      filePath,
      language: 'markdown',
      startLine,
      endLine,
      chunkType,
      functionName: chunkType === ChunkType.CODE_BLOCK ? name : undefined,
      className: chunkType === ChunkType.SECTION ? name : undefined,
      moduleName: undefined,
      contentHash: this.generateContentHash(content),
      metadata
    };
  }

  /**
   * Get language from file extension
   */
  private getLanguageFromFile(filePath: string): string | null {
    const ext = extname(filePath).toLowerCase();
    
    const languageMap: Record<string, string> = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.py': 'python',
      '.md': 'markdown',
      '.markdown': 'markdown'
    };

    return languageMap[ext] || null;
  }

  /**
   * Convert tree-sitter node to our ParsedNode interface
   */
  private nodeToParser(node: Parser.SyntaxNode): ParsedNode {
    return {
      type: node.type,
      startPosition: {
        row: node.startPosition.row,
        column: node.startPosition.column
      },
      endPosition: {
        row: node.endPosition.row,
        column: node.endPosition.column
      },
      text: node.text,
      depth: this.calculateNodeDepth(node),
      children: node.children.map(child => this.nodeToParser(child))
    };
  }

  /**
   * Calculate node depth in the AST
   */
  private calculateNodeDepth(node: Parser.SyntaxNode): number {
    let depth = 0;
    let current = node.parent;
    while (current) {
      depth++;
      current = current.parent;
    }
    return depth;
  }

  /**
   * Generate content hash for chunk
   */
  private generateContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Generate unique chunk ID compatible with Qdrant (UUID format)
   */
  private generateChunkId(filePath: string, startLine: number, endLine: number, chunkType: ChunkType): string {
    // Create a deterministic UUID based on the chunk data
    const input = `${filePath}:${startLine}:${endLine}:${chunkType}`;
    const hash = this.simpleHash(input);
    
    // Convert hash to UUID format (8-4-4-4-12 hex digits)
    const hex = hash.padStart(32, '0').substring(0, 32);
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
  }

  /**
   * Enhanced hash function that produces hex output suitable for UUID generation
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Convert to positive hex and pad to ensure we have enough digits
    const hashStr = Math.abs(hash).toString(16);
    // Create a longer hex string by repeating and hashing if needed
    let result = hashStr;
    while (result.length < 32) {
      // Add more entropy by hashing the current result with original string
      let newHash = 0;
      const combined = result + str;
      for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        newHash = ((newHash << 5) - newHash) + char;
        newHash = newHash & newHash;
      }
      result += Math.abs(newHash).toString(16);
    }
    return result;
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const testPatterns = [
      /\.test\./,
      /\.spec\./,
      /test/,
      /spec/,
      /__tests__/
    ];
    
    return testPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Calculate code complexity (simple metric)
   */
  private calculateComplexity(content: string): number {
    const complexityKeywords = [
      'if', 'else', 'for', 'while', 'do', 'switch', 'case',
      'try', 'catch', 'finally', 'throw', 'return'
    ];
    
    let complexity = 1; // Base complexity
    
    for (const keyword of complexityKeywords) {
      const matches = content.match(new RegExp(`\\b${keyword}\\b`, 'g'));
      if (matches) {
        complexity += matches.length;
      }
    }
    
    return complexity;
  }

  /**
   * Extract dependencies/imports from content
   */
  private extractDependencies(content: string, language: string): string[] {
    const deps: string[] = [];
    
    switch (language) {
      case 'javascript':
      case 'typescript':
        const jsImports = content.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
        if (jsImports) {
          jsImports.forEach(imp => {
            const match = imp.match(/from\s+['"]([^'"]+)['"]/);
            if (match) deps.push(match[1]);
          });
        }
        break;
      case 'python':
        const pyImports = content.match(/(?:from\s+(\S+)\s+import|import\s+(\S+))/g);
        if (pyImports) {
          pyImports.forEach(imp => {
            const match = imp.match(/(?:from\s+(\S+)\s+import|import\s+(\S+))/);
            if (match) deps.push(match[1] || match[2]);
          });
        }
        break;
    }
    
    return deps;
  }

  /**
   * Extract exports from content
   */
  private extractExports(content: string, language: string): string[] {
    const exports: string[] = [];
    
    switch (language) {
      case 'javascript':
      case 'typescript':
        const jsExports = content.match(/export\s+(?:default\s+)?(?:function\s+|class\s+|const\s+|let\s+|var\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
        if (jsExports) {
          jsExports.forEach(exp => {
            const match = exp.match(/export\s+(?:default\s+)?(?:function\s+|class\s+|const\s+|let\s+|var\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)/);
            if (match) exports.push(match[1]);
          });
        }
        break;
    }
    
    return exports;
  }

  /**
   * Extract imports from content
   */
  private extractImports(content: string, language: string): string[] {
    return this.extractDependencies(content, language);
  }

  /**
   * Initialize language configurations
   */
  private initializeLanguageConfigs(): void {
    // JavaScript/TypeScript configuration
    const jsConfig: LanguageConfig = {
      name: 'javascript',
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      grammar: 'javascript',
      chunkStrategies: [
        {
          nodeType: 'function_declaration',
          chunkType: ChunkType.FUNCTION,
          nameExtractor: (node) => this.extractFunctionName(node)
        },
        {
          nodeType: 'class_declaration',
          chunkType: ChunkType.CLASS,
          nameExtractor: (node) => this.extractClassName(node)
        },
        {
          nodeType: 'interface_declaration',
          chunkType: ChunkType.INTERFACE,
          nameExtractor: (node) => this.extractInterfaceName(node)
        },
        {
          nodeType: 'method_definition',
          chunkType: ChunkType.FUNCTION,
          nameExtractor: (node) => this.extractMethodName(node)
        },
        {
          nodeType: 'arrow_function',
          chunkType: ChunkType.FUNCTION,
          nameExtractor: (node) => this.extractFunctionName(node)
        }
      ],
      keywords: ['function', 'class', 'interface', 'const', 'let', 'var', 'import', 'export'],
      commentPatterns: ['//', '/*', '*/'],
      astNodeMappings: {},
      contextualChunking: false,
      supportsSparseSearch: true
    };

    // Python configuration
    const pyConfig: LanguageConfig = {
      name: 'python',
      extensions: ['.py'],
      grammar: 'python',
      chunkStrategies: [
        {
          nodeType: 'function_definition',
          chunkType: ChunkType.FUNCTION,
          nameExtractor: (node) => this.extractFunctionName(node)
        },
        {
          nodeType: 'class_definition',
          chunkType: ChunkType.CLASS,
          nameExtractor: (node) => this.extractClassName(node)
        }
      ],
      keywords: ['def', 'class', 'import', 'from', 'if', 'else', 'for', 'while'],
      commentPatterns: ['#'],
      astNodeMappings: {},
      contextualChunking: false,
      supportsSparseSearch: true
    };

    // Markdown configuration
    const markdownConfig: LanguageConfig = {
      name: 'markdown',
      extensions: ['.md', '.markdown'],
      grammar: 'markdown',
      chunkStrategies: [
        {
          nodeType: 'atx_heading',
          chunkType: ChunkType.SECTION,
          nameExtractor: (node) => this.extractMarkdownHeading(node),
          includeContext: true
        },
        {
          nodeType: 'setext_heading',
          chunkType: ChunkType.SECTION,
          nameExtractor: (node) => this.extractMarkdownHeading(node),
          includeContext: true
        },
        {
          nodeType: 'fenced_code_block',
          chunkType: ChunkType.CODE_BLOCK,
          nameExtractor: (node) => this.extractCodeBlockLanguage(node)
        },
        {
          nodeType: 'indented_code_block',
          chunkType: ChunkType.CODE_BLOCK,
          nameExtractor: () => 'code'
        },
        {
          nodeType: 'paragraph',
          chunkType: ChunkType.PARAGRAPH,
          minSize: 50, // Only chunk substantial paragraphs
          maxSize: 2000
        },
        {
          nodeType: 'list',
          chunkType: ChunkType.LIST,
          minSize: 30
        },
        {
          nodeType: 'table',
          chunkType: ChunkType.TABLE,
          nameExtractor: () => 'table'
        },
        {
          nodeType: 'block_quote',
          chunkType: ChunkType.BLOCKQUOTE,
          minSize: 30
        }
      ],
      keywords: ['#', '##', '###', '####', '#####', '######', '```', '---', '***'],
      commentPatterns: ['<!--', '-->'],
      astNodeMappings: {
        'atx_heading': ChunkType.SECTION,
        'setext_heading': ChunkType.SECTION,
        'fenced_code_block': ChunkType.CODE_BLOCK,
        'indented_code_block': ChunkType.CODE_BLOCK,
        'paragraph': ChunkType.PARAGRAPH,
        'list': ChunkType.LIST,
        'table': ChunkType.TABLE,
        'block_quote': ChunkType.BLOCKQUOTE
      },
      contextualChunking: true,
      supportsSparseSearch: true
    };

    this.languageConfigs.set('javascript', jsConfig);
    this.languageConfigs.set('typescript', jsConfig);
    this.languageConfigs.set('tsx', jsConfig);
    this.languageConfigs.set('python', pyConfig);
    this.languageConfigs.set('markdown', markdownConfig);
  }

  /**
   * Extract function name from node
   */
  private extractFunctionName(node: ParsedNode): string {
    // Simple name extraction - in real implementation, this would be more sophisticated
    const nameMatch = node.text.match(/(?:function\s+|def\s+)([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    return nameMatch ? nameMatch[1] : 'anonymous';
  }

  /**
   * Extract class name from node
   */
  private extractClassName(node: ParsedNode): string {
    const nameMatch = node.text.match(/class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    return nameMatch ? nameMatch[1] : 'anonymous';
  }

  /**
   * Extract interface name from node
   */
  private extractInterfaceName(node: ParsedNode): string {
    const nameMatch = node.text.match(/interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    return nameMatch ? nameMatch[1] : 'anonymous';
  }

  /**
   * Extract method name from node
   */
  private extractMethodName(node: ParsedNode): string {
    const nameMatch = node.text.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
    return nameMatch ? nameMatch[1] : 'anonymous';
  }

  /**
   * Extract markdown heading text from node
   */
  private extractMarkdownHeading(node: ParsedNode): string {
    // Extract text from ATX headings (# ## ### etc) or setext headings (=== --- underlines)
    const text = node.text.trim();
    
    // For ATX headings, remove the # symbols
    const atxMatch = text.match(/^#{1,6}\s*(.+?)(?:\s*#*)?$/);
    if (atxMatch) {
      return atxMatch[1].trim();
    }
    
    // For setext headings, take the first line
    const setextMatch = text.match(/^(.+?)\n[=\-]+/);
    if (setextMatch) {
      return setextMatch[1].trim();
    }
    
    // Fallback to first line
    return text.split('\n')[0].trim();
  }

  /**
   * Extract code block language from fenced code block
   */
  private extractCodeBlockLanguage(node: ParsedNode): string {
    const text = node.text.trim();
    
    // Extract language from fenced code block (```language)
    const langMatch = text.match(/^```\s*([a-zA-Z0-9_+-]*)/);
    if (langMatch && langMatch[1]) {
      return langMatch[1];
    }
    
    return 'code';
  }
} 