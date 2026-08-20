import { AppLink } from '@/components/app-link'
import { Badge } from '@/components/ui/badge'
import { loginHref } from '@/lib/urls'

/**
 * Compact repo label: trims the scheme and any deep tree/blob path down to
 * "owner/repo" so the notice names the repo instead of printing a giant URL.
 */
function hostPath(url: string): string {
  const stripped = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const gh = stripped.match(/^github\.com\/([^/]+\/[^/]+)/)
  return gh ? gh[1] : stripped.replace(/^github\.com\//, '')
}

export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

/**
 * One quiet provenance line: a green dot while the sync is running, "Auto-synced
 * from", a GitHub mark, and the source repo. A plain statement of where the skill
 * came from — the claim link is separate ({@link ClaimMirrorCta}).
 */
export function MirrorNotice({
  sourceUrl,
  license,
  live = true,
}: {
  /** Accepted for caller compatibility; the claim CTA is now separate. */
  handle?: string
  sourceUrl: string | null | undefined
  /** Source SPDX license (e.g. "Apache-2.0"). Shown next to the source so the
   *  mirror carries the license notice the permissive terms require us to keep. */
  license?: string | null | undefined
  /** Accepted for caller compatibility; the claim CTA is now separate. */
  unclaimed?: boolean
  /** True while the repo is still syncing; false once disconnected (a snapshot). */
  live?: boolean
}) {
  const repo = sourceUrl ? hostPath(sourceUrl) : null
  // 20px icon gutter + text column, so the caption's second line hangs under
  // the repo name and the row shares its left edges with sibling gutter rows.
  return (
    <span className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 text-sm text-(--ink-2)">
      {/* 16px like the other gutter glyphs (globe, clock, category mark) — and
          in the muted ink, since solid-filled already reads heavier than the
          stroked icons around it. */}
      <span className="inline-flex h-5 w-5 items-center justify-center">
        <GitHubMark className="h-4 w-4 text-(--ink-2)" />
      </span>
      <span className="flex min-w-0 items-center gap-x-1.5">
      {repo && sourceUrl ? (
        // Same size/weight/colour as the rest of the meta line — the GitHub
        // mark already says "source link", so no mono, no underline.
        <AppLink
          href={sourceUrl}
          className="truncate transition-colors hover:text-(--ink)"
        >
          {repo}
        </AppLink>
      ) : (
        <span className="shrink-0">a public repo</span>
      )}
      {/* The source license: mirrored under its permissive terms, which require
          keeping the license notice with the copy. Naming it is that notice.
          A pill sets it apart on its own, so no separator dot. */}
      {license && (
        <Badge
          className="shrink-0 rounded bg-transparent px-1.5 py-px leading-4"
          title={`Mirrored under the source's ${license} license`}
        >
          {license}
        </Badge>
      )}
      </span>
      {/* Say the sync mode in words — the octocat alone reads as "a link", not
          "this content comes from there". */}
      <span className="col-start-2 text-xs text-(--ink-3)">
        {live ? 'Auto-synced from GitHub' : 'Imported from GitHub'}
      </span>
    </span>
  )
}

/**
 * Bordered rail callout for a MIRRORED PROFILE — explains the special situation
 * in one breath: this handle is not a Skillet account, its skills sync from a
 * named repo, and the owner can claim it. The claim trigger rides in as
 * children so this stays a server-renderable shell.
 */
export function MirrorProfileCard({
  handle,
  sourceUrl,
  license,
  since,
  children,
}: {
  handle: string
  sourceUrl: string | null | undefined
  license?: string | null | undefined
  /** ISO date the mirror was created — rendered as "Mirrored since <month year>". */
  since?: string | null
  children?: React.ReactNode
}) {
  const repo = sourceUrl ? hostPath(sourceUrl) : null
  const sinceLabel = since
    ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(since),
      )
    : null
  return (
    <div className="rounded-xl border border-(--line) bg-(--card-pop) p-4 text-sm">
      <p className="flex items-center gap-2 font-medium text-(--ink)">
        <GitHubMark className="h-4 w-4" />
        Mirrored from GitHub
      </p>
      <p className="mt-1.5 leading-[1.55] text-(--ink-2)">
        @{handle} isn&apos;t a Skillet account. These skills sync automatically from{' '}
        {repo && sourceUrl ? (
          <AppLink href={sourceUrl} className="whitespace-nowrap text-(--ink) hover:underline">
            {repo}
          </AppLink>
        ) : (
          'a public repo'
        )}
        {license ? ` (${license})` : ''}.
      </p>
      {children && <div className="mt-2.5">{children}</div>}
      {sinceLabel && <p className="mt-2.5 text-xs text-(--ink-3)">Mirrored since {sinceLabel}</p>}
    </div>
  )
}

/** Name of the short-lived httpOnly cookie the claim callback sets. Defined
 *  here (the reader) and imported by the callback route (the writer) so there is a
 *  single source of truth and the render layer needn't import a server route. */
export const GH_CLAIM_RESULT_COOKIE = 'gh_claim_result'

/**
 * Claim outcome carried by the result cookie. The three eligibility classes
 * plus two post-claim outcomes:
 *  - ALREADY_MANAGED — the registry returned the existing owner's org (HTTP 200,
 *    R4 join affordance); the viewer did NOT just take over the brand.
 *  - DENIED — a definitive registry refusal (409 name/org taken, 422 mismatch):
 *    accurate, non-retryable; never the INDETERMINATE "approve the app" copy.
 */
export type ClaimClassification =
  | 'ELIGIBLE'
  | 'NOT_ELIGIBLE'
  | 'INDETERMINATE'
  | 'ALREADY_MANAGED'
  | 'DENIED'

export type ClaimOwnerType = 'Organization' | 'User'

export interface ClaimResult {
  classification: ClaimClassification
  handle: string
  claimed?: boolean
  /** Source owner type — gates the INDETERMINATE org-OAuth-policy remediation
   *  (a personal/User source has no org settings link). Null/absent when unknown. */
  ownerType?: ClaimOwnerType | null
}

/** Start the read:org GitHub grant for a brand handle. A hard navigation via
 *  AppLink's `/api/*` rule — never a prefetched Link that would fire the OAuth GET. */
function claimStartHref(handle: string): string {
  return `/api/github/claim-org/start?handle=${encodeURIComponent(handle)}`
}

/**
 * Parse the httpOnly `gh_claim_result` cookie value into a typed outcome. Returns
 * null on anything malformed or unknown so a tampered cookie renders nothing — the
 * classification is read server-side from this cookie, never from the URL.
 */
export function parseClaimResult(raw: string | null | undefined): ClaimResult | null {
  if (!raw) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const c = o.classification
  if (
    c !== 'ELIGIBLE' &&
    c !== 'NOT_ELIGIBLE' &&
    c !== 'INDETERMINATE' &&
    c !== 'ALREADY_MANAGED' &&
    c !== 'DENIED'
  ) {
    return null
  }
  if (typeof o.handle !== 'string' || !o.handle) return null
  const ownerType =
    o.ownerType === 'Organization' || o.ownerType === 'User' ? o.ownerType : null
  return { classification: c, handle: o.handle, claimed: o.claimed === true, ownerType }
}

/** Shared link styling for the claim affordances. */
const CLAIM_LINK_CLASS = 'font-medium text-(--ink) underline underline-offset-2'

/**
 * Claim affordance for an unclaimed mirror. A logged-in claim of ANY mirror makes
 * the claimant the OWNER of the namespace as an organization, with their own
 * account handle left untouched — so the authed primary action always lands on the
 * org claim. A logged-OUT viewer on a personal/User source gets the account-bootstrap
 * path instead (the GitHub grant mints them an account at @handle); an Organization
 * source routes them to login. An already-claimed brand shows a static "Claimed" label.
 */
export function ClaimMirrorCta({
  handle,
  authed = false,
  claimed = false,
  sourceOwnerType = null,
}: {
  handle: string
  /** Viewer has a live session — start the grant directly rather than via login. */
  authed?: boolean
  /** The brand is already claimed — render a label, not the CTA. */
  claimed?: boolean
  /** Mirror's GitHub source owner type. 'User' offers a personal-account path;
   *  'Organization' / null offers only the org claim. */
  sourceOwnerType?: ClaimOwnerType | null
}) {
  if (claimed) {
    return <p className="text-sm font-medium text-(--ink)">Claimed</p>
  }

  const isUserSource = sourceOwnerType === 'User'

  if (authed) {
    return (
      <div className="space-y-1 text-sm text-(--ink-2)">
        <p>
          <AppLink href={claimStartHref(handle)} className={CLAIM_LINK_CLASS}>
            Claim @{handle}
          </AppLink>
        </p>
        <p>You&apos;ll own it as an organization. Your @{handle} stays yours.</p>
        {isUserSource && (
          <p className="text-(--ink-3)">
            Want @{handle} as a personal account instead? Log out and claim.
          </p>
        )}
      </div>
    )
  }

  // Signed out. A User source can bootstrap a personal account directly from the
  // GitHub grant (the account-bootstrap path) — its primary action is the grant, not
  // login. An Organization source only ever becomes an org, so it still routes to login.
  if (isUserSource) {
    return (
      <div className="space-y-1 text-sm text-(--ink-2)">
        <p>
          <AppLink href={claimStartHref(handle)} className={CLAIM_LINK_CLASS}>
            Claim @{handle}
          </AppLink>
        </p>
        <p>Sign in with GitHub to claim it as your account.</p>
        <p className="text-(--ink-3)">
          <AppLink href={loginHref(`/${handle}`)} className={CLAIM_LINK_CLASS}>
            Have an account? Log in to own it as an organization.
          </AppLink>
        </p>
      </div>
    )
  }

  return (
    <p className="text-sm text-(--ink-2)">
      <AppLink href={loginHref(`/${handle}`)} className={CLAIM_LINK_CLASS}>
        Log in to claim @{handle}
      </AppLink>
    </p>
  )
}

/**
 * Render the outcome of a completed claim grant. Driven by the parsed
 * `gh_claim_result` cookie, so it can't be flipped from the URL:
 *   ELIGIBLE       — claimed confirmation
 *   NOT_ELIGIBLE   — contributor-denied copy (clean denial)
 *   INDETERMINATE  — couldn't verify; org may restrict third-party apps, with a
 *                    direct link to the org's OAuth app-policy settings + a retry.
 */
export function ClaimResultNotice({ result }: { result: ClaimResult }) {
  const { classification, handle } = result

  if (classification === 'ELIGIBLE') {
    return (
      <p className="rounded-lg border border-(--line) bg-(--surface) px-4 py-3 text-sm text-(--ink)">
        You now manage @{handle}. It keeps auto-syncing from its GitHub source.
      </p>
    )
  }

  // R4 join: the registry returned the existing owner's org (HTTP 200). The viewer
  // did NOT just take over the brand, so never show "you now manage".
  if (classification === 'ALREADY_MANAGED') {
    return (
      <p className="rounded-lg border border-(--line) bg-(--surface) px-4 py-3 text-sm text-(--ink-2)">
        @{handle} is already managed by its owner.
      </p>
    )
  }

  // Definitive registry refusal (409/422) — accurate and non-retryable. No org
  // OAuth-policy link and no "try again" (retrying can't change the outcome).
  if (classification === 'DENIED') {
    return (
      <p className="rounded-lg border border-(--line) bg-(--surface) px-4 py-3 text-sm text-(--ink-2)">
        We couldn’t complete the claim for @{handle}. It may already be claimed, or its GitHub source
        no longer matches our records.
      </p>
    )
  }

  if (classification === 'NOT_ELIGIBLE') {
    return (
      <p className="rounded-lg border border-(--line) bg-(--surface) px-4 py-3 text-sm text-(--ink-2)">
        We couldn’t confirm you own or admin @{handle}’s source on GitHub. Claiming needs GitHub org
        owner or repo admin access on the source repo.
      </p>
    )
  }

  // INDETERMINATE — remediation, not a flat denial. A personal (User) source has no
  // org settings page, so the org-OAuth-policy link would 404: show a generic retry.
  if (result.ownerType === 'User') {
    return (
      <div className="space-y-2 rounded-lg border border-(--line) bg-(--surface) px-4 py-3 text-sm text-(--ink-2)">
        <p>We couldn’t verify your access right now.</p>
        <p>
          <AppLink
            href={claimStartHref(handle)}
            className="font-medium text-(--ink) underline underline-offset-2"
          >
            Try again
          </AppLink>
        </p>
      </div>
    )
  }

  // Organization (or unknown) source: third-party-app policy is the likely cause.
  const policyUrl = `https://github.com/orgs/${handle}/settings/oauth_application_policy`
  return (
    <div className="space-y-2 rounded-lg border border-(--line) bg-(--surface) px-4 py-3 text-sm text-(--ink-2)">
      <p>
        We couldn’t verify your access right now. Your org may restrict third-party apps.{' '}
        <AppLink
          href={policyUrl}
          className="font-medium text-(--ink) underline underline-offset-2"
        >
          approve Skillet in your org settings
        </AppLink>
        , then try again.
      </p>
      <p>
        <AppLink
          href={claimStartHref(handle)}
          className="font-medium text-(--ink) underline underline-offset-2"
        >
          Try again
        </AppLink>
      </p>
    </div>
  )
}
