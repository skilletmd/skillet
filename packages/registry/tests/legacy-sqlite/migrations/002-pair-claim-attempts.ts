import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Per-IP brute-force protection for POST /api/v1/connect/claim.
 *
 * The claim endpoint is unauthenticated (a brand-new machine has no session),
 * and a correct guess mints a full session + device token for the code owner —
 * i.e. account takeover. The pair code is only 32^6 ≈ 2^30, so without a throttle
 * the 10-minute live window is brute-forceable. We count EVERY claim attempt by
 * client IP (hits and misses) so the limiter can't be reset by guessing.
 */
export const migration002PairClaimAttempts: RegistryMigration = {
  version: 2,
  name: 'pair_claim_attempts',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pair_claim_attempts (
        id           TEXT PRIMARY KEY,
        ip           TEXT NOT NULL,
        attempted_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_pair_claim_attempts_ip_time
        ON pair_claim_attempts (ip, attempted_at);
    `);
  },
};
