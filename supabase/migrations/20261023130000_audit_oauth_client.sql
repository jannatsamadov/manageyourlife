-- MCP calls can now come with an OAuth access token (claude.ai connector, P-18) instead of a personal token:
-- the audit log records which OAuth client made the write.
ALTER TABLE public.api_audit_log ADD COLUMN oauth_client_id text;
