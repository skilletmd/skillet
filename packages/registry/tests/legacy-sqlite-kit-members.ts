// Quarantined sqlite kit-member redeem helpers for characterization under tests/ (U4).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { userHasVerifiedEmailMatch } from './legacy-sqlite-auth-helpers.js'
import { query } from './legacy-sqlite-query.js'

/**
 * Email-bind hook: when a user binds an email (OAuth attach), invites pinned to
 * that address must promote into kit_members + flip redeemed_at, same as the
 * /claim handle path. Lives here so the OAuth attach path can import a stable
 * name without having to know the schema; the runtime is a no-op until /claim
 * or OAuth passes a real (userId, email) pair.
 *
 * Future: wire this from the OAuth attach handler once users.email lands.
 *
 * Defense-in-depth: an email only acts as an authorization fact when
 * the user actually holds an IdP-verified identity for it. Even if a caller
 * passes a `userId`/`email` pair where the address was never verified (a future
 * regression, or a non-BFF writer mistakenly trusted), we redeem nothing.
 */
export function resolvePendingByEmail(
  db: DatabaseSync,
  userId: string,
  email: string,
): number {
  if (!email) return 0;
  if (!userHasVerifiedEmailMatch(db, userId, email)) return 0;
  const invites = query<{ id: string; kit_id: string; invited_by: string }>(
    db,
    `SELECT id, kit_id, invited_by FROM kit_invites
       WHERE kind = 'human' AND email = ? AND redeemed_at IS NULL
         AND (expires_at IS NULL OR expires_at >= unixepoch())`,
    email,
  );
  let count = 0;
  for (const inv of invites) {
    db.prepare(
      `INSERT INTO kit_members (kit_id, user_id, invited_by, invited_at, accepted_at)
       VALUES (?, ?, ?, unixepoch(), unixepoch())
       ON CONFLICT(kit_id, user_id) DO NOTHING`,
    ).run(inv.kit_id, userId, inv.invited_by);
    db.prepare(
      'UPDATE kit_invites SET redeemed_at = unixepoch() WHERE id = ?',
    ).run(inv.id);
    count++;
  }
  return count;
}

/** Used by /claim - keep idempotency with kit_members PK so a double-claim is harmless. */
export function resolvePendingByHandle(
  db: DatabaseSync,
  userId: string,
  handle: string,
): number {
  if (!handle) return 0;
  const invites = query<{ id: string; kit_id: string; invited_by: string }>(
    db,
    `SELECT id, kit_id, invited_by FROM kit_invites
       WHERE kind = 'human' AND handle = ? AND redeemed_at IS NULL
         AND (expires_at IS NULL OR expires_at >= unixepoch())`,
    handle,
  );
  let count = 0;
  for (const inv of invites) {
    db.prepare(
      `INSERT INTO kit_members (kit_id, user_id, invited_by, invited_at, accepted_at)
       VALUES (?, ?, ?, unixepoch(), unixepoch())
       ON CONFLICT(kit_id, user_id) DO NOTHING`,
    ).run(inv.kit_id, userId, inv.invited_by);
    db.prepare(
      'UPDATE kit_invites SET redeemed_at = unixepoch() WHERE id = ?',
    ).run(inv.id);
    count++;
  }
  return count;
}

