import pino from 'pino'

// Resolve log level with sensible defaults per environment
function resolveLogLevel(): pino.LevelWithSilent {
  const raw = (process.env.LOG_LEVEL || '').toLowerCase()
  const allowed: Record<string, pino.LevelWithSilent> = {
    trace: 'trace',
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    error: 'error',
    fatal: 'fatal',
    silent: 'silent',
  }

  if (raw in allowed) return allowed[raw]

  // Environment-aware defaults
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase()
  if (nodeEnv === 'test') return 'silent'
  if (nodeEnv === 'development' || nodeEnv === 'dev') return 'debug'
  return 'info'
}

// Pino redaction paths for sensitive values commonly seen in request objects
const REDACT_PATHS = [
  // HTTP headers / bodies
  'req.headers.authorization',
  'request.headers.authorization',
  'headers.authorization',
  'req.body.password',
  'body.password',
  // Common API key fields
  'qdrantApiKey',
  'voyageApiKey',
  'llmRerankerApiKey',
  // Generic config shapes
  'config.headers.Authorization',
  'authorization',
]

export const logger = pino({
  level: resolveLogLevel(),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'codebase-indexing-mcp',
    env: process.env.NODE_ENV || 'development',
  },
  formatters: {
    // Keep bindings minimal to reduce noise
    bindings: (bindings) => ({ pid: bindings.pid, hostname: bindings.hostname }),
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: REDACT_PATHS,
    remove: false,
  },
})

/**
 * Create a child logger for a specific module/component.
 */
export function createModuleLogger(moduleName: string) {
  return logger.child({ module: moduleName })
}


