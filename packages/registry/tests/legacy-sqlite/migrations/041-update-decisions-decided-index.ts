import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Index for the /me/updates "recently applied" read.
 *
 * That query filters `update_decisions` by (user_id, state='approved'), evaluates
 * a correlated EXISTS per row, then `ORDER BY decided_at DESC LIMIT 50`. The
 * existing idx_update_decisions_user(user_id, state) covers the filter but not the
 * sort, so SQLite must sort every approved row before applying the LIMIT. Adding
 * decided_at to the index lets it walk rows in decided order and stop early — which
 * matters more now that subscribe-time baselining writes one approved decision per
 * subscribed skill, growing each user's approved-row count.
 */
export const migration041UpdateDecisionsDecidedIndex: RegistryMigration = {
  version: 41,
  name: 'update_decisions_decided_index',
  up: (db) => {
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_update_decisions_decided
         ON update_decisions (user_id, state, decided_at);`,
    );
  },
};
