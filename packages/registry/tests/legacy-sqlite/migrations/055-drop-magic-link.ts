import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Drop the retired magic-link pipe tables.
 *
 * Both the email magic link (web sign-in) and email-based CLI device pairing
 * rode `magic_link_tokens`, with `session_pickups` as the CLI email-pickup
 * channel. Both are retired: web sign-in now uses email login codes
 * (`email_login_codes`), and the CLI pairs only via `skillet connect <code>`
 * (connect-pair). No live code references either table.
 */
export const migration055DropMagicLink: RegistryMigration = {
  version: 55,
  name: 'drop_magic_link',
  up: (db) => {
    db.exec(`
      DROP TABLE IF EXISTS magic_link_tokens;
      DROP TABLE IF EXISTS session_pickups;
    `);
  },
};
