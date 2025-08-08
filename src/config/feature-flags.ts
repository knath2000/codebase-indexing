import { z } from 'zod'

// Normalized feature flags surface for consistent access across the app
export const FeatureFlagsSchema = z.object({
  enableLLMReranking: z.boolean().default(true),
  enableHybridSparse: z.boolean().default(true),
  autoIndexOnConnect: z.boolean().default(true),
})

export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>

function envBool(key: string, def: boolean): boolean {
  const val = process.env[key]
  if (val === undefined) return def
  return val === 'true' || val === '1'
}

/**
 * Load and validate feature flags from environment variables, then normalize
 * to our canonical camelCase surface.
 */
export function loadFeatureFlagsFromEnv(): FeatureFlags {
  const raw = {
    enableLLMReranking: envBool('ENABLE_LLM_RERANKING', true),
    enableHybridSparse: envBool('ENABLE_HYBRID_SPARSE', true),
    autoIndexOnConnect: envBool('AUTO_INDEX_ON_CONNECT', true),
  }
  return FeatureFlagsSchema.parse(raw)
}