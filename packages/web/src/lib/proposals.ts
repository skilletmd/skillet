// Client-side proposal reads.
//
// Unlike the public catalog/detail endpoints in registry.ts, the proposal
// endpoints are owner/teammate-authorized: the registry answers 401/403 for
// anyone who is not the skill owner or a same-kit teammate (proposals.ts in
// packages/registry). So these reads run in the *browser* with the session
// cookie attached — never at static-build time — and a 401/403 is the normal,
// expected signal that the viewer simply isn't the owner. We surface that as a
// distinct outcome rather than an error so the notification UI can stay quiet.

import type { ProposalDetail, ProposalListResponse, ProposalState, ProposalSummary } from './types'
import { skillReviewHref } from './urls'
import { REGISTRY_API } from './registry-prefix'
import { encodeRegistrySegment, registrySkillSubPath } from './registry-path-segments'
import { registryFetchOrigin, registryPublicOrigin } from './registry-origin'

/**
 * Browser-authenticated calls go through the web BFF (`/api/registry/...`) so
 * the same-origin session cookie is attached — a direct cross-origin call to the
 * registry would drop the cookie and trip CORS. `suffix` is the path under
 * `/skills/{author}/{slug}/proposals` (e.g. '' for the list, `/{id}` for one).
 */
function encodePathSuffix(suffix: string): string {
  if (!suffix) return ''
  const parts = suffix.split('/').filter(Boolean)
  if (parts.length === 0) return ''
  return `/${parts.map(encodeRegistrySegment).join('/')}`
}

function proposalsUrl(author: string, slug: string, suffix = ''): string | null {
  // Call-time env so tests can stub REGISTRY_URL after import.
  if (!registryFetchOrigin() && !registryPublicOrigin()) return null

  const path = `${REGISTRY_API}${registrySkillSubPath(author, slug, 'proposals')}${encodePathSuffix(suffix)}`
  if (typeof window !== 'undefined') {
    return `/api/registry${path}`
  }
  return `${registryFetchOrigin()}${path}`
}

/**
 * Anchor id for the "Proposed changes" review surface on the skill detail page
 * Notifications link here so a click lands the owner
 * directly on the review view. Shared constant so the two sub-issues agree on
 * the same target without a hard import dependency between them.
 */
export const PROPOSALS_ANCHOR = 'proposed-changes'

/** Outcome of {@link fetchSkillProposals} — distinguishes "not owner" from a real failure. */
export type ProposalsResult =
  | { kind: 'ok'; proposals: ProposalSummary[] }
  /** Viewer is signed out or not the owner/teammate — show nothing, not an error. */
  | { kind: 'unauthorized' }
  /** Registry unreachable or non-OK (and not 401/403). */
  | { kind: 'error'; status?: number }

/** Only `pending` proposals await a decision; everything else has been decided. */
export function pendingOnly(proposals: ProposalSummary[]): ProposalSummary[] {
  return proposals.filter((p) => p.state === 'pending')
}

/**
 * Deep-link to the dedicated review page for a skill, optionally focused on one
 * proposal. The review-and-decide flow lives on its own page, a
 * sibling of the editor, so the public skill page stays a clean catalog page.
 */
export function reviewSurfaceHref(author: string, slug: string, proposalId?: string): string {
  return skillReviewHref(author, slug, proposalId)
}

/**
 * Fetch every proposal for a skill from the owner-authorized list endpoint.
 *
 * Runs in the browser with `credentials: 'include'` so the session cookie is
 * sent. A 401/403 → `unauthorized` (the viewer isn't the owner); any other
 * failure → `error`. When no registry is configured (local dev / CI) there is
 * nothing to authorize against, so we report `unauthorized` (renders nothing)
 * rather than inventing proposals — mirrors registry.ts's "never fabricate".
 */
export async function fetchSkillProposals(
  author: string,
  slug: string,
  init?: { signal?: AbortSignal },
): Promise<ProposalsResult> {
  const url = proposalsUrl(author, slug)
  if (!url) return { kind: 'unauthorized' }

  let res: Response
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: init?.signal,
    })
  } catch {
    return { kind: 'error' }
  }

  if (res.status === 401 || res.status === 403) return { kind: 'unauthorized' }
  if (!res.ok) return { kind: 'error', status: res.status }

  try {
    const body = (await res.json()) as ProposalListResponse
    return { kind: 'ok', proposals: body.proposals ?? [] }
  } catch {
    return { kind: 'error', status: res.status }
  }
}

// ---------------------------------------------------------------------------
// Detail + decision (review surface).
//
// The list above is enough to notify/count, but the review surface also needs
// the graded diff and proposer key, which only the detail endpoint carries, and
// must be able to submit the owner's decision. These run in the browser with the
// session cookie, same as the list. The merged decision contract:
// approve is owner-only AND requires the OWNER's Ed25519 signature over the
// proposed hash (the minted version is always owner-key-signed); request_changes
// / reject need no signature. The server re-runs every gate — it is the
// authority on whether publishing is allowed.
// ---------------------------------------------------------------------------

/** Outcome of {@link fetchProposalDetail} — same authorized/error split as the list. */
export type ProposalDetailResult =
  | { kind: 'ok'; proposal: ProposalDetail }
  /** Viewer is signed out or not the owner/teammate — show nothing, not an error. */
  | { kind: 'unauthorized' }
  /** Proposal id doesn't exist (or no longer does). */
  | { kind: 'notfound' }
  /** Registry unreachable or non-OK (and not 401/403/404). */
  | { kind: 'error'; status?: number }

/** Fetch one proposal's full detail (graded diff + proposer key + signature). */
export async function fetchProposalDetail(
  author: string,
  slug: string,
  proposalId: string,
  init?: { signal?: AbortSignal },
): Promise<ProposalDetailResult> {
  const url = proposalsUrl(author, slug, `/${proposalId}`)
  if (!url) return { kind: 'unauthorized' }

  let res: Response
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: init?.signal,
    })
  } catch {
    return { kind: 'error' }
  }

  if (res.status === 401 || res.status === 403) return { kind: 'unauthorized' }
  if (res.status === 404) return { kind: 'notfound' }
  if (!res.ok) return { kind: 'error', status: res.status }

  try {
    const proposal = (await res.json()) as ProposalDetail
    return { kind: 'ok', proposal }
  } catch {
    return { kind: 'error', status: res.status }
  }
}

/** The three decisions an owner can make on a pending proposal. */
export type ProposalDecision = 'approve' | 'request_changes' | 'reject'

/** Owner Ed25519 signature over the proposed hash — required to approve. */
export interface OwnerSignature {
  alg: 'ed25519'
  key_id: string
  sig: string
}

export interface DecisionResult {
  state: ProposalState
  /** Minted version hash on approve (so the UI can confirm the publish). */
  version_hash?: string
}

/**
 * Thrown when a decision did NOT take effect. `code` is the registry error code
 * (e.g. `signature_required`, `owner_only`, `scan_quarantined`); `message` is
 * the server's human-readable reason, surfaced to the owner verbatim.
 */
export class ProposalDecisionError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ProposalDecisionError'
    this.code = code
  }
}

/**
 * Submit an owner decision to `POST .../proposals/:id/decision`. Resolves with
 * the new state on success; throws {@link ProposalDecisionError} (carrying the
 * server's code + message) when the server rejects the decision.
 */
export async function submitProposalDecision(
  author: string,
  slug: string,
  proposalId: string,
  decision: ProposalDecision,
  opts: { note?: string; signature?: OwnerSignature; signal?: AbortSignal } = {},
): Promise<DecisionResult> {
  const url = proposalsUrl(author, slug, `/${proposalId}/decision`)
  if (!url) {
    throw new ProposalDecisionError(
      'No registry is configured. Connect a registry to decide proposals.',
      'no_registry',
    )
  }

  const body: Record<string, unknown> = { decision }
  if (opts.note?.trim()) body.note = opts.note.trim()
  if (opts.signature) body.signature = opts.signature

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch {
    throw new ProposalDecisionError('Could not reach the proposal service.', 'network')
  }

  if (!res.ok) {
    let message = `The proposal service responded ${res.status}.`
    let code: string | undefined
    try {
      const errBody = (await res.json()) as { error?: string; message?: string }
      code = errBody.error
      message = errBody.message ?? errBody.error ?? message
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new ProposalDecisionError(message, code)
  }

  const ok = (await res.json()) as { state: ProposalState; version_hash?: string }
  return { state: ok.state, version_hash: ok.version_hash }
}
