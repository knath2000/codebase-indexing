# Contributing to MCP Codebase Indexing Server

Thank you for your interest in contributing to the MCP Codebase Indexing Server! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites

- Node.js 18 or higher
- npm 8 or higher
- Git
- Docker (for running Qdrant locally)

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/your-username/mcp-codebase-indexing-server.git
   cd mcp-codebase-indexing-server
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp config.example.env .env
   # Edit .env with your Voyage AI API key
   ```

4. **Start Qdrant locally**
   ```bash
   docker run -d -p 6333:6333 --name qdrant qdrant/qdrant
   ```

5. **Build and run**
   ```bash
   npm run build
   npm start
   ```

## 🛠️ Development Workflow

### Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write clear, concise code
   - Follow existing code style and patterns
   - Add tests for new functionality
   - Update documentation as needed

3. **Test your changes**
   ```bash
   npm test
   npm run lint
   npm run build
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

**Examples:**
```
feat: add support for Go language parsing
fix: resolve memory leak in indexing service
docs: update installation instructions
test: add unit tests for search service
```

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Writing Tests

- Place test files next to the code they test with `.test.ts` extension
- Use Jest for unit testing
- Mock external dependencies (Voyage AI, Qdrant)
- Aim for high test coverage, especially for critical paths

**Example test structure:**
```typescript
describe('IndexingService', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  it('should index a directory successfully', async () => {
    // Test implementation
  });
});
```

## 📝 Code Style

### TypeScript Guidelines

- Use strict TypeScript configuration
- Define interfaces for all data structures
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Prefer composition over inheritance

### Code Formatting

We use Prettier and ESLint for code formatting:

```bash
# Format code
npm run format

# Check linting
npm run lint

# Fix linting issues
npm run lint:fix
```

### File Organization

```
src/
├── types.ts              # Shared type definitions
├── index.ts              # Main server entry point
├── clients/              # External service clients
│   ├── voyage-client.ts
│   └── qdrant-client.ts
├── parsers/              # Code parsing logic
│   └── code-parser.ts
├── services/             # Business logic
│   ├── indexing-service.ts
│   └── search-service.ts
└── utils/                # Utility functions
    └── config.ts
```

## 🔍 Adding New Features

### Adding Language Support

1. **Install tree-sitter grammar**
   ```bash
   npm install tree-sitter-language-name
   ```

2. **Update code parser**
   - Add language configuration in `src/parsers/code-parser.ts`
   - Update file extension mapping
   - Add language-specific parsing rules

3. **Add tests**
   - Create test files in the new language
   - Add unit tests for parsing functionality

4. **Update documentation**
   - Add language to supported languages table in README
   - Update configuration examples

### Adding New Tools

1. **Define tool schema**
   - Add tool definition to `TOOL_DEFINITIONS` in `src/index.ts`
   - Include proper input/output schemas

2. **Implement tool handler**
   - Add handler function in appropriate service
   - Include error handling and validation

3. **Add tests**
   - Unit tests for the tool functionality
   - Integration tests with MCP protocol

4. **Update documentation**
   - Add tool to README tool list
   - Include usage examples

## 🐛 Bug Reports

When reporting bugs, please include:

1. **Environment information**
   - Node.js version
   - Operating system
   - Server version

2. **Steps to reproduce**
   - Clear, step-by-step instructions
   - Minimal code example if applicable

3. **Expected vs actual behavior**
   - What you expected to happen
   - What actually happened

4. **Additional context**
   - Error logs
   - Screenshots if relevant
   - Configuration details (without API keys)

## 💡 Feature Requests

When requesting features:

1. **Describe the problem**
   - What problem does this solve?
   - Who would benefit from this feature?

2. **Propose a solution**
   - How would you like this to work?
   - Are there alternative approaches?

3. **Additional context**
   - Examples from other tools
   - Implementation ideas

## 📋 Pull Request Process

1. **Ensure your PR**
   - Follows the code style guidelines
   - Includes appropriate tests
   - Updates documentation if needed
   - Has a clear description

2. **PR Description Template**
   ```markdown
   ## Description
   Brief description of changes

   ## Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Breaking change
   - [ ] Documentation update

   ## Testing
   - [ ] Tests pass locally
   - [ ] Added new tests
   - [ ] Manual testing completed

   ## Checklist
   - [ ] Code follows style guidelines
   - [ ] Self-review completed
   - [ ] Documentation updated
   ```

3. **Review Process**
   - All PRs require at least one review
   - Address feedback promptly
   - Keep PRs focused and reasonably sized

## 🏷️ Release Process

1. **Version Bumping**
   - Follow semantic versioning (semver)
   - Update version in package.json
   - Update CHANGELOG.md

2. **Release Notes**
   - Document new features
   - List bug fixes
   - Note breaking changes
   - Include migration guides if needed

## 🤝 Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## 📞 Getting Help

- **GitHub Discussions**: For general questions and discussions
- **GitHub Issues**: For bug reports and feature requests
- **Discord/Slack**: [Link to community chat if available]

## 🙏 Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes for significant contributions
- GitHub contributors page

Thank you for contributing to the MCP Codebase Indexing Server! 🎉 