import Parser from 'tree-sitter';
import { readFileSync } from 'fs';
import { extname } from 'path';
import { 
  CodeChunk, 
  ChunkType, 
  ChunkMetadata, 
  ParsedNode, 
  LanguageConfig, 
  ChunkStrategy 
} from '../types.js';

// Dynamic imports for tree-sitter language grammars
const loadLanguage = async (language: string): Promise<any> => {
  switch (language) {
    case 'javascript':
      return (await import('tree-sitter-javascript')).default;
    case 'typescript':
      return (await import('tree-sitter-typescript')).typescript;
    case 'tsx':
      return (await import('tree-sitter-typescript')).tsx;
    case 'python':
      return (await import('tree-sitter-python')).default;
    default:
      throw new Error(`Language parser not available for: ${language}`);
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
    
    if (!language) {
      return this.parseGenericFile(filePath, content);
    }

    try {
      const grammar = await loadLanguage(language);
      this.parser.setLanguage(grammar);
      
      const tree = this.parser.parse(content);
      const chunks = this.extractChunks(tree.rootNode, content, filePath, language);
      
      return chunks;
    } catch (error) {
      console.warn(`Failed to parse ${filePath} with ${language} parser, falling back to generic:`, error);
      return this.parseGenericFile(filePath, content);
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
    const chunkContent = node.text;

    // Skip if chunk is too small or too large
    if (strategy.minSize && chunkContent.length < strategy.minSize) {
      return null;
    }
    if (strategy.maxSize && chunkContent.length > strategy.maxSize) {
      return null;
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
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    const chunkSize = 50; // Lines per chunk
    const overlap = 5;

    for (let i = 0; i < lines.length; i += chunkSize - overlap) {
      const chunkLines = lines.slice(i, i + chunkSize);
      const startLine = i + 1;
      const endLine = Math.min(i + chunkSize, lines.length);
      
      const chunkContent = chunkLines.join('\n');
      
      if (chunkContent.trim().length === 0) {
        continue;
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
        metadata
      });
    }

    return chunks;
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
      '.py': 'python'
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
      children: node.children.map(child => this.nodeToParser(child))
    };
  }

  /**
   * Generate unique chunk ID
   */
  private generateChunkId(filePath: string, startLine: number, endLine: number, chunkType: ChunkType): string {
    const hash = this.simpleHash(`${filePath}:${startLine}:${endLine}:${chunkType}`);
    return `${chunkType}_${hash}`;
  }

  /**
   * Simple hash function for generating IDs
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
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
        }
      ],
      keywords: ['function', 'class', 'interface', 'const', 'let', 'var', 'import', 'export'],
      commentPatterns: ['//', '/*', '*/']
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
      commentPatterns: ['#']
    };

    this.languageConfigs.set('javascript', jsConfig);
    this.languageConfigs.set('typescript', jsConfig);
    this.languageConfigs.set('tsx', jsConfig);
    this.languageConfigs.set('python', pyConfig);
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
} 