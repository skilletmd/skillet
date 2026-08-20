import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Per-token MCP rate-limit buckets.
 *
 * Migration 050 created `mcp_call_attempts` with only an `ip` column, but
 * per-IP cannot isolate hosted-MCP users: connector traffic arrives from
 * shared OpenAI/Anthropic egress IPs, so one abusive token would starve every
 * other token behind the same IP. The PRIMARY isolation key is the mcp_link
 * id — add it here (050 is committed; append, never edit).
 *
 * `link_id` is the mcp_links row id, not the token or its hash, so attempt
 * rows carry no credential material. Nullable to keep ADD COLUMN trivial;
 * the limiter only writes rows after auth resolves, so in practice it is
 * always set. No FK: attempts must survive (and keep counting) even if a
 * link row is revoked/deleted mid-flood, and rows are short-lived anyway.
 */
export const migration051McpCallAttemptsLink: RegistryMigration = {
  version: 51,
  name: 'mcp_call_attempts_link',
  up: (db) => {
    db.exec(`
      ALTER TABLE mcp_call_attempts ADD COLUMN link_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_mcp_call_attempts_link_time
        ON mcp_call_attempts (link_id, attempted_at);
    `);
  },
};
