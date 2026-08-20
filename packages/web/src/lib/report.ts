// Client-side abuse reporting.
//
// A signed-in viewer reports a skill. The call runs in the *browser* with the
// session cookie attached, going through the web BFF proxy (`/api/registry/...`)
// so the registry sees the reporter's session token — same shape as
// deprecation.ts. The registry is the authority: it rate-limits, re-checks the
// session, and answers 401/403/404/429, which we surface verbatim.
//
//   POST /api/v1/skills/:author/:slug/report
//     body: { category, reason?, version_hash?, claims_ownership? }

import { REGISTRY_API } from './registry-prefix'
import { registrySkillSubPath } from './registry-path-segments'
import { registryFetchOrigin, registryPublicOrigin } from './registry-origin'

/** The report categories, in display order. `copyright` is the DMCA/takedown
 *  fast path; `other` requires free-text. Kept in sync with the registry's
 *  REPORT_CATEGORIES check constraint. */
export const REPORT_CATEGORIES = [
  { value: 'malware', label: 'Malicious or harmful code' },
  { value: 'prompt_injection', label: 'Hidden or injected instructions' },
  { value: 'spam', label: 'Spam or low quality' },
  { value: 'abusive', label: 'Abusive or hateful content' },
  { value: 'copyright', label: 'Copyright / takedown: this is my content' },
  { value: 'other', label: 'Something else' },
] as const

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['value']

function hasRegistry(): boolean {
  return Boolean(registryFetchOrigin() || registryPublicOrigin())
}

/** Reports carry the session cookie, so in the browser they go through the BFF
 *  proxy; a server-side caller (rare) hits the registry directly. */
function reportUrl(author: string, slug: string): string | null {
  if (!hasRegistry()) return null
  if (typeof window !== 'undefined') {
    return `/api/registry${REGISTRY_API}${registrySkillSubPath(author, slug, 'report')}`
  }
  return `${registryFetchOrigin()}${REGISTRY_API}${registrySkillSubPath(author, slug, 'report')}`
}

/** Thrown when a report did not land. `code` is the registry error code
 *  (e.g. `account_suspended`, `rate_limited`); `status` is the HTTP status so
 *  the UI can distinguish sign-in (401), rate-limit (429), and generic errors. */
export class ReportError extends Error {
  code?: string
  status?: number
  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'ReportError'
    this.code = code
    this.status = status
  }
}

export interface ReportInput {
  category: ReportCategory
  reason?: string
  versionHash?: string
  /** Required true on the `copyright` branch (ownership acknowledgement). */
  claimsOwnership?: boolean
  signal?: AbortSignal
}

export async function submitReport(
  author: string,
  slug: string,
  input: ReportInput,
): Promise<void> {
  const url = reportUrl(author, slug)
  if (!url) {
    throw new ReportError('No registry is configured to report to.', 'no_registry')
  }

  const body: Record<string, unknown> = { category: input.category }
  if (input.reason?.trim()) body.reason = input.reason.trim()
  if (input.versionHash) body.version_hash = input.versionHash
  if (input.category === 'copyright') body.claims_ownership = input.claimsOwnership === true

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
    throw new ReportError('Could not reach the skill registry.', 'network')
  }

  if (!res.ok) {
    let message =
      res.status === 401
        ? 'Please sign in to report a skill.'
        : res.status === 429
          ? 'You’re reporting too quickly. Try again in a bit.'
          : `The registry responded ${res.status}.`
    let code: string | undefined
    try {
      const err = (await res.json()) as { error?: string; message?: string }
      code = err.error
      message = err.message ?? err.error ?? message
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new ReportError(message, code, res.status)
  }
}
