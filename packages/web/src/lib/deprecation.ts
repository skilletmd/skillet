// Client-side skill deprecate / undeprecate.
//
// Deprecation is a soft sunset: an owner (or org admin once that lands)
// unlists a skill from the public directory without deleting it. There is NO
// delete endpoint in v1 — deprecate is the only lifecycle teardown.
//
// These calls run in the *browser* with the session cookie attached, going
// through the web BFF proxy (`/api/registry/...`) so the registry sees the
// owner's session token — same shape as proposals.ts. The registry
// is the authority: it re-checks ownership / org-admin and answers
// 401/403 for anyone not allowed, which we surface verbatim. The wire contract
// mirrors the documented endpoint:
//
//   POST /v1/skills/:author/:slug/deprecate     body: { message?: string }
//   POST /v1/skills/:author/:slug/undeprecate
//
// On success the registry stops listing the skill in the public catalog and
// flags it `deprecated` in the owner-authenticated detail/list.

import { REGISTRY_API } from './registry-prefix'
import { registrySkillSubPath } from './registry-path-segments'
import { registryFetchOrigin, registryPublicOrigin } from './registry-origin'

/** Whether any registry is configured to talk to (live or proxied). */
function hasRegistry(): boolean {
  // Read env at call time so tests can toggle REGISTRY_URL after import.
  return Boolean(registryFetchOrigin() || registryPublicOrigin())
}

/**
 * Lifecycle mutations are owner-authorized and must carry the session cookie,
 * so in the browser they go through the web BFF proxy; the (rare) server-side
 * caller hits the registry directly. Mirrors {@link proposalsUrl} in proposals.ts.
 */
function lifecycleUrl(
  author: string,
  slug: string,
  action: 'deprecate' | 'undeprecate',
): string | null {
  if (!hasRegistry()) return null
  if (typeof window !== 'undefined') {
    return `/api/registry${REGISTRY_API}${registrySkillSubPath(author, slug, action)}`
  }
  return `${registryFetchOrigin()}${REGISTRY_API}${registrySkillSubPath(author, slug, action)}`
}

/** Current lifecycle status of a skill, as seen by an authorized owner. */
export interface SkillDeprecation {
  deprecated: boolean
  /** Optional owner-authored sunset note, shown to owners on the skill page. */
  message?: string | null
  /** RFC3339 timestamp the skill was deprecated, when known. */
  deprecatedAt?: string | null
}

/**
 * Thrown when a deprecate/undeprecate did NOT take effect. `code` is the
 * registry error code (e.g. `owner_only`, `not_found`); `message` is the
 * server's human-readable reason, surfaced to the owner verbatim. Mirrors
 * {@link ProposalDecisionError} so the UI can render a consistent error state.
 */
export class SkillLifecycleError extends Error {
  code?: string
  status?: number
  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'SkillLifecycleError'
    this.code = code
    this.status = status
  }
}

async function postLifecycle(
  author: string,
  slug: string,
  action: 'deprecate' | 'undeprecate',
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<SkillDeprecation> {
  const url = lifecycleUrl(author, slug, action)
  if (!url) {
    throw new SkillLifecycleError(
      'No registry is configured. Connect a registry to change a skill’s lifecycle.',
      'no_registry',
    )
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new SkillLifecycleError('Could not reach the skill registry.', 'network')
  }

  if (!res.ok) {
    let message =
      res.status === 401 || res.status === 403
        ? 'You don’t have permission to change this skill.'
        : `The registry responded ${res.status}.`
    let code: string | undefined
    try {
      const errBody = (await res.json()) as { error?: string; message?: string }
      code = errBody.error
      message = errBody.message ?? errBody.error ?? message
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new SkillLifecycleError(message, code, res.status)
  }

  // The registry returns the new lifecycle state; tolerate a bare 200 with no
  // body by inferring the state from the action we just performed.
  const sentMessage = typeof body.message === 'string' ? body.message : null
  try {
    const ok = (await res.json()) as Partial<SkillDeprecation>
    return {
      deprecated: ok.deprecated ?? action === 'deprecate',
      message: ok.message ?? sentMessage,
      deprecatedAt: ok.deprecatedAt ?? null,
    }
  } catch {
    return { deprecated: action === 'deprecate', message: sentMessage }
  }
}

/**
 * Deprecate a skill (soft sunset). Resolves with the new lifecycle state;
 * throws {@link SkillLifecycleError} (carrying the server's code + message)
 * when the registry rejects the request.
 */
export async function deprecateSkill(
  author: string,
  slug: string,
  opts: { message?: string; signal?: AbortSignal } = {},
): Promise<SkillDeprecation> {
  const body: Record<string, unknown> = {}
  if (opts.message?.trim()) body.message = opts.message.trim()
  return postLifecycle(author, slug, 'deprecate', body, opts.signal)
}

/** Restore a previously deprecated skill (the documented un-deprecate path). */
export async function undeprecateSkill(
  author: string,
  slug: string,
  opts: { signal?: AbortSignal } = {},
): Promise<SkillDeprecation> {
  return postLifecycle(author, slug, 'undeprecate', {}, opts.signal)
}

/** Skill visibility as the owner sets it. */
export type SkillVisibility = 'public' | 'private'

/** Same BFF-vs-direct rule as {@link lifecycleUrl}, for the visibility endpoint. */
function visibilityUrl(author: string, slug: string): string | null {
  if (!hasRegistry()) return null
  const sub = registrySkillSubPath(author, slug, 'visibility')
  if (typeof window !== 'undefined') {
    return `/api/registry${REGISTRY_API}${sub}`
  }
  return `${registryFetchOrigin()}${REGISTRY_API}${sub}`
}

/**
 * Flip a skill public <-> private without republishing (the documented
 * POST /v1/skills/:author/:slug/visibility path). Owner-authorized; in the
 * browser it goes through the web BFF proxy so the session cookie is attached,
 * and the registry re-checks ownership. Throws {@link SkillLifecycleError}
 * carrying the server code + message on rejection. Mirrors the deprecate shape.
 */
export async function setSkillVisibility(
  author: string,
  slug: string,
  visibility: SkillVisibility,
  opts: { signal?: AbortSignal } = {},
): Promise<{ visibility: SkillVisibility }> {
  const url = visibilityUrl(author, slug)
  if (!url) {
    throw new SkillLifecycleError(
      'No registry is configured. Connect a registry to change visibility.',
      'no_registry',
    )
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ visibility }),
      signal: opts.signal,
    })
  } catch {
    throw new SkillLifecycleError('Could not reach the skill registry.', 'network')
  }

  if (!res.ok) {
    let message =
      res.status === 401 || res.status === 403
        ? 'You do not have permission to change this skill.'
        : `The registry responded ${res.status}.`
    let code: string | undefined
    try {
      const errBody = (await res.json()) as { error?: string; message?: string }
      code = errBody.error
      message = errBody.message ?? errBody.error ?? message
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new SkillLifecycleError(message, code, res.status)
  }

  // Registry returns { skill_id, visibility }; tolerate a bare 200 by echoing
  // the value we just set.
  try {
    const ok = (await res.json()) as { visibility?: string }
    return { visibility: ok.visibility === 'private' ? 'private' : 'public' }
  } catch {
    return { visibility }
  }
}
