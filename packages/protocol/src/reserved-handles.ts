// Reserved handles — usernames that cannot be claimed.
//
// Single source of truth shared by the registry claim gate (authoritative) and
// the web client (inline UX). Two reasons a name is reserved:
//   1. Impersonation / trust — brand, official, and authority-sounding names a
//      bad actor could use to phish ("official", "support", "skillet-team").
//   2. Namespace safety — words that collide with current or likely future
//      top-level web routes and system identities, so a handle can never
//      shadow `/settings`, `/api`, `noreply@…`, etc.
//
// Matching is exact and case-insensitive against the normalized handle (handles
// are already lowercase alphanumeric + hyphen per HANDLE_RE). This mirrors how
// GitHub/GitLab/etc. reserve names: predictable, no fuzzy matching. Profanity
// filtering is intentionally NOT in scope here — that is a separate concern with
// different tradeoffs (locale, false positives) and can be layered on later.
//
// ONE narrow exception to exact-match: brand-prefixed authority
// compounds. Exact-match only catches bare tokens, so `skillet-support`,
// `skillet-team`, `skilletsecurity`, etc. all slipped through —
// a real phishing vector (register `skillet-support`, DM users as staff). We
// reserve `<brand>` + optional `-` + `<authority term>` for the brand set
// (`skillet`) crossed with a CURATED authority-term set. This is
// deliberately a curated list, not a blanket `^skillet-?` reject: a blanket
// rule would also block legitimate community handles like `skillet-fan`, which
// must stay claimable. So `skillet-fan` passes; `skillet-support` does not.

/**
 * Lowercase reserved handles. Grouped only for readability — membership is a
 * flat set. Keep additions lowercase and hyphen/space free (a handle is a
 * single token under HANDLE_RE).
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set<string>([
  // --- Brand / product ---
  'skillet',
  'skillethq',
  'skilletofficial',
  'dot',
  'dotfan',

  // --- Authority / impersonation ---
  'official',
  'verified',
  'admin',
  'administrator',
  'admins',
  'superuser',
  'root',
  'sysadmin',
  'moderator',
  'mod',
  'mods',
  'staff',
  'team',
  'teams',
  'owner',
  'support',
  'helpdesk',
  'help',
  'security',
  'trust',
  'safety',
  'abuse',
  'legal',
  'billing',
  'payments',
  'sales',
  'press',
  'marketing',
  'info',
  'contact',

  // --- Mail / system identities ---
  'noreply',
  'no-reply',
  'donotreply',
  'postmaster',
  'webmaster',
  'hostmaster',
  'mailer-daemon',
  'daemon',
  'system',
  'bot',
  'robot',

  // --- Generic user/identity placeholders ---
  'user',
  'users',
  'username',
  'account',
  'accounts',
  'me',
  'myself',
  'you',
  'self',
  'anonymous',
  'anon',
  'guest',
  'nobody',
  'everyone',
  'all',
  'null',
  'undefined',
  'none',
  'unknown',

  // --- Web routes / reserved namespace ---
  'api',
  'app',
  'apps',
  'www',
  'web',
  'mail',
  'email',
  'cdn',
  'assets',
  'static',
  'media',
  'images',
  'img',
  'files',
  'download',
  'downloads',
  'upload',
  'uploads',
  'auth',
  'oauth',
  'login',
  'logout',
  'signin',
  'signout',
  'signup',
  'register',
  'verify',
  'verification',
  'confirm',
  'reset',
  'password',
  'token',
  'tokens',
  'key',
  'keys',
  'session',
  'settings',
  'setting',
  // `/create` is a live web route AND the first-token verb the bundled router
  // dispatches on (`/skillet create`). A claimable `@create` would make that
  // invocation ambiguous between the playbook and a person's kit.
  'create',
  'profile',
  'profiles',
  'author',
  'authors',
  'dashboard',
  'home',
  'explore',
  'search',
  'discover',
  'studio',
  'skill',
  'skills',
  'install',
  'installs',
  'kit',
  'kits',
  'org',
  'orgs',
  'organization',
  'organizations',
  'enterprise',
  'team-settings',
  'docs',
  'doc',
  'documentation',
  'blog',
  'news',
  'status',
  'health',
  'pricing',
  'plans',
  'about',
  'terms',
  'tos',
  'privacy',
  'policy',
  'legal-notice',
  'faq',
  'contact-us',
  'careers',
  'jobs',

  // --- Environments / infra ---
  'dev',
  'test',
  'testing',
  'staging',
  'stage',
  'prod',
  'production',
  'demo',
  'sandbox',
  'beta',
  'alpha',
  'internal',
  'localhost',
  'example',
]);

/**
 * Brand prefixes whose authority-compounds are reserved. Bare brand
 * tokens (`skillet`) are already in RESERVED_HANDLES; this set drives
 * the compound rule below.
 */
export const BRAND_PREFIXES: readonly string[] = ['skillet'];

/**
 * Authority / staff-impersonation terms that, when suffixed onto a brand prefix
 * (with or without a hyphen), produce a reserved handle. Curated on purpose:
 * each term here reads as official Skillet staff or a trust function, so
 * `skillet-<term>` is a phishing handle, never legitimate community fandom.
 * Community-flavored suffixes (`fan`, `lover`, `ville`, …) are intentionally
 * absent so handles like `skillet-fan` stay claimable.
 */
export const BRAND_AUTHORITY_TERMS: ReadonlySet<string> = new Set<string>([
  'official',
  'verified',
  'admin',
  'admins',
  'administrator',
  'superuser',
  'root',
  'sysadmin',
  'moderator',
  'mod',
  'mods',
  'staff',
  'team',
  'teams',
  'owner',
  'support',
  'helpdesk',
  'help',
  'security',
  'trust',
  'safety',
  'abuse',
  'legal',
  'billing',
  'payments',
  'sales',
  'press',
  'info',
  'contact',
  'bot',
  'hq',
]);

/**
 * True when `h` (already normalized) is a brand prefix followed — optionally via
 * hyphens — by a curated authority term. Catches `skillet-support`,
 * `skilletsupport`, `skillet--support`, and `skillet-support-team`.
 * Returns false for `skillet-fan` and bare `skillet`.
 */
function fusedAuthorityTermsCover(rest: string): boolean {
  if (rest.length === 0 || BRAND_AUTHORITY_TERMS.has(rest)) return false;
  const terms = [...BRAND_AUTHORITY_TERMS].sort((a, b) => b.length - a.length);

  function segmentCount(rem: string): number {
    if (rem.length === 0) return 0;
    for (const term of terms) {
      if (!rem.startsWith(term)) continue;
      const next = segmentCount(rem.slice(term.length));
      if (next >= 0) return 1 + next;
    }
    return -1;
  }

  return segmentCount(rest) >= 2;
}

function isReservedBrandCompound(h: string): boolean {
  for (const brand of BRAND_PREFIXES) {
    if (!h.startsWith(brand)) continue;
    let rest = h.slice(brand.length);
    if (rest.length === 0) continue; // bare brand → handled by RESERVED_HANDLES

    // Fused suffix (no hyphens): whole remainder must be an authority term, or a
    // concatenation of two or more authority terms (e.g. skilletadminsupport).
    if (!rest.includes('-')) {
      if (BRAND_AUTHORITY_TERMS.has(rest)) return true;
      if (fusedAuthorityTermsCover(rest)) return true;
      continue;
    }

    // Hyphenated suffix: strip repeated leading separators, then flag
    // when any segment is a curated authority term.
    rest = rest.replace(/^-+/, '');
    if (rest.length === 0) continue;
    for (const segment of rest.split('-')) {
      if (segment.length > 0 && BRAND_AUTHORITY_TERMS.has(segment)) return true;
    }
  }
  return false;
}

/** True if `handle` is reserved and may not be claimed. Case-insensitive. */
export function isReservedHandle(handle: string): boolean {
  const h = handle.trim().toLowerCase();
  return RESERVED_HANDLES.has(h) || isReservedBrandCompound(h);
}
