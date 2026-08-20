// Submit an update proposal from the browser.
//
// This is the write half of the propose-update flow: it loads the current
// version bundle to edit against, and POSTs the edited bundle as a signed
// proposal. Both calls run in the browser through the web BFF
// (`/api/registry/...`, which attaches the session cookie as a Bearer token);
// the registry gates `POST .../proposals` on `publish` scope and authorizes the
// proposer as skill owner or same-kit teammate (third-party is v2). See
// packages/registry/src/routes/proposals.ts for the server contract.
//
// SIGNING: the registry recomputes the canonical content hash server-side and
// verifies `signature` against the *proposer's* registered Ed25519 key — there
// is no unsigned path. The signature is therefore an INPUT here, produced by
// whatever browser-signing strategy the platform adopts. This module never
// touches a private key; it only carries the envelope to the wire and maps the
// server's verdict back to typed, user-facing outcomes.

import type { BundleFiles } from './skill-bundle'
import type { ProposalScan, ProposalState } from './types'
import { REGISTRY_API } from './registry-prefix'
import { encodeRegistrySegment, registrySkillSubPath } from './registry-path-segments'
import { registryFetchOrigin, registryPublicOrigin } from './registry-origin'

/** Browser calls go through the BFF (cookie → Bearer); SSR hits the registry directly. */
function registryPath(author: string, slug: string, tail: string): string | null {
  if (!registryFetchOrigin() && !registryPublicOrigin()) return null
  const encodedTail = tail
    .split('/')
    .filter(Boolean)
    .map(encodeRegistrySegment)
    .join('/')
  const path = `${REGISTRY_API}${registrySkillSubPath(author, slug, encodedTail)}`
  if (typeof window !== 'undefined') return `/api/registry${path}`
  return `${registryFetchOrigin()}${path}`
}

// ---------------------------------------------------------------------------
// Base-bundle load (editor opens the current version to edit against).
// ---------------------------------------------------------------------------

/** The slice of `GET .../versions/:hash` the editor needs: the bundle + its hash. */
export interface SkillVersionBundle {
  hash: string
  files: BundleFiles
}

export type VersionBundleResult =
  | { kind: 'ok'; version: SkillVersionBundle }
  | { kind: 'notfound' }
  /** No registry configured (local dev / CI) — nothing to load, not an error. */
  | { kind: 'unavailable' }
  | { kind: 'error'; status?: number }

/**
 * Load a published version's bundle so the editor can use it as the base. The
 * returned `hash` is the `base_hash` the proposal must be submitted against;
 * compare it to the skill's current `latest_hash` before submit to detect a
 * stale base and prompt a rebase.
 */
export async function fetchSkillVersionBundle(
  author: string,
  slug: string,
  hash: string,
  init?: { signal?: AbortSignal },
): Promise<VersionBundleResult> {
  const url = registryPath(author, slug, `versions/${hash}`)
  if (!url) return { kind: 'unavailable' }

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

  if (res.status === 404) return { kind: 'notfound' }
  if (!res.ok) return { kind: 'error', status: res.status }

  try {
    const body = (await res.json()) as { hash: string; files: BundleFiles }
    return { kind: 'ok', version: { hash: body.hash, files: body.files } }
  } catch {
    return { kind: 'error', status: res.status }
  }
}

// ---------------------------------------------------------------------------
// Submit.
// ---------------------------------------------------------------------------

/** Proposer's Ed25519 signature envelope over the canonical content hash. */
export interface ProposalSignature {
  alg: 'ed25519'
  key_id: string
  sig: string
}

export interface CreateProposalInput {
  files: BundleFiles
  /** Hash of the version edited against — `null` only for a brand-new skill. */
  baseHash: string | null
  signature: ProposalSignature
  signal?: AbortSignal
}

/** Shape of `POST .../proposals` on success (201). */
export interface CreatedProposal {
  proposal_id: string
  skill_id: string
  proposed_hash: string
  state: ProposalState
  proposal_url: string
  scan: ProposalScan
}

/** A blocking scan finding the server attaches to a `scan_blocked` rejection. */
export interface ScanFinding {
  category: string
  confidence: string
  file: string
  lineStart: number
  lineEnd: number
  why: string
}

/**
 * Thrown when a proposal was NOT created. `code` is the registry error code so
 * the UI can branch (e.g. `base_stale` → rebase, `not_authorized` → hide/403,
 * `author_not_claimed` → claim-key prompt); `message` is human-facing copy.
 */
export class ProposalSubmitError extends Error {
  code?: string
  status?: number
  /** Present for `scan_blocked` — the credential/harm finding to show inline. */
  finding?: ScanFinding
  constructor(
    message: string,
    opts: { code?: string; status?: number; finding?: ScanFinding } = {},
  ) {
    super(message)
    this.name = 'ProposalSubmitError'
    this.code = opts.code
    this.status = opts.status
    this.finding = opts.finding
  }

  /** The base version moved under us — the caller should offer a rebase/refresh. */
  get isStaleBase(): boolean {
    return this.code === 'base_stale'
  }

  /** Viewer may not propose here — hide the action / show 403 copy. */
  get isUnauthorized(): boolean {
    return this.code === 'not_authorized' || this.status === 403
  }

  /** A signature/identity gate failed — surface the claim-key affordance. */
  get isSignatureProblem(): boolean {
    return (
      this.code === 'signature_invalid' ||
      this.code === 'key_id_mismatch' ||
      this.code === 'author_not_claimed' ||
      this.code === 'handle_not_claimed'
    )
  }
}

/**
 * Friendly fallback copy for codes the server may return without a `message`
 * (or whose server message is terse). When the server DOES send a `message`, we
 * prefer it — it is the authoritative, situation-specific reason.
 */
const DEFAULT_MESSAGES: Record<string, string> = {
  files_required: 'The proposal has no files to submit.',
  handle_not_claimed: 'Claim your author handle before proposing changes.',
  skill_not_found: 'This skill no longer exists.',
  not_authorized: 'Only the skill owner or a same-kit teammate can propose changes here.',
  base_stale:
    'A newer version was published while you were editing. Refresh to rebase your changes onto the latest version, then submit again.',
  scan_blocked:
    'A high-confidence credential pattern was detected in your changes. Remove the secret and try again.',
  scan_quarantined: 'The harm scan blocked this bundle. Remove the flagged content and try again.',
  author_not_claimed: 'Claim your signing key before proposing changes.',
  signature_invalid: 'Your signature could not be verified. Re-sign and try again.',
  key_id_mismatch: 'Your signing key does not match the key registered to your account.',
}

function messageFor(
  code: string | undefined,
  serverMessage: string | undefined,
  status: number,
): string {
  if (serverMessage && serverMessage.trim()) return serverMessage.trim()
  if (code && DEFAULT_MESSAGES[code]) return DEFAULT_MESSAGES[code]
  return `The proposal service responded ${status}.`
}

/**
 * Submit a signed proposal to `POST .../proposals`. Resolves with the created
 * proposal on 201; throws {@link ProposalSubmitError} (carrying the server's
 * code + message, and any inline scan finding) on every rejection.
 */
export async function createSkillProposal(
  author: string,
  slug: string,
  input: CreateProposalInput,
): Promise<CreatedProposal> {
  const url = registryPath(author, slug, 'proposals')
  if (!url) {
    throw new ProposalSubmitError(
      'No registry is configured. Connect a registry to propose changes.',
      { code: 'no_registry' },
    )
  }

  const body = {
    files: input.files,
    base_hash: input.baseHash,
    signature: input.signature,
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: input.signal,
    })
  } catch {
    throw new ProposalSubmitError('Could not reach the proposal service.', { code: 'network' })
  }

  if (res.status === 201) {
    return (await res.json()) as CreatedProposal
  }

  let code: string | undefined
  let serverMessage: string | undefined
  let finding: ScanFinding | undefined
  try {
    const errBody = (await res.json()) as {
      error?: string
      message?: string
      finding?: ScanFinding
    }
    code = errBody.error
    serverMessage = errBody.message
    finding = errBody.finding
  } catch {
    /* non-JSON error body — fall back to a status message */
  }

  throw new ProposalSubmitError(messageFor(code, serverMessage, res.status), {
    code,
    status: res.status,
    finding,
  })
}

// ---------------------------------------------------------------------------
// Propose access probe (hide entry point when viewer may not propose).
// ---------------------------------------------------------------------------

export type ProposeAccessResult =
  | { kind: 'allowed' }
  | { kind: 'denied' }
  | { kind: 'unauthenticated' }
  | { kind: 'unavailable' }

/**
 * GET .../proposals returns 403 when the viewer is not owner/teammate. We use
 * that as a cheap gate for showing the "Propose update" affordance on the skill
 * page without posting a draft proposal.
 */
export async function checkProposeAccess(
  author: string,
  slug: string,
  init?: { signal?: AbortSignal },
): Promise<ProposeAccessResult> {
  const url = registryPath(author, slug, 'proposals')
  if (!url) return { kind: 'unavailable' }

  let res: Response
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: init?.signal,
    })
  } catch {
    return { kind: 'unavailable' }
  }

  if (res.status === 401) return { kind: 'unauthenticated' }
  if (res.status === 403) return { kind: 'denied' }
  if (res.ok) return { kind: 'allowed' }
  return { kind: 'denied' }
}
