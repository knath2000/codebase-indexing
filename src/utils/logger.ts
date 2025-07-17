import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    bindings: (bindings: pino.Bindings) => ({ pid: bindings.pid, hostname: bindings.hostname }),
    level: (label: string) => ({ level: label })
  }
})

export function redactSnippet(snippet?: string): string | undefined {
  if (!snippet) return undefined
  return snippet.length > 120 ? snippet.slice(0, 120) + '…' : snippet
} 