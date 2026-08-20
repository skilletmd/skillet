import { delegationErrorUX, isDelegationErrorCode } from './delegation-errors'
import { NEEDS_HANDLE_MESSAGE } from './signing-setup'
import { registryAuthApi, registrySkillApi } from './registry-proxy'
import type { BundleFiles } from './skill-bundle'

export const PUBLISH_AUTH_SESSION = 'session' as const

export interface PublishSkillInput {
  author: string
  slug: string
  /** Full wire-format bundle (SKILL.md plus any supporting files). */
  files: BundleFiles
  visibility?: 'private' | 'public'
  baseHash?: string | null
  /** Per-flag author notes, keyed category:file:lineStart. Stored for public
   *  skills only — the registry drops them for private. */
  harmNotes?: Record<string, string>
  /** Provenance for a GitHub import: the `owner/repo` it came from (directory
   *  match key) and the specific source directory URL. Omitted for hand-authored
   *  skills. */
  sourceRepo?: string
  sourceUrl?: string
}

export interface PublishSkillResult {
  hash: string
  skill_id: string
  already_exists?: boolean
  /** The verdict the publish gate resolved (flagged/clean publishes go live). */
  scan?: { status: ScanVerdictStatus; findings: ScanFinding[] }
}

/** A single scan finding as returned by the dry-run + per-version reports. */
export interface ScanFinding {
  category: string
  confidence: 'low' | 'medium' | 'high'
  file: string
  lineStart: number
  lineEnd: number
  why: string
  /** Source peek — present for non-secret findings; never for secrets. */
  snippet?: string
}

export type ScanVerdictStatus = 'clean' | 'flagged' | 'quarantined'

export interface ScanDraftResult {
  status: ScanVerdictStatus
  /** Set to `secret` when a credential blocked the bundle (status quarantined). */
  reason?: 'secret'
  findings: ScanFinding[]
}

/**
 * Dry-run the harm scan over a draft bundle. Returns the verdict a
 * real publish would produce without writing anything, so the publish step can
 * show findings and collect per-flag notes before committing. Throws on
 * transport/auth failure (the caller decides how to surface it).
 */
export async function scanDraft(files: BundleFiles): Promise<ScanDraftResult> {
  const res = await fetch(registrySkillApi('skills/scan'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ files }),
  })
  if (!res.ok) {
    let message = `Scan failed (${res.status})`
    try {
      const err = (await res.json()) as { message?: string; error?: string }
      message = err.message ?? err.error ?? message
    } catch {
      /* keep default */
    }
    throw new Error(message)
  }
  return (await res.json()) as ScanDraftResult
}

export async function publishSkillFromBrowser(
  input: PublishSkillInput,
): Promise<PublishSkillResult> {
  const res = await fetch(registrySkillApi('skills'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      author: input.author,
      slug: input.slug,
      files: input.files,
      base_hash: input.baseHash ?? null,
      publish_auth: PUBLISH_AUTH_SESSION,
      visibility: input.visibility ?? 'private',
      ...(input.harmNotes && Object.keys(input.harmNotes).length > 0
        ? { metadata: { harm_notes: input.harmNotes } }
        : {}),
      ...(input.sourceRepo ? { source_repo: input.sourceRepo } : {}),
      ...(input.sourceUrl ? { source_url: input.sourceUrl } : {}),
    }),
  })

  if (!res.ok) {
    let message = `Publish failed (${res.status})`
    try {
      const err = (await res.json()) as {
        message?: string
        error?: string
        findings?: Array<{ category?: string; file?: string; lineStart?: number }>
      }
      if (err.error === 'handle_not_claimed') {
        message = NEEDS_HANDLE_MESSAGE
      } else if (err.error === 'scan_blocked') {
        // Surface WHAT tripped the scanner and WHERE, so a publisher isn't left
        // guessing at "the flagged patterns". Falls back to the generic guidance.
        const findings = err.findings ?? []
        const top = findings[0]
        if (top?.category) {
          const loc = top.file ? ` (${top.file}${top.lineStart ? `:${top.lineStart}` : ''})` : ''
          const more = findings.length > 1 ? ` +${findings.length - 1} more` : ''
          message = `Scanner flagged ${top.category}${loc}${more}. Fix and republish.`
        } else {
          message =
            err.message ?? 'Publish blocked by the scanner. Fix the flagged content and republish.'
        }
      } else if (isDelegationErrorCode(err.error)) {
        message = delegationErrorUX(err.error).message
      } else {
        message = err.message ?? err.error ?? message
      }
    } catch {
      /* keep default */
    }
    throw new Error(message)
  }

  return (await res.json()) as PublishSkillResult
}

export async function deprecateSkillFromBrowser(
  author: string,
  slug: string,
  message?: string,
): Promise<void> {
  const res = await fetch(
    `${registrySkillApi(`skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/deprecate`)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(message ? { message } : {}),
    },
  )
  if (!res.ok) {
    throw new Error(`Deprecate failed (${res.status})`)
  }
}

/** Flip a published skill between public and private. Visibility isn't part of
 * the signed bundle, so this is a plain authenticated call — no signing or
 * republish needed. */
export async function fetchSkillManifest(
  author: string,
  slug: string,
): Promise<{ latest_hash: string | null; files?: Record<string, string> } | null> {
  const res = await fetch(
    `${registrySkillApi(`skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/manifest`)}`,
    { credentials: 'include', headers: { accept: 'application/json' } },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Could not load skill (${res.status})`)
  return (await res.json()) as { latest_hash: string | null }
}

export async function fetchWhoami(): Promise<{
  handle: string | null
  author_key_id: string | null
} | null> {
  const res = await fetch(registryAuthApi('whoami'), {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (res.status === 401) return null
  if (!res.ok) return null
  const body = (await res.json()) as { handle?: string | null; author_key_id?: string | null }
  return {
    handle: body.handle ?? null,
    author_key_id: body.author_key_id ?? null,
  }
}

export async function fetchAuthorKeys(): Promise<Array<{ key_id: string; label: string }>> {
  const res = await fetch(registryAuthApi('auth/keys'), {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (res.status === 401) return []
  if (!res.ok) return []
  const body = (await res.json()) as { keys?: Array<{ key_id: string; label: string }> }
  return body.keys ?? []
}

export async function claimBrowserAuthorKey(input: {
  handle: string
  publicKey: string
  keyId: string
}): Promise<void> {
  const res = await fetch(registryAuthApi('claim'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      handle: input.handle,
      public_key: input.publicKey,
      key_id: input.keyId,
    }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    const code = err.error ?? ''
    if (code === 'already_claimed') {
      throw new Error('This account already has a different handle on the registry.')
    }
    if (code === 'key_change_forbidden') {
      throw new Error(
        'This handle is bound to a different signing key. Use the original key or pick a new handle.',
      )
    }
    if (code === 'name_taken') {
      throw new Error('That username is already taken. Try another.')
    }
    if (code === 'handle_reserved') {
      throw new Error('That username is reserved. Try another.')
    }
    if (code === 'invalid_handle') {
      throw new Error('Use lowercase letters, numbers, and hyphens (max 39 characters).')
    }
    if (code === 'account_verification_required') {
      throw new Error('Verify your email before choosing a username.')
    }
    throw new Error(
      err.message ?? err.error ?? `Could not register browser signing key (${res.status})`,
    )
  }
}
