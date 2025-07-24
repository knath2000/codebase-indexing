import pino from 'pino'
import type { Config } from '../types.js'
import { truncateToWidth } from './string-utils.js'

/**
 * Create a logger instance with optional configuration override
 * Enables dependency injection and easier testing
 */
export const createLogger = (config?: Partial<Config>, opts?: pino.LoggerOptions) => {
  const logLevel = config?.logLevel || 'info'
  const logPretty = config?.logPretty || false
  
  const baseOptions: pino.LoggerOptions = {
    level: logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      bindings: (bindings: pino.Bindings) => ({ 
        pid: bindings.pid, 
        hostname: bindings.hostname 
      }),
      level: (label: string) => ({ level: label })
    },
    // Use async transport for better performance in production
    transport: logPretty ? {
      target: 'pino-pretty',
      options: { 
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    } : undefined,
    ...opts
  }
  
  return pino(baseOptions)
}

/**
 * Global logger instance - will be replaced with factory-created instance
 * @deprecated Use createLogger() instead for new code
 */
export const logger = createLogger()

/**
 * Create a child logger with request context
 * Ensures all downstream logging includes request/session ID for traceability
 */
export const createLoggerWithContext = (
  baseLogger: pino.Logger, 
  context: { requestId?: string; sessionId?: string; workspace?: string }
) => {
  return baseLogger.child({
    requestId: context.requestId,
    sessionId: context.sessionId,
    workspace: context.workspace
  })
}

/**
 * Express middleware helper to create request-scoped logger
 */
export const loggerWithReq = (req: any, baseLogger: pino.Logger = logger) => {
  return createLoggerWithContext(baseLogger, {
    requestId: req.id || req.headers['x-request-id'],
    sessionId: req.session?.id || req.headers['x-session-id'],
    workspace: req.headers['x-workspace']
  })
}

/**
 * Unicode-safe snippet truncation with proper character boundary handling
 * Uses custom string-width implementation for accurate character counting
 */
export function redactSnippet(snippet?: string, maxLength: number = 120): string | undefined {
  if (!snippet) return undefined
  
  const truncated = truncateToWidth(snippet, maxLength)
  return truncated + (snippet.length > truncated.length ? '…' : '')
}

/**
 * Safe logging utility for potentially large content
 * Automatically truncates and redacts sensitive information
 */
export function safeLogs(content: any, maxLength: number = 120): any {
  if (typeof content === 'string') {
    return redactSnippet(content, maxLength)
  }
  
  if (typeof content === 'object' && content !== null) {
    // Redact common sensitive fields
    const sensitiveFields = ['password', 'token', 'key', 'secret', 'auth']
    const result: any = Array.isArray(content) ? [] : {}
    
    for (const [key, value] of Object.entries(content)) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        result[key] = '[REDACTED]'
      } else if (typeof value === 'string') {
        result[key] = redactSnippet(value, maxLength)
      } else {
        result[key] = value
      }
    }
    
    return result
  }
  
  return content
}

/**
 * Performance logging utility for measuring operation duration
 */
export function createPerfLogger(logger: pino.Logger, operation: string) {
  const start = Date.now()
  
  return {
    end: (result?: { success: boolean; count?: number; error?: string }) => {
      const duration = Date.now() - start
      
      if (result?.success === false) {
        logger.warn({
          operation,
          duration,
          error: result.error,
          count: result.count
        }, `Operation ${operation} failed after ${duration}ms`)
      } else {
        logger.info({
          operation,
          duration,
          count: result?.count
        }, `Operation ${operation} completed in ${duration}ms`)
      }
    }
  }
} 