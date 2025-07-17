# Alerts & Monitoring

## Fly App Metrics Alerts

Create metric-based alerts via the Fly dashboard or `fly monitor add` CLI.

| Metric | Threshold | Duration | Action |
|--------|-----------|----------|--------|
| cpu.total | > 70% | 5m | investigate, consider scaling |
| memory.used | > 800MiB (1 GB plan) | 5m | possible leak |
| http.responses.5xx | > 5/min | 2m | review logs |

Example CLI:

```bash
fly monitor add --app codebase-indexing \
  --name high-cpu --metric cpu.total --threshold 70 --duration 300 --comparison gt
```

## Log Aggregation

Logs are JSON via `pino`.  Ship them using `fly logs -j` to any collector (Grafana Cloud / Honeycomb).

Key fields: `level`, `msg`, `requestId`, `sessionId`, `allocID`, `tool`, `durationMs`. 