// Reserved skill slugs — slugs a skill may NOT use because they collide with a
// static route segment that lives directly under the owner namespace
// (`/{owner}/...`). Skills render at `/{owner}/{slug}`, a dynamic segment that
// sits as a sibling of these static segments. Next.js resolves the static
// segment first, so a skill slugged `kit` would publish successfully yet be
// permanently unreachable — the URL would always render the kit page instead.
// We reject such slugs at publish time so the failure is loud, not silent.
//
// HARD COUPLING: this set MUST equal the static child route segments of
// `packages/web/src/app/(consumer)/[author]/`. Today those are `kit`,
// `followers`, `following`, `installs`, and `summon`. If a new static
// `[author]/<segment>` route is added, add `<segment>` here too (and cover it in
// the permalink-routing test).
//
// This is distinct from RESERVED_HANDLES, which guards TOP-LEVEL handles
// (`/{handle}`). This set guards per-owner skill slugs one level down.

/** Lowercase reserved skill slugs. Membership is exact, case-insensitive. */
export const RESERVED_SKILL_SLUGS: ReadonlySet<string> = new Set<string>([
  'kit',
  'followers',
  'following',
  'installs',
  // The zero-install summon endpoint: an agent handed `skillet.md/@handle/summon`
  // gets the handle's routable candidate list without anything on disk.
  'summon',
])

/** Protocol grammar for skill slugs (matches core `parseSkillRef`). */
export const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/** True when `slug` matches the canonical skill slug grammar. */
export function isValidSkillSlug(slug: string): boolean {
  return SKILL_SLUG_RE.test(slug)
}

/** True when `slug` collides with a static owner-namespace route segment. */
export function isReservedSkillSlug(slug: string): boolean {
  return RESERVED_SKILL_SLUGS.has(slug.trim().toLowerCase())
}
