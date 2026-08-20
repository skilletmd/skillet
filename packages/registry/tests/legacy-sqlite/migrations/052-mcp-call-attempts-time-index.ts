import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Bare attempted_at index for MCP rate-limit rows.
 *
 * ratelimit/mcp.ts filters on attempted_at alone twice per call — the
 * global-scope COUNT and the inline cleanup DELETE — and neither the
 * (ip, attempted_at) nor the (link_id, attempted_at) composite index serves a
 * bare attempted_at range, so both ran as full table scans on every request.
 * Add the single-column index here (051 is committed; append, never edit).
 */
export const migration052McpCallAttemptsTimeIndex: RegistryMigration = {
  version: 52,
  name: 'mcp_call_attempts_time_index',
  up: (db) => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_mcp_call_attempts_time
        ON mcp_call_attempts (attempted_at);
    `);
  },
};
