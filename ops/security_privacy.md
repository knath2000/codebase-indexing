# Security & Privacy Notes
 
* All collection names are prefixed with `<orgId>_workspace_` to isolate data.
* `logger.redactSnippet()` truncates any code snippet >120 chars before logging.
* Disable request/response body logging in production.
* Only embeddings (one-way vectors) are stored outside the VM.
* Fly secrets **QDRANT_API_KEY** and **VOYAGE_API_KEY** are required at runtime. 