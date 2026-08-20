import type { RegistryMigration } from '../migrate-runner.js';

/**
 * Email login codes — the passwordless web sign-in fallback (OAuth-first).
 *
 * A dedicated store, deliberately NOT `magic_link_tokens`: that table and its
 * whole pipe (emailed link, token-verify, CLI-confirm) are being retired, so the
 * new code path must not be entangled with it. One row per send: a hashed 6-digit
 * code, an expiry, a single-use `consumed_at`, and an `attempts` counter for
 * wrong-code lockout. Codes are scanner-proof and cross-device by construction —
 * the session mints where the user types the code, not where the email opened.
 */
export const migration054EmailLoginCodes: RegistryMigration = {
  version: 54,
  name: 'email_login_codes',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_login_codes (
        id          TEXT PRIMARY KEY,
        email       TEXT NOT NULL,
        code_hash   TEXT NOT NULL,
        request_ip  TEXT,
        expires_at  INTEGER NOT NULL,
        consumed_at INTEGER,
        attempts    INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_email_login_codes_email
        ON email_login_codes (email, created_at);
    `);
  },
};
