import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Per-client usage attribution for hosted MCP links.
 *
 * The settings row previously showed a STATIC "works with ChatGPT/Claude.ai"
 * glyph pair whether or not anything had ever connected. Every MCP client
 * names itself in the `initialize` handshake (clientInfo.name), so the serve
 * path records which clients actually used a link and the web renders glyphs
 * from real usage only. One row per (link, client); revoked links cascade.
 */
export const migration061McpLinkClients: RegistryMigration = {
  version: 61,
  name: 'mcp_link_clients',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_link_clients (
        link_id       TEXT NOT NULL REFERENCES mcp_links(id) ON DELETE CASCADE,
        client        TEXT NOT NULL,
        first_used_at INTEGER NOT NULL,
        last_used_at  INTEGER NOT NULL,
        PRIMARY KEY (link_id, client)
      );
    `);
  },
};
