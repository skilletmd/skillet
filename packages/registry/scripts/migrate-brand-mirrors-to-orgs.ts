import type { DatabaseSync } from '../src/db/sqlite-handle.js'
/**
 * Migrate existing org-source mirrors author → org, IN PLACE.
 *
 * One-time, idempotent, RE-RUNNABLE converter. For each unclaimed mirror author
 * (is_mirror=1 AND mirror_claimed_at IS NULL) whose GitHub source owner is an
 * Organization, create a Skillet org in place — slug = the existing handle,
 * preserving handle / skills / mirror_source_url — but leave it UNCLAIMED and
 * claimable: NO owner_user_id, NO organization_members owner row, and
 * mirror_claimed_at stays NULL so the real GitHub admin can still claim it.
 * Personal-repo (User) mirrors are left as user authors.
 *
 *   cd packages/registry
 *   REGISTRY_DB_PATH=./registry.db npx tsx scripts/migrate-brand-mirrors-to-orgs.ts
 *   ... --dry-run
 *
 * Owner type/id needs a GitHub lookup, so this lives as a script (migrations
 * must not do network I/O); migration 037 owns the schema (nullable
 * owner_user_id + organizations.source_owner_id).
 *
 * RESUMABLE failure handling: a GitHub lookup failure (deleted / transferred /
 * rate-limited) or a slug already taken by a user handle is SKIP-AND-RECORD, not
 * abort — a partial run leaves no half-converted row, and the next run picks up
 * the skipped handles. Idempotent: a handle that already has an organizations
 * row is skipped.
 *
 * NOTE: this deliberately does NOT call grantBrandOrg (lib/brand-grant.ts) — that
 * stamps mirror_claimed_at and adds an owner member, which is exactly the claimed
 * end-state we must NOT produce here.
 */
import { pathToFileURL } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { newId } from '../src/db/index.js'
import { runTransaction } from '../tests/legacy-sqlite-db-helpers.js'
import { query } from '../tests/legacy-sqlite-query.js'
import { ensureOrgAuthorRow, getOrgBySlug, handleOrSlugTaken } from '../src/lib/org-access.js'
import { parseMirrorOwnerLogin } from '../src/lib/brand-grant.js'
import { throwSqliteCliRetired } from '../src/db/cli-store-retired.js'

export interface OwnerInfo {
  type: 'Organization' | 'User'
  id: number
  login: string
}

export interface ConvertOptions {
  dryRun?: boolean
  /** GitHub token for higher rate limits (optional for public lookups). */
  token?: string
  /** Injectable fetch for tests (mirrors sync-repo.ts). */
  fetchImpl?: typeof fetch
}

export interface ConvertResult {
  /** Handles converted to (unclaimed) orgs. */
  converted: string[]
  /** User-owned source → left as a user author, no org row. */
  leftAsUser: string[]
  /** Idempotent skip: an organizations row already exists for the handle. */
  alreadyOrg: string[]
  /** Slug collides with an existing user handle (handleOrSlugTaken) → recorded. */
  slugTaken: string[]
  /** Owner lookup failed (deleted/transferred/rate-limited/unparseable) → recorded. */
  lookupFailed: string[]
  dryRun: boolean
}

interface MirrorAuthorRow {
  id: string
  name: string | null
  mirror_source_url: string | null
}

/**
 * Parse the GitHub owner login from a stored mirror_source_url (lowercased).
 * Aliased to the registry's canonical parser so the seed-time (here) and
 * claim-time (brand-grant.parseMirrorOwnerLogin) derivations are ONE function,
 * not two copies kept in sync by a comment.
 */
export const parseOwner = parseMirrorOwnerLogin

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'skillet-mirror-migrate',
    'x-github-api-version': '2022-11-28',
  }
  if (token) h.authorization = `Bearer ${token}`
  return h
}

/** Resolve a GitHub owner's account type + numeric id. Throws on any non-200. */
async function lookupOwner(login: string, opts: ConvertOptions): Promise<OwnerInfo> {
  const f = opts.fetchImpl ?? globalThis.fetch
  const res = await f(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: ghHeaders(opts.token),
  })
  if (!res.ok) {
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('GitHub rate limit reached')
    }
    throw new Error(`GitHub /users/${login} → HTTP ${res.status}`)
  }
  const body = (await res.json()) as { type?: string; id?: number; login?: string }
  if ((body.type !== 'Organization' && body.type !== 'User') || typeof body.id !== 'number') {
    throw new Error(`GitHub /users/${login}: unexpected owner shape`)
  }
  return { type: body.type, id: body.id, login: body.login ?? login }
}

/**
 * Insert an UNCLAIMED org for a mirror, preserving the existing author row.
 * No owner_user_id, no organization_members owner row, no mirror_claimed_at —
 * the brand stays claimable. `source_owner_id` captures the GitHub numeric id
 * for the KTD9 transfer-detection re-bind guard.
 */
function insertUnclaimedOrg(
  db: DatabaseSync,
  handle: string,
  name: string,
  sourceOwnerId: number,
): void {
  const orgId = newId()
  runTransaction(db, () => {
    db.prepare(
      `INSERT INTO organizations (id, slug, name, owner_user_id, source_owner_id)
       VALUES (?, ?, ?, NULL, ?)`,
    ).run(orgId, handle, name, sourceOwnerId)
    // No-op: the mirror's authors row already exists; keep org/author in lockstep.
    ensureOrgAuthorRow(db, handle, name)
  })
}

/** Core converter — pure of process/argv so tests can drive it directly. */
export async function convertMirrorsToOrgs(
  db: DatabaseSync,
  opts: ConvertOptions = {},
): Promise<ConvertResult> {
  const result: ConvertResult = {
    converted: [],
    leftAsUser: [],
    alreadyOrg: [],
    slugTaken: [],
    lookupFailed: [],
    dryRun: !!opts.dryRun,
  }

  const mirrors = query<MirrorAuthorRow>(
    db,
    `SELECT id, name, mirror_source_url FROM authors
       WHERE is_mirror = 1 AND mirror_claimed_at IS NULL
       ORDER BY id`,
  )

  for (const m of mirrors) {
    const handle = m.id

    // Idempotent: a handle already converted to an org is skipped.
    if (getOrgBySlug(db, handle)) {
      result.alreadyOrg.push(handle)
      continue
    }

    const owner = parseOwner(m.mirror_source_url)
    if (!owner) {
      result.lookupFailed.push(handle)
      continue
    }

    let info: OwnerInfo
    try {
      info = await lookupOwner(owner, opts)
    } catch {
      // Deleted / transferred / rate-limited — skip and record; next run retries.
      result.lookupFailed.push(handle)
      continue
    }

    if (info.type === 'User') {
      result.leftAsUser.push(handle)
      continue
    }

    // Organization → convert. The org row doesn't exist yet (checked above), so a
    // handleOrSlugTaken hit here means a *user* handle already owns the slug —
    // skip-and-record rather than abort the whole run.
    if (handleOrSlugTaken(db, handle)) {
      result.slugTaken.push(handle)
      continue
    }

    if (!opts.dryRun) insertUnclaimedOrg(db, handle, m.name ?? handle, info.id)
    result.converted.push(handle)
  }

  return result
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const token = process.env.SKILLET_DISCOVERY_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN
  throwSqliteCliRetired('brand-mirrors-to-orgs migrator')
}


const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) void main()
