// Brand-handle claim eligibility (seed publish).
//
// This module is the home of the brand-claim eligibility *predicate*: the
// decision of whether a given principal may claim a reserved or mirror handle.
// There are TWO eligibility sources that feed the same freeze mechanism, and
// they form a primary/fallback seam:
//
//   1. GitHub-verified (PRIMARY) — a brand maintainer proves, from their own
//      `read:org` token, that they are a GitHub org owner of, or repo admin on,
//      the mirror's source. That proof is verified in the web BFF and consumed
//      by a server-to-server registry endpoint (added in U5); it does NOT flow
//      through this predicate or the browser `/api/v1/claim` path. This is the
//      self-serve oracle for brands whose source is a checkable GitHub org/repo.
//
//   2. Env allowlist (FALLBACK) — reserved handles like `skillet` stay blocked
//      for the public, but ops can grant a verified email a one-time claim via
//      SKILLET_BRAND_CLAIM_ALLOWLIST before the brand account is locked in. This
//      remains valid for brands whose source isn't a checkable GitHub org (e.g.
//      SAML-enforced orgs that surface as INDETERMINATE), so it is intentionally
//      preserved as a fallback claim path (origin R5), not removed.
//
// Invariants both paths preserve: the global-uniqueness guard (`handleOrSlugTaken`)
// and the claim-scope gate (`requireScope('claim')`) live in the `/api/v1/claim`
// route and the U5 server-to-server endpoint, NOT here. The predicates below fail
// closed: they grant ONLY on an explicit positive match, never on the mere
// absence of a denial.

import type { DatabaseSync } from '../db/sqlite-handle.js'
import { isReservedHandle } from '@skillet/protocol';
import { userHasVerifiedEmailMatch } from './identities.js';

/** handle → set of verified emails allowed to claim that reserved handle. */
export type BrandClaimAllowlist = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Parse `SKILLET_BRAND_CLAIM_ALLOWLIST=skillet:ops@skillet.md,skillet:you@co.com`.
 * Entries are `handle:email` (lowercased). Malformed segments are skipped.
 */
export function parseBrandClaimAllowlist(raw: string | undefined): BrandClaimAllowlist {
  const map = new Map<string, Set<string>>();
  if (!raw?.trim()) return map;

  for (const segment of raw.split(',')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0 || colon === trimmed.length - 1) continue;
    const handle = trimmed.slice(0, colon).trim().toLowerCase();
    const email = trimmed.slice(colon + 1).trim().toLowerCase();
    if (!handle || !email.includes('@')) continue;
    let emails = map.get(handle);
    if (!emails) {
      emails = new Set<string>();
      map.set(handle, emails);
    }
    emails.add(email);
  }
  return map;
}

/** Reserved handles this user may claim per the allowlist and verified email rows. */
export function brandClaimEligibleHandles(
  db: DatabaseSync,
  userId: string,
  allowlist: BrandClaimAllowlist,
): string[] {
  if (allowlist.size === 0) return [];

  const eligible: string[] = [];
  for (const [handle, emails] of allowlist) {
    if (!isReservedHandle(handle)) continue;
    for (const email of emails) {
      if (userHasVerifiedEmailMatch(db, userId, email)) {
        eligible.push(handle);
        break;
      }
    }
  }
  return eligible.sort();
}

/**
 * True when a reserved handle may be claimed: idempotent re-claim, or allowlisted
 * verified email and handle not already taken by another user.
 */
export function mayClaimReservedHandle(
  db: DatabaseSync,
  userId: string,
  handle: string,
  currentHandle: string | null,
  allowlist: BrandClaimAllowlist,
): boolean {
  if (!isReservedHandle(handle)) return true;
  if (currentHandle === handle) return true;

  const allowedEmails = allowlist.get(handle);
  if (!allowedEmails || allowedEmails.size === 0) return false;

  for (const email of allowedEmails) {
    if (userHasVerifiedEmailMatch(db, userId, email)) return true;
  }
  return false;
}

/**
 * True when a MIRROR handle may be claimed via the env-allowlist FALLBACK path.
 * Mirror handles (e.g. `@cloudflare`, seeded from a public repo) aren't in the
 * reserved set, but must NOT be grabbable by a random user — only by the real
 * brand. The GitHub-verified path is the primary oracle and bypasses this
 * predicate via the server-to-server endpoint; this predicate is the verified-email
 * allowlist fallback for brands whose source isn't a checkable GitHub org (R5).
 * Idempotent re-claim by the current owner is always allowed.
 *
 * Fails closed: returns true ONLY on an explicit allowlisted verified-email match
 * (or self re-claim), never on the absence of an entry.
 */
export function mayClaimMirrorHandle(
  db: DatabaseSync,
  userId: string,
  handle: string,
  currentHandle: string | null,
  allowlist: BrandClaimAllowlist,
): boolean {
  if (currentHandle === handle) return true;
  const allowedEmails = allowlist.get(handle);
  if (!allowedEmails || allowedEmails.size === 0) return false;
  for (const email of allowedEmails) {
    if (userHasVerifiedEmailMatch(db, userId, email)) return true;
  }
  return false;
}
