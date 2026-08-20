import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Mirror source owner TYPE on the author row.
 *
 * A mirror's GitHub source is either a User (a personal account, e.g.
 * @alice) or an Organization (e.g. @vercel). The web UI branches its claim
 * affordances on which one it is (a User source can offer "claim as a personal
 * account" via the future logged-out path; an Org source cannot), so the brand
 * profile response must surface it. The org row already records the verified
 * numeric `source_owner_id` (migration 037) but not the type, so storing the type
 * on `authors` is the simplest single-read source.
 *
 * Plain ADD COLUMN (no table rebuild). Existing rows default to NULL ("unknown"),
 * which the UI treats as the conservative Organization-style affordance.
 */
export const migration039MirrorSourceOwnerType: RegistryMigration = {
  version: 39,
  name: 'mirror_source_owner_type',
  up: (db) => {
    db.exec(`ALTER TABLE authors ADD COLUMN source_owner_type TEXT;`);
  },
};
