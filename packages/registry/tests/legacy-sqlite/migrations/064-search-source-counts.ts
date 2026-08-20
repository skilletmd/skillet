import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Additive per-day counter for router-driven searches.
 *
 * `GET /search` reads an optional `x-skillet-search-source` marker (a fixed
 * slug like `route-skill`) and bumps a `(day, source)` row. This is the ONLY
 * demand signal for the @skillet/route registry fall-through: raw endpoint
 * traffic conflates web search, standalone CLI use, and router whiffs, so the
 * marker is what makes "how often does the router send people to search?"
 * readable. No query text, IP, or identity is stored — just the count. The
 * table is content-free by construction.
 *
 * `day` is a UTC calendar date (`YYYY-MM-DD`); the composite primary key makes
 * the write an idempotent upsert.
 */
export const migration064SearchSourceCounts: RegistryMigration = {
  version: 64,
  name: 'search_source_counts',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_source_counts (
        day    TEXT NOT NULL,
        source TEXT NOT NULL,
        count  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, source)
      )
    `);
  },
};
