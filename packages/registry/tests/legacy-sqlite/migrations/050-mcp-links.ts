import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Personal MCP links (hosted MCP endpoint).
 *
 * One active `skillet_m_` link per user (active = revoked_at IS NULL —
 * enforced in route logic, not schema, so revoked history rows can pile up
 * under the same user). Lookup stays hash-based like every other token class;
 * `token_secret_enc` additionally keeps the secret AES-256-GCM-encrypted under
 * SKILLET_MCP_TOKEN_KEY so settings can re-show the link URL (R6). Plaintext
 * is never stored. Regenerate revokes the old row and inserts a new one in a
 * single transaction (R8).
 *
 * `mcp_call_attempts` mirrors pair_claim_attempts: the MCP endpoint itself is
 * URL-token-authenticated (no session), so a later unit throttles calls per IP
 * to blunt token brute-force and scraping.
 */
export const migration050McpLinks: RegistryMigration = {
  version: 50,
  name: 'mcp_links',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_links (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash       TEXT NOT NULL UNIQUE,
        token_secret_enc TEXT NOT NULL,
        created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
        revoked_at       INTEGER,
        last_used_at     INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_links_user
        ON mcp_links (user_id, revoked_at);

      CREATE TABLE IF NOT EXISTS mcp_call_attempts (
        id           TEXT PRIMARY KEY,
        ip           TEXT NOT NULL,
        attempted_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_call_attempts_ip_time
        ON mcp_call_attempts (ip, attempted_at);
    `);
  },
};
