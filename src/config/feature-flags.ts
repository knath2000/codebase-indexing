export interface FeatureFlags {
  ENABLE_LLM_RERANKING: boolean
  ENABLE_HYBRID_SPARSE: boolean
  AUTO_INDEX_ON_CONNECT: boolean
}

function envBool(key: string, def: boolean): boolean {
  const val = process.env[key]
  if (val === undefined) return def
  return val === 'true' || val === '1'
}

export const featureFlags: FeatureFlags = {
  ENABLE_LLM_RERANKING: envBool('ENABLE_LLM_RERANKING', true),
  ENABLE_HYBRID_SPARSE: envBool('ENABLE_HYBRID_SPARSE', true),
  AUTO_INDEX_ON_CONNECT: envBool('AUTO_INDEX_ON_CONNECT', true)
} 