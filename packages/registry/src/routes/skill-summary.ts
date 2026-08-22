// Shared public skill summary for the web read endpoints.
//
// The skill detail page, the author profile page, and the catalog list all
// render the same compact "skill card": who published it, its latest hash,
// install count, and whether the latest version carries a signature that
// verifies against the author's registered key. To keep ONE source of truth
// (and avoid the duplicate-module problem that sank PR #42), the row shape,
// the SELECT that produces it, and the mapping to the public JSON live here
// and are imported by both routes/skills.ts and routes/profiles.ts.

import { formatVersionLabel } from '../semver-classify.js';

/**
 * A skill's signature trust state, derived purely from data already in the
 * registry — no crypto is re-run here. `verified` means the latest version
 * was published with a signature whose key_id matches the key the author
 * registered at claim time (the same identity the §4 verify gate enforced at
 * publish). Anything else is `unverified`: unsigned legacy rows, or a skill
 * whose author has since rotated/removed their registered key.
 */
export type SignatureStatus = 'verified' | 'unverified';

/**
 * Public scan badge for the latest version.
 *
 * Mirrors the four `ScanStatus` states. `null` means no scan row exists for
 * `latest_hash` yet — a legacy version published before scanning, or a skill
 * with no published version. The web layer chooses how (or whether) to render
 * each state; the registry only reports the fact. Non-sensitive by design:
 * the status is the public trust signal, the whole point of this surface.
 */
export type ScanBadge = 'pending' | 'clean' | 'flagged' | 'quarantined';

/**
 * Admin moderation state for the skill (whole-skill, all versions) — distinct
 * from the per-version scan verdict. `unlisted` hides it from discovery but it
 * stays directly fetchable; `quarantined` blocks downloads outright (enforced
 * in serve-guards). Surfaced so the detail page can show the block instead of a
 * normal, installable page. Defaults to `none`.
 */
export type ModerationStatus = 'none' | 'unlisted' | 'quarantined';

/** Public, web-facing summary of a single skill. */
export interface SkillSummary {
  author: string;
  /**
   * The author's avatar, carried on every catalog row so a browse grid can
   * render the byline face without a per-card profile lookup. Null when the
   * author has no avatar (the client falls back to an identicon).
   */
  author_avatar_url: string | null;
  slug: string;
  skill_id: string;
  description: string | null;
  visibility: 'private' | 'public';
  latest_hash: string | null;
  /**
   * Latest version number — a bare 1-indexed count of published versions, shown
   * to users as v1, v2, … instead of a hash. 0 when nothing is published yet.
   */
  version: number;
  /**
   * Latest version's stored semver label ("major.minor.patch"), from the row at
   * `latest_hash`. Null when nothing is published yet.
   */
  version_label: string | null;
  install_count: number;
  created_at: number;
  signatureStatus: SignatureStatus;
  /** Latest-version scan badge; null when the latest version is un-scanned. */
  scanStatus: ScanBadge | null;
  /** Admin moderation state (whole-skill). `quarantined` blocks downloads. */
  moderationStatus: ModerationStatus;
  /** Auto-assigned browse category (taxonomy key); null when private or unclassified. */
  category: string | null;
  /**
   * Whether the owner has unlisted (deprecated) this skill. Only ever `true` on
   * an owner/manager-authenticated summary — the public list filters deprecated
   * skills out entirely. Lets the owner's profile badge and sort them.
   */
  deprecated: boolean;
}

/** Joined row shape produced by {@link SKILL_SUMMARY_SELECT}. */
export interface SkillSummaryRow {
  author_id: string;
  /** `authors.avatar_url` for `author_id`; null when the author has none. */
  author_avatar_url?: string | null;
  slug: string;
  skill_id: string;
  description: string | null;
  visibility: 'private' | 'public';
  latest_hash: string | null;
  version: number;
  latest_major: number | null;
  latest_minor: number | null;
  latest_patch: number | null;
  install_count: number;
  created_at: number;
  signature_b64: string | null;
  signature_key_id: string | null;
  registered_key_id: string | null;
  scan_status: string | null;
  moderation_status: string | null;
  category: string | null;
  /**
   * `deprecated_at` epoch, or null. Optional on the row: only owner-scoped
   * callers (the author profile) select it; everyone else leaves it undefined,
   * which maps to `deprecated: false`.
   */
  deprecated_at?: number | null;
}

/**
 * Canonical SELECT for a public skill summary. Callers append their own
 * `WHERE` / `ORDER BY` / `LIMIT` clause. Joining the latest version (by
 * `latest_hash`) and the author's registered key in one shot lets us derive
 * `signatureStatus` without a second round-trip per skill.
 */
export const SKILL_SUMMARY_SELECT = `
  SELECT s.author_id            AS author_id,
         a.avatar_url           AS author_avatar_url,
         s.slug                 AS slug,
         s.id                   AS skill_id,
         s.description          AS description,
         s.visibility           AS visibility,
         s.latest_hash          AS latest_hash,
         (SELECT COUNT(*) FROM skill_versions sv2 WHERE sv2.skill_id = s.id) AS version,
         sv.major               AS latest_major,
         sv.minor               AS latest_minor,
         sv.patch               AS latest_patch,
         s.install_count        AS install_count,
         s.created_at           AS created_at,
         s.category             AS category,
         sv.signature_b64       AS signature_b64,
         sv.signature_key_id    AS signature_key_id,
         u.author_key_id        AS registered_key_id,
         svs.status             AS scan_status,
         s.moderation_status    AS moderation_status
  FROM skills s
  LEFT JOIN skill_versions sv ON sv.skill_id = s.id AND sv.hash = s.latest_hash
  LEFT JOIN users u ON u.handle = s.author_id
  LEFT JOIN authors a ON a.id = s.author_id
  LEFT JOIN skill_version_scans svs ON svs.skill_version_id = s.latest_hash
`;

/** Fail-closed: only a key_id that matches the registered key is `verified`. */
export function signatureStatusOf(row: SkillSummaryRow): SignatureStatus {
  if (
    row.signature_b64 &&
    row.signature_key_id &&
    row.registered_key_id &&
    row.signature_key_id === row.registered_key_id
  ) {
    return 'verified';
  }
  return 'unverified';
}

/** Narrow a raw `scan_status` column to a known badge, or null. */
export function scanBadgeOf(row: SkillSummaryRow): ScanBadge | null {
  switch (row.scan_status) {
    case 'pending':
    case 'clean':
    case 'flagged':
    case 'quarantined':
      return row.scan_status;
    default:
      return null;
  }
}

/** Narrow a raw `moderation_status` column to a known state; default `none`. */
export function moderationOf(row: SkillSummaryRow): ModerationStatus {
  switch (row.moderation_status) {
    case 'unlisted':
    case 'quarantined':
      return row.moderation_status;
    default:
      return 'none';
  }
}

/** Map a joined DB row to the public summary JSON. */
export function toSkillSummary(row: SkillSummaryRow): SkillSummary {
  return {
    author: row.author_id,
    author_avatar_url: row.author_avatar_url ?? null,
    slug: row.slug,
    skill_id: row.skill_id,
    description: row.description,
    visibility: row.visibility === 'public' ? 'public' : 'private',
    latest_hash: row.latest_hash,
    version: row.version ?? 0,
    version_label:
      row.latest_major != null && row.latest_minor != null && row.latest_patch != null
        ? formatVersionLabel({
            major: row.latest_major,
            minor: row.latest_minor,
            patch: row.latest_patch,
          })
        : null,
    install_count: row.install_count,
    created_at: row.created_at,
    signatureStatus: signatureStatusOf(row),
    scanStatus: scanBadgeOf(row),
    moderationStatus: moderationOf(row),
    category: row.category ?? null,
    deprecated: row.deprecated_at != null,
  };
}
