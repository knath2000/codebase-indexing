# Active Context

## Current Work Focus: Configuration safety, health authority, and cache predictability (Aug 8, 2025)

### ✅ Completed in this session

- Config normalization: `normalizeRerankerBaseUrl()` added with cross-field validation and numeric clamping; feature flags validated via Zod and exposed as `config.flags`.
- Health monitor: `HealthMonitorService` is the single aggregator with `start()/stop()`, jittered interval, structured logging; `get_health_status` delegates here.
- Search cache: Upgraded to true LRU with configurable `searchCacheTTL` and `searchCacheMaxSize`, lifecycle controls, and metrics; started in `SearchService.initialize()`.
- Docs: README updated (feature flags, reranker base URL rules). Clean build and code pushed to GitHub to trigger Railway redeploy.

### **Notes & Next**
- Plan to generate CONFIGURATION.md from Zod schema for better discoverability.
- Finish DI pass to remove remaining direct env reads and group config by concern while preserving back-compat.

### **Current State: FULLY OPERATIONAL & PRODUCTION READY**
- Safety improved (config validation), health is authoritative, cache is predictable and tunable. All advanced features active and validated.