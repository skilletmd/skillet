/**
 * Skill reference parser — `@author/slug` ↔ `{ author, slug }`.
 *
 * PROTOCOL §1.1: handles are lowercase URL-safe [a-z0-9-], 1-40 chars; slugs
 * are the same character class but allow longer (path-safe). The grammar here
 * is intentionally narrower than what the registry server accepts on publish
 * — better to refuse early on the client than to issue an HTTP request that
 * the server will 400 on, and the strict regex doubles as a path-traversal
 * gate before we ever interpolate the ref into a URL.
 *
 * Any character outside the allowlist (including `.`, `/`, `\`, `%`, NUL,
 * whitespace) is rejected with a typed error so callers can give a useful
 * message and so a hostile manifest can never escape into `joinPath`-style
 * traversal.
 *
 * IMPLEMENTATION: the owner/slug grammar and canonicalization now live in the
 * shared `@skillet/protocol/skill-id` module (single source of truth). This
 * file is a thin wrapper that (1) enforces the STRICT wire input shape — a `@`
 * prefix and a `/` separator, narrower than the tolerant shared `parseRef`,
 * which also accepts bare `owner/slug` and `owner:slug` — and (2) keeps the
 * historical `SkillRef` shape + `SkillRefError` code names so callers don't
 * need a sweep. The `SkillIdError` thrown by the shared parser is re-typed to
 * `SkillRefError`.
 */

import { parseRef, SkillIdError, toWireRef } from '@skillet/protocol/skill-id';

export interface SkillRef {
  /** Author handle without the leading `@`. */
  author: string;
  /** Skill slug. */
  slug: string;
  /** Canonical `@author/slug` form. */
  canonical: string;
}

export class SkillRefError extends Error {
  readonly code: 'invalid_ref' | 'invalid_author' | 'invalid_slug';
  constructor(code: SkillRefError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'SkillRefError';
  }
}

/** Map the shared parser's error code onto this module's historical codes. */
function mapErrorCode(code: SkillIdError['code']): SkillRefError['code'] {
  return code === 'invalid_owner' ? 'invalid_author' : code;
}

/**
 * Parses `@author/slug` into its components. Rejects anything that does not
 * exactly match the protocol grammar. Use this BEFORE constructing any URL or
 * path — the validated `{ author, slug }` are safe to interpolate verbatim.
 */
export function parseSkillRef(input: string): SkillRef {
  if (typeof input !== 'string' || input.length === 0) {
    throw new SkillRefError('invalid_ref', 'Skill ref is empty');
  }
  // Strict wire input shape: the shared `parseRef` is tolerant of a missing
  // `@` and of the `owner:slug` form, but this parser has always required the
  // canonical `@author/slug` wire ref. Gate those looser forms out here so the
  // behaviour matches the historical `REF_RE` (`/^@([a-z0-9-]+)\/([a-z0-9-]+)$/`).
  if (!input.startsWith('@') || input.includes(':')) {
    throw new SkillRefError(
      'invalid_ref',
      `Skill ref ${JSON.stringify(input)} must look like "@author/slug" (lowercase letters, digits, hyphen)`,
    );
  }
  try {
    const { owner, slug } = parseRef(input);
    return { author: owner, slug, canonical: toWireRef(input) };
  } catch (err) {
    if (err instanceof SkillIdError) {
      throw new SkillRefError(mapErrorCode(err.code), err.message);
    }
    throw err;
  }
}

/** Convenience: format components back to `@author/slug` (no validation). */
export function formatSkillRef(author: string, slug: string): string {
  return `@${author}/${slug}`;
}
