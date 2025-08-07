# Nightly Qdrant Vacuum Cron

Run a nightly compaction to keep vector storage efficient.

## Using Fly Machines + cron via Supercronic

1. **Add supercronic** to Dockerfile

```dockerfile
RUN apk add --no-cache supercronic
COPY cron.txt /etc/cron.txt
CMD ["/usr/bin/supercronic", "/etc/cron.txt"]
```

2. **cron.txt** file

```
# run at 03:15 UTC nightly
15 3 * * * curl -s http://localhost:3001/admin/vacuum | logger -t qdrant-vacuum
```

3. Alternatively, run from your CI:

```bash
fly ssh console -C "curl -s http://localhost:3001/admin/vacuum" -a codebase-indexing
``` 