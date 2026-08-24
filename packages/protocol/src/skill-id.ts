/**
 * Skill identity — the single source of truth for the three string forms a
 * skill's identity takes, every conversion between them, and the branded
 * `SkillId` type that guards the registry boundary.
 *
 * A skill has ONE canonical form per MEDIUM, and each form exists because its
 * medium forces it:
 *
 *   • **wireRef**  `@owner/slug`   — human / CLI / display, and core's local
 *     kit-state keys. Leading `@`, `/` separator. This is the npm `@scope/pkg`
 *     and GitHub `owner/repo` convention; it's what a person types and reads.
 *
 *   • **skillId**  `owner:slug`    — the registry DB primary key (`skills.id`),
 *     every Set/Map key, WHERE param, and all identity comparison. No `@`, `:`
 *     separator, so it stays URL- and path-safe (safe to interpolate into a
 *     route or an id column without escaping).
 *
 *   • **slugDir**  `owner--slug`   — the on-disk materialized directory name
 *     (`_local--slug` when unowned). `--` separator because a single directory
 *     name may not contain `/`; the filesystem forbids it.
 *
 * The bug class this module kills is a cross-form comparison that COMPILES —
 * e.g. a wireRef (`@owner/slug`) looked up in a Set keyed on skillId
 * (`owner:slug`), which silently misses instead of erroring. Route every
 * conversion through here and the forms can't drift.
 *
 * BRANDED TYPE — NEW CONVENTION. `SkillId` is a branded string
 * (`string & { readonly __brand: 'SkillId' }`). The repo has no prior branded
 * types; this module introduces the pattern. A plain `string` is NOT assignable
 * to a `SkillId` — the ONLY way to mint one is {@link toSkillId} (the sole place
 * the brand cast lives). So a raw wireRef where a `SkillId` is expected is a
 * COMPILE error, not an empty Set at runtime.
 *
 * PURE / ZERO IMPORTS. Like `./covers` and `./untrusted-href`, this module has
 * no runtime imports (no `node:*`) and is exposed only via the
 * `@skillet/protocol/skill-id` SUBPATH — never the barrel (`./index`), which
 * drags `node:crypto` and blanks a browser page. Browser and webview callers
 * import the subpath and stay off the crypto-laden barrel.
 *
 * Grammar is aligned to what the registry ACTUALLY STORES, not a stricter
 * ideal — the canonical parser must accept exactly what the system persists or
 * it throws on real DB rows. Handles match the registry's claim-gate
 * `HANDLE_RE` (`packages/registry/src/routes/auth.ts` /
 * `auth/identities.ts`): `/^[a-z0-9][a-z0-9-]{0,38}$/` — lowercase URL-safe
 * `[a-z0-9-]`, 1-39 chars, no LEADING hyphen but a TRAILING hyphen IS legal
 * (e.g. `alice-` is a claimable handle → a stored `alice-:tool` skill id).
 * Slugs match the registry's publish-time validator `SKILL_SLUG_RE`
 * (`packages/protocol/src/reserved-skill-slugs.ts`):
 * `/^[a-z0-9][a-z0-9-]{0,62}$/` — same class, 1-63 chars. Anything outside the
 * allowlist (`.`, `/`, `\`, `%`, `:`, NUL, whitespace, `..`) is rejected — the
 * grammar doubles as a path-traversal gate before an identity is ever
 * interpolated into a URL or a directory path.
 *
 * The slugDir DECODER ({@link fromSlugDir}) is deliberately looser than this
 * grammar: it decodes what `core/bundle/write.ts` `bundleSlugDir` WROTE, which
 * emits `owner--slug` / `_local--slug` without grammar-validating the slug. So
 * the decoder accepts any non-empty, non-traversal, `/`- and NUL-free part —
 * you must be able to read back every dir the encoder could have written.
 */

/**
 * The canonical registry-id form (`owner:slug`), branded so it can't be
 * confused with a raw wire ref. Mint one ONLY via {@link toSkillId}.
 *
 * NOTE: this is the repo's first branded type. `string & { __brand }` is a
 * compile-time-only marker — at runtime a `SkillId` IS just its `owner:slug`
 * string, so it prints, compares, and serializes exactly like the string it is.
 */
export type SkillId = string & { readonly __brand: 'SkillId' };

/** The three named identity forms, for callers that want to be explicit. */
export type SkillIdForm = 'wireRef' | 'skillId' | 'slugDir';

/**
 * Owner handle: MUST equal the registry's claim-gate `HANDLE_RE`
 * (`packages/registry/src/routes/auth.ts` and `auth/identities.ts`), which is
 * the gate that decides what handle can be claimed and thus what `owner` can
 * appear in a stored `skills.id`. Lowercase alnum + hyphen, 1-39, must START
 * with alnum; a TRAILING hyphen is legal (`alice-`). Being stricter than this
 * would throw on real, claimable identities.
 */
const AUTHOR_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;
/**
 * Slug: MUST equal the registry's publish-time `SKILL_SLUG_RE`
 * (`packages/protocol/src/reserved-skill-slugs.ts`). Lowercase alnum + hyphen,
 * 1-63, must start alnum.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * A slugDir part (owner or slug) is DECODABLE iff it is something
 * `bundleSlugDir` could have written to disk: non-empty, no path separator, no
 * NUL, and not a `.`/`..` traversal segment. Looser than {@link AUTHOR_RE} /
 * {@link SLUG_RE} on purpose — the encoder does not grammar-validate the slug,
 * so the decoder must not reject a dir it could have produced. Still a hard
 * traversal/NUL gate before the name is joined into a filesystem path.
 */
function isDecodableSlugPart(part: string): boolean {
  return (
    part.length > 0 &&
    part !== '.' &&
    part !== '..' &&
    !part.includes('/') &&
    !part.includes('\\') &&
    !part.includes('\0')
  );
}

/**
 * Thrown by {@link parseRef} (and the converters that build on it) when the
 * input is not a valid identity in any of the three accepted input forms.
 *
 * parseRef THROWS rather than returning null — matching the stricter existing
 * parser (`core/registry/identifier.ts`, which throws `SkillRefError`) so the
 * delegation in later units is behavior-preserving. {@link fromSlugDir}, by
 * contrast, returns `null` (matching `parseSkilletSlugDir`) because "is this a
 * skillet dir?" is a test, not a parse.
 */
export class SkillIdError extends Error {
  readonly code: 'invalid_ref' | 'invalid_owner' | 'invalid_slug';
  constructor(code: SkillIdError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'SkillIdError';
  }
}

/**
 * Parse any of the three input forms — `@owner/slug` (wireRef), `owner/slug`
 * (bare wire), or `owner:slug` (skillId) — into validated `{ owner, slug }`.
 *
 * Tolerant of the INPUT delimiter (like the registry's `refToAuthorSlug`), but
 * STRICT on the resulting owner/slug grammar (like `identifier.ts`). Strips a
 * single leading `@`, then splits on whichever of `/` or `:` appears first.
 * Throws {@link SkillIdError} on anything malformed: empty owner/slug, an
 * out-of-class character, `..`, or no delimiter at all. The validated parts are
 * safe to interpolate verbatim into a URL or a path.
 */
export function parseRef(input: string): { owner: string; slug: string } {
  if (typeof input !== 'string' || input.length === 0) {
    throw new SkillIdError('invalid_ref', 'Skill ref is empty');
  }
  // Reject whitespace / control chars up front for a clear diagnostic.
  if (/[\x00-\x20\x7f]/.test(input)) {
    throw new SkillIdError(
      'invalid_ref',
      `Skill ref ${JSON.stringify(input)} contains whitespace or control characters`,
    );
  }
  const body = input.startsWith('@') ? input.slice(1) : input;
  // Split on the first delimiter, whichever of `/` or `:` comes first.
  const slashIdx = body.indexOf('/');
  const colonIdx = body.indexOf(':');
  let idx: number;
  if (slashIdx < 0) idx = colonIdx;
  else if (colonIdx < 0) idx = slashIdx;
  else idx = Math.min(slashIdx, colonIdx);
  if (idx < 0) {
    throw new SkillIdError(
      'invalid_ref',
      `Skill ref ${JSON.stringify(input)} must look like "@owner/slug", "owner/slug", or "owner:slug"`,
    );
  }
  const owner = body.slice(0, idx);
  const slug = body.slice(idx + 1);
  if (!AUTHOR_RE.test(owner)) {
    throw new SkillIdError(
      'invalid_owner',
      `Owner ${JSON.stringify(owner)} must be 1-39 lowercase alphanumerics or hyphens, starting with an alphanumeric`,
    );
  }
  if (!SLUG_RE.test(slug)) {
    throw new SkillIdError(
      'invalid_slug',
      `Slug ${JSON.stringify(slug)} must be 1-63 lowercase alphanumerics or hyphens`,
    );
  }
  return { owner, slug };
}

/**
 * Canonicalize any input form to a branded `SkillId` (`owner:slug`).
 *
 * This is the ONLY place a plain string becomes a `SkillId` — the brand cast
 * lives here. Every registry key, Set/Map key, and WHERE param that holds an
 * identity should be produced through this function so a raw wire ref can never
 * reach it uncanonicalized.
 */
export function toSkillId(input: string): SkillId {
  const { owner, slug } = parseRef(input);
  return `${owner}:${slug}` as SkillId;
}

/**
 * Non-throwing {@link toSkillId} for UNTRUSTED boundaries: returns `null`
 * instead of throwing on a malformed input.
 *
 * Use this to canonicalize external input that reaches a request boundary — a
 * registry route param, a web `my-kits` id from a URL — where a throw would
 * become a 500 or crash the render. Trusted/internal callers should use the
 * throwing {@link toSkillId} so a programming error surfaces loudly.
 */
export function tryToSkillId(input: string): SkillId | null {
  try {
    return toSkillId(input);
  } catch {
    return null;
  }
}

/** Canonicalize any input form to the wireRef (`@owner/slug`) for CLI/display. */
export function toWireRef(input: string): string {
  const { owner, slug } = parseRef(input);
  return `@${owner}/${slug}`;
}

/**
 * Encode an identity to its on-disk slugDir (`owner--slug`).
 *
 * The `@` is stripped (parseRef already dropped it), so the dir is always the
 * clean `owner--slug` form. Unowned skills use `_local--slug`; since none of the
 * input forms can express "unowned" (every wireRef/skillId carries an owner),
 * the `_local--` form is produced by {@link toSlugDirParts} / decoded by
 * {@link fromSlugDir} rather than minted from a string here.
 */
export function toSlugDir(input: string): string {
  const { owner, slug } = parseRef(input);
  return `${owner}--${slug}`;
}

/**
 * Encode `{ owner, slug }` to a slugDir, matching `bundleSlugDir`: an unowned
 * skill (null/empty owner) becomes `_local--slug`.
 */
export function toSlugDirParts(owner: string | null | undefined, slug: string): string {
  if (owner && owner.length > 0) {
    const clean = owner.startsWith('@') ? owner.slice(1) : owner;
    if (!AUTHOR_RE.test(clean)) {
      throw new SkillIdError('invalid_owner', `unsafe owner for slug dir: ${JSON.stringify(owner)}`);
    }
    if (!SLUG_RE.test(slug)) {
      throw new SkillIdError('invalid_slug', `unsafe slug for slug dir: ${JSON.stringify(slug)}`);
    }
    return `${clean}--${slug}`;
  }
  if (!SLUG_RE.test(slug)) {
    throw new SkillIdError('invalid_slug', `unsafe slug for slug dir: ${JSON.stringify(slug)}`);
  }
  return `_local--${slug}`;
}

/**
 * Decode a slugDir back to `{ owner, slug }`, or `null` if `name` is not a
 * Skillet materialized dir. Replicates `core/bundle/write.ts`
 * `parseSkilletSlugDir` exactly:
 *
 *   • the reserved `skillet` dir → `{ owner: 'skillet', slug: 'route' }`,
 *   • `_local--slug`  → `{ owner: null, slug }` (unowned),
 *   • `@owner--slug`  → strips the leading `@`,
 *   • `owner--slug`   → `{ owner, slug }`.
 *
 * TOLERANT on decode by design: it decodes what `bundleSlugDir` WROTE, and that
 * encoder emits `owner--slug` / `_local--slug` WITHOUT grammar-validating the
 * slug — so an unpublished `_local--foo_bar` (underscore) or any looser slug is
 * a real materialized dir on disk. Validating with the strict AUTHOR_RE /
 * SLUG_RE here would return `null` for a dir the system genuinely wrote, making
 * discovery/restore skip it. Instead each part must only be a
 * {@link isDecodableSlugPart}: non-empty, `/`- and NUL-free, and not a `.`/`..`
 * traversal segment — so a name like `foo--..` still returns `null`. Never
 * compare the result's dir form against an identity — decode, then compare the
 * `{ owner, slug }`.
 */
export function fromSlugDir(name: string): { owner: string | null; slug: string } | null {
  if (typeof name !== 'string' || name.length === 0) return null;
  if (name === 'skillet') return { owner: 'skillet', slug: 'route' };
  if (name.startsWith('_local--')) {
    const slug = name.slice('_local--'.length);
    return isDecodableSlugPart(slug) ? { owner: null, slug } : null;
  }
  const sep = name.indexOf('--');
  if (sep <= 0) return null;
  let owner = name.slice(0, sep);
  const slug = name.slice(sep + 2);
  if (owner.startsWith('@')) owner = owner.slice(1);
  if (!isDecodableSlugPart(owner) || !isDecodableSlugPart(slug)) return null;
  return { owner, slug };
}
