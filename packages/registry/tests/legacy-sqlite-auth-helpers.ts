// Quarantined sqlite auth helpers for characterization under tests/ (U2).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import type { Principal, ClientIdentityHeaders } from '../src/auth/middleware.js'
import { classifyToken, hashToken, parseBearer, scopesFor } from '../src/auth/tokens.js'
import { asHandle, asUserId } from '../src/auth/identity.js'
import {
  normalizeClientKind,
  normalizeMachineId,
  parseStoredKinds,
  STALE_SIBLING_SEC,
} from '../src/auth/client-identity.js'
import { query, queryOne } from './legacy-sqlite-query.js'
import { newId } from '../src/db/index.js'
import { runTransaction } from './legacy-sqlite-db-helpers.js'
import { canAccessOrgAuthor, handleOrSlugTaken } from './legacy-sqlite-org-access.js'
import { parseAdminHandles, parseAdminUserIds } from '../src/auth/admin.js'
import type {
  WebIdentityInput,
  MintedUserSession,
  IdentityProvider,
} from '../src/auth/identities.js'

function parseKinds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : []
  } catch {
    return []
  }
}

/**
 * Fold `loserId` into `winnerId` within the CALLER's transaction, then delete
 * the loser row. Carries materializations (newer reported_at wins), skill edits
 * (winner wins on conflict), and client_kinds (additive), then revokes loser
 * sessions and deletes the loser. Does not open its own transaction.
 */
export function mergeDeviceInto(db: DatabaseSync, winnerId: string, loserId: string): void {
  // Materializations: move the loser's rows onto the winner, keeping the newer
  // reported_at on any (skill, runtime) both rows have. The WHERE on the upsert
  // makes the conflict a no-op when the winner's row is already newer.
  db.prepare(
    `INSERT INTO device_skill_materializations (device_id, skill_slug, runtime, status, reported_at)
       SELECT ?, skill_slug, runtime, status, reported_at
         FROM device_skill_materializations WHERE device_id = ?
     ON CONFLICT(device_id, skill_slug, runtime)
       DO UPDATE SET status = excluded.status, reported_at = excluded.reported_at
       WHERE excluded.reported_at > device_skill_materializations.reported_at`,
  ).run(winnerId, loserId)
  db.prepare('DELETE FROM device_skill_materializations WHERE device_id = ?').run(loserId)

  // Skill edits: reassign to the winner; OR IGNORE skips any skill_id the winner
  // already edited (UNIQUE conflict), leaving that loser row to CASCADE away.
  db.prepare('UPDATE OR IGNORE device_skill_edits SET device_id = ? WHERE device_id = ?').run(
    winnerId,
    loserId,
  )

  // Union the loser's kinds onto the winner.
  const loser = db.prepare('SELECT client_kinds FROM devices WHERE id = ?').get(loserId) as
    | { client_kinds: string | null }
    | undefined
  if (loser) {
    for (const kind of parseKinds(loser.client_kinds)) {
      db.prepare(
        `UPDATE devices SET client_kinds = CASE
           WHEN client_kinds IS NULL THEN json_array(?)
           WHEN EXISTS (SELECT 1 FROM json_each(client_kinds) WHERE value = ?) THEN client_kinds
           ELSE json_insert(client_kinds, '$[#]', ?)
         END
         WHERE id = ?`,
      ).run(kind, kind, kind, winnerId)
    }
  }

  // Revoke the loser's sessions, then delete the row (its remaining
  // device_skill_edits and device_kit_excludes CASCADE here).
  db.prepare(
    'UPDATE sessions SET revoked_at = unixepoch() WHERE device_id = ? AND revoked_at IS NULL',
  ).run(loserId)
  db.prepare('DELETE FROM devices WHERE id = ?').run(loserId)
}

/**
 * Single ACL predicate for skill reads (manifest, version bytes, sync/content).
 * Public skills are readable by anyone; private skills require a live grant.
 */
export function canReadSkill(
  db: DatabaseSync,
  principal: Principal | null | undefined,
  skillId: string,
  visibility: string,
): boolean {
  if (visibility === 'public') return true
  if (!principal) return false

  if (principal.class === 'kit') {
    const row = queryOne<{ ok: number }>(
      db,
      'SELECT 1 AS ok FROM kit_skills WHERE kit_id = ? AND skill_id = ?',
      principal.kit_id,
      skillId,
    )
    return !!row
  }

  const userId = principal.user_id
  if (!userId) return false

  const isAuthor = queryOne<{ ok: number }>(
    db,
    `SELECT 1 AS ok FROM skills s
       JOIN users u ON u.handle = s.author_id
       WHERE s.id = ? AND u.id = ?`,
    skillId,
    userId,
  )
  if (isAuthor) return true

  const ownerOrMember = queryOne<{ ok: number }>(
    db,
    `SELECT 1 AS ok
         FROM kit_skills ks
         JOIN kits k ON k.id = ks.kit_id
         LEFT JOIN users owner_u ON owner_u.handle = k.owner_id
         LEFT JOIN kit_members km ON km.kit_id = k.id AND km.user_id = ?
        WHERE ks.skill_id = ?
          AND (owner_u.id = ? OR km.user_id IS NOT NULL)
        LIMIT 1`,
    userId,
    skillId,
    userId,
  )
  if (ownerOrMember) return true

  const skillAuthor = queryOne<{ author_id: string }>(
    db,
    'SELECT author_id FROM skills WHERE id = ?',
    skillId,
  )
  if (skillAuthor && canAccessOrgAuthor(db, skillAuthor.author_id, userId)) {
    return true
  }

  const subscribedKit = queryOne<{ ok: number }>(
    db,
    `SELECT 1 AS ok
         FROM kit_subscriptions sub
         JOIN kit_skills ks ON ks.kit_id = sub.kit_id
        WHERE sub.user_id = ? AND sub.kind = 'kit' AND ks.skill_id = ?
        LIMIT 1`,
    userId,
    skillId,
  )
  if (subscribedKit) return true

  return false
}

function isAdminFromRow(
  row: { is_admin: number; handle: string | null } | null | undefined,
): boolean {
  if (!row) return false;
  if (row.is_admin === 1) return true;

  if (row.handle) {
    const allow = parseAdminHandles(process.env.SKILLET_ADMIN_HANDLES);
    if (allow.has(row.handle.toLowerCase())) return true;
  }
  return false;
}

/** True when the user is a platform admin (DB flag or env allowlist). */
export function isAdminUser(db: DatabaseSync, userId: string): boolean {
  const allowIds = parseAdminUserIds(process.env.SKILLET_ADMIN_USER_IDS);
  if (allowIds.has(userId)) return true;

  const row = queryOne<{ is_admin: number; handle: string | null }>(
    db,
    'SELECT is_admin, handle FROM users WHERE id = ?',
    userId,
  );
  return isAdminFromRow(row);
}

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;

/** Providers whose IdP-verified email proves control of that specific address,
 *  so it's safe to auto-link an unseen sign-in onto a matching account. See the
 *  auto-link block in upsertIdentityUser for why github/twitter are excluded. */
const AUTO_LINK_PROVIDERS = new Set<IdentityProvider>(['google', 'email']);

export function userLinkedProviders(
  db: DatabaseSync,
  userId: string,
): IdentityProvider[] {
  const rows = query<{ provider: IdentityProvider }>(
    db,
    `SELECT provider FROM user_identities WHERE user_id = ? ORDER BY provider`,
    userId,
  );
  return rows.map((r) => r.provider);
}

export function userPrimaryEmail(db: DatabaseSync, userId: string): string | null {
  const row = queryOne<{ email: string }>(
    db,
    `SELECT email FROM user_identities
       WHERE user_id = ? AND email IS NOT NULL AND email != ''
       ORDER BY
         email_verified DESC,
         CASE provider
           WHEN 'email' THEN 0
           WHEN 'google' THEN 1
           WHEN 'github' THEN 2
           WHEN 'twitter' THEN 3
           ELSE 4
         END,
         created_at DESC
       LIMIT 1`,
    userId,
  );
  return row?.email ?? null;
}

/**
 * Defense-in-depth: the user holds an identity whose email the IdP
 * verified AND that email matches `email` (case-insensitive). This is the
 * column-level check email-keyed invite acceptance must pass before it trusts
 * an email string as an authorization fact — so a planted-but-unverified email
 * row (email_verified = 0) can never satisfy an invite addressed to a victim,
 * even if a future writer regresses and lets the string be set.
 *
 * Fail-closed: a missing/blank email, no matching row, or email_verified = 0
 * all return false.
 */
export function userHasVerifiedEmailMatch(
  db: DatabaseSync,
  userId: string,
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const row = queryOne<{ ok: number }>(
    db,
    `SELECT 1 AS ok FROM user_identities
       WHERE user_id = ?
         AND email IS NOT NULL
         AND email_verified = 1
         AND lower(email) = lower(?)
       LIMIT 1`,
    userId,
    email,
  );
  return row?.ok === 1;
}

/**
 * The single user who has already PROVEN control of `email` (an IdP-verified
 * identity row for it). Used to auto-link a new sign-in to an existing account
 * instead of forking a duplicate — e.g. signing in with Google for an address
 * that already has a verified magic-link account.
 *
 * Fail-closed and unambiguous: returns null unless EXACTLY ONE account owns the
 * verified email. Zero matches → caller mints a fresh account; more than one (a
 * pre-existing fork) → we refuse to guess which is canonical and mint fresh
 * rather than risk merging into the wrong account. Caller must independently
 * confirm the INCOMING identity's email is verified before trusting this.
 */
export function userIdByVerifiedEmail(
  db: DatabaseSync,
  email: string | null | undefined,
): string | null {
  if (!email) return null;
  const rows = query<{ user_id: string }>(
    db,
    `SELECT DISTINCT user_id FROM user_identities
       WHERE email IS NOT NULL
         AND email_verified = 1
         AND lower(email) = lower(?)
       LIMIT 2`,
    email,
  );
  return rows.length === 1 ? rows[0].user_id : null;
}

/**
 * Upsert a provider identity and return the owning user row.
 * When linking to an existing session user, pass linkToUserId.
 */
export function upsertIdentityUser(
  db: DatabaseSync,
  input: WebIdentityInput,
  linkToUserId?: string,
): MintedUserSession {
  const existingIdentity = queryOne<{ user_id: string }>(
    db,
    `SELECT user_id FROM user_identities
       WHERE provider = ? AND provider_subject_id = ?`,
    input.provider,
    input.provider_subject_id,
  );

  let userId = existingIdentity?.user_id ?? linkToUserId;

  // Verified-email auto-link: before forking a new account for an unseen
  // identity, attach it to an existing user who already proved control of this
  // same email. Both sides must be IdP-verified — the incoming identity
  // (identityEmailVerified) AND the matched account (email_verified = 1 inside
  // userIdByVerifiedEmail) — so an unverified email can never claim someone
  // else's account. This is what stops the email/Google duplicate-account trap.
  //
  // Restricted to providers whose IdP email is genuine per-address proof of
  // control: magic-link (we verify it) and Google (real email_verified
  // passthrough). GitHub's verified flag is hard-coded true regardless of which
  // email is attached, and X marks verified on mere presence — trusting either
  // here would let a crafted sign-in merge into someone else's account. Those
  // two are link-only anyway (enforced in the web signIn callback), so this is
  // belt-and-suspenders, not the sole gate.
  if (!userId && AUTO_LINK_PROVIDERS.has(input.provider) && identityEmailVerified(input)) {
    userId = userIdByVerifiedEmail(db, input.email) ?? undefined;
  }

  if (!userId) {
    userId = newId();
    const handle = prefillHandle(db, input);
    const githubId = input.provider === 'github' ? input.provider_subject_id : null;
    const twoFactorInt = input.provider === 'github' && input.two_factor ? 1 : 0;

    db.prepare(
      `INSERT INTO users (id, handle, github_id, two_factor)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, handle, githubId, twoFactorInt);
  } else if (input.provider === 'github') {
    db.prepare(`UPDATE users SET github_id = ?, two_factor = ? WHERE id = ?`).run(
      input.provider_subject_id,
      input.two_factor ? 1 : 0,
      userId,
    );
  }

  // Poisoning guard: never record this identity's email as a verified address
  // that ANOTHER user already proved control of. Without it, a returning sign-in
  // whose IdP email was changed to a victim's verified address would plant a
  // verified row for that email on the attacker's account — which downstream
  // readers (userHasVerifiedEmailMatch → invite/brand-claim acceptance, and the
  // userIdByVerifiedEmail auto-link) trust as proof of control. When the incoming
  // verified email belongs to a different user, we drop the email write (bind
  // null/0 so the COALESCE/MAX upsert keeps any prior value on conflict and a new
  // row gets no email) while still writing the identity link and provider_login.
  const incomingVerified = identityEmailVerified(input);
  const ownerOfIncoming =
    input.email && incomingVerified ? userIdByVerifiedEmail(db, input.email) : null;
  const emailContested = ownerOfIncoming != null && ownerOfIncoming !== userId;

  const emailToWrite = emailContested ? null : input.email ?? null;
  const emailVerifiedInt = emailContested ? 0 : incomingVerified ? 1 : 0;

  db.prepare(
    `INSERT INTO user_identities
       (user_id, provider, provider_subject_id, email, email_verified, provider_login, display_name, avatar_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(provider, provider_subject_id) DO UPDATE SET
       email = COALESCE(excluded.email, user_identities.email),
       email_verified = MAX(user_identities.email_verified, excluded.email_verified),
       provider_login = COALESCE(excluded.provider_login, user_identities.provider_login),
       display_name = COALESCE(excluded.display_name, user_identities.display_name),
       avatar_url = COALESCE(excluded.avatar_url, user_identities.avatar_url)`,
  ).run(
    userId,
    input.provider,
    input.provider_subject_id,
    emailToWrite,
    emailVerifiedInt,
    input.login?.trim() || null,
    input.display_name?.trim() || null,
    input.avatar_url?.trim() || null,
  );

  const userRow = queryOne<{ id: string; handle: string | null; two_factor: number }>(
    db,
    `SELECT id, handle, two_factor FROM users WHERE id = ?`,
    userId,
  )!;

  applyIdpProfileToAuthor(db, userRow.handle, {
    display_name: input.display_name,
    avatar_url: input.avatar_url,
  });

  return {
    user_id: userRow.id,
    handle: userRow.handle,
    email: userPrimaryEmail(db, userRow.id),
    two_factor: userRow.two_factor === 1,
    linked_providers: userLinkedProviders(db, userRow.id),
  };
}

function identityEmailVerified(input: WebIdentityInput): boolean {
  if (input.provider === 'github') return true;
  if (input.provider === 'email') return true;
  if (input.provider === 'google' || input.provider === 'twitter') {
    return input.email_verified === true;
  }
  return false;
}

function prefillHandle(db: DatabaseSync, input: WebIdentityInput): string | null {
  if (input.provider !== 'github' || !input.login) return null;
  const normalized = input.login.toLowerCase();
  if (!HANDLE_RE.test(normalized)) return null;
  // Global uniqueness: skip the auto-assignment when the GitHub login collides
  // with an existing user handle OR an organization slug. Without the slug
  // check this path silently re-creates a handle==slug collision after the
  // one-time guard migration.
  return handleOrSlugTaken(db, normalized) ? null : normalized;
}

/**
 * Mirror IdP name/avatar onto the public authors row when the user has a handle.
 * Fill-only: hints only ever fill blanks (a missing avatar, a placeholder name
 * equal to the handle) — connecting a provider must never overwrite anything the
 * user set themselves.
 */
export function applyIdpProfileToAuthor(
  db: DatabaseSync,
  handle: string | null,
  hints: { display_name?: string | null; avatar_url?: string | null },
): void {
  if (!handle) return;

  const displayName = hints.display_name?.trim() || null;
  const avatarUrl = hints.avatar_url?.trim() || null;
  if (!displayName && !avatarUrl) return;

  const existing = queryOne<{ id: string; name: string; avatar_url: string | null }>(
    db,
    'SELECT id, name, avatar_url FROM authors WHERE id = ?',
    handle,
  );

  if (!existing) {
    db.prepare(
      `INSERT INTO authors (id, name, avatar_url) VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(handle, displayName ?? handle, avatarUrl);
    return;
  }

  const namePlaceholder = !existing.name || existing.name === handle;
  const nextName = displayName && namePlaceholder ? displayName : existing.name;
  const nextAvatar = existing.avatar_url ?? avatarUrl;

  if (nextName !== existing.name || nextAvatar !== existing.avatar_url) {
    db.prepare('UPDATE authors SET name = ?, avatar_url = ? WHERE id = ?').run(
      nextName,
      nextAvatar,
      handle,
    );
  }
}


function applyClientIdentity(
  db: DatabaseSync,
  row: DeviceRow,
  identity: ClientIdentityHeaders | undefined,
  now: number,
): void {
  const machineId = normalizeMachineId(identity?.machineId);
  const clientKind = normalizeClientKind(identity?.clientKind);
  const kinds = parseStoredKinds(row.client_kinds);

  const machineChanged = machineId != null && machineId !== row.machine_id;
  const kindMissing = clientKind != null && !kinds.includes(clientKind);
  if (!machineChanged && !kindMissing) return;

  runTransaction(db, () => {
    const mergedKinds = [...kinds];
    if (clientKind != null && !mergedKinds.includes(clientKind)) mergedKinds.push(clientKind);

    if (machineChanged && row.user_id != null) {
      // The live token's row wins a collision; stale siblings collapse into it
      // with the same cleanup inventory as pair-claim's sweep and DELETE
      // /devices (materializations + sessions explicit, excludes/edits CASCADE).
      const siblings = query<{ id: string; client_kinds: string | null; seen: number | null }>(
        db,
        `SELECT id, client_kinds, COALESCE(last_seen_at, created_at) AS seen
           FROM devices WHERE user_id = ? AND machine_id = ? AND id != ?`,
        row.user_id,
        machineId,
        row.id,
      );
      for (const sibling of siblings) {
        if (sibling.seen != null && now - sibling.seen < STALE_SIBLING_SEC) continue;
        for (const kind of parseStoredKinds(sibling.client_kinds)) {
          if (!mergedKinds.includes(kind)) mergedKinds.push(kind);
        }
        db.prepare('DELETE FROM device_skill_materializations WHERE device_id = ?').run(sibling.id);
        db.prepare(
          'UPDATE sessions SET revoked_at = unixepoch() WHERE device_id = ? AND revoked_at IS NULL',
        ).run(sibling.id);
        db.prepare('DELETE FROM devices WHERE id = ?').run(sibling.id);
      }
    }

    db.prepare('UPDATE devices SET machine_id = ?, client_kinds = ? WHERE id = ?').run(
      machineId ?? row.machine_id,
      JSON.stringify(mergedKinds),
      row.id,
    );
  });
}

/** Prisma async counterpart of {@link applyClientIdentity} (U4 wave 1). */

export function resolvePrincipal(
  db: DatabaseSync,
  authHeader: string | undefined,
  identity?: ClientIdentityHeaders,
): Principal | null {
  const token = parseBearer(authHeader);
  if (!token) return null;
  const cls = classifyToken(token);
  if (!cls) return null;
  const tokenHash = hashToken(token);
  const now = Math.floor(Date.now() / 1000);

  if (cls === 'device') {
    const row = queryOne<DeviceRow>(
      db,
      'SELECT id, user_id, machine_id, client_kinds FROM devices WHERE token_hash = ?',
      tokenHash,
    );
    if (!row) return null;
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, row.id);
    applyClientIdentity(db, row, identity, now);
    return {
      class: 'device',
      device_id: row.id,
      user_id: row.user_id == null ? null : asUserId(row.user_id),
      scopes: scopesFor('device'),
    };
  }

  if (cls === 'session') {
    const row = queryOne<SessionRow>(
      db,
      `SELECT s.id, s.user_id, s.expires_at, s.revoked_at,
                u.handle, u.two_factor
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      tokenHash,
    );
    if (!row) return null;
    if (row.revoked_at != null) return null;
    if (row.expires_at != null && row.expires_at < now) return null;
    return {
      class: 'session',
      session_id: row.id,
      user_id: asUserId(row.user_id),
      handle: row.handle == null ? null : asHandle(row.handle),
      two_factor: row.two_factor === 1,
      scopes: scopesFor('session'),
    };
  }

  if (cls === 'kit') {
    const row = queryOne<KitKeyRow>(
      db,
      'SELECT id, kit_id, expires_at, revoked_at FROM kit_keys WHERE token_hash = ?',
      tokenHash,
    );
    if (!row) return null;
    if (row.revoked_at != null) return null;
    if (row.expires_at != null && row.expires_at < now) return null;
    return {
      class: 'kit',
      kit_key_id: row.id,
      kit_id: row.kit_id,
      scopes: scopesFor('kit'),
    };
  }

  // mcp — personal MCP link. No expiry: it lives until regenerated (R8),
  // at which point revoked_at kills the old hash immediately.
  const row = queryOne<McpLinkRow>(
    db,
    'SELECT id, user_id, revoked_at FROM mcp_links WHERE token_hash = ?',
    tokenHash,
  );
  if (!row) return null;
  if (row.revoked_at != null) return null;
  db.prepare('UPDATE mcp_links SET last_used_at = ? WHERE id = ?').run(now, row.id);
  return {
    class: 'mcp',
    mcp_link_id: row.id,
    user_id: asUserId(row.user_id),
    scopes: scopesFor('mcp'),
  };
}
