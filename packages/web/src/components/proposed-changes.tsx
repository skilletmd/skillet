'use client'

// Proposed-changes review surface — the owner's review-and-decide
// view on the skill detail page, wired to the merged proposal API.
//
// Mounted on the skill page, it runs in the browser with the session cookie. The
// list endpoint answers 401/403 for anyone who is not the owner/teammate, so for
// public visitors this renders nothing and the static page is unchanged. For an
// authorized owner with a pending proposal it shows the graded diff, the harm-
// scan verdict, the proposer identity + signature, and the decision actions.
//
// Security gate, mirrored from the server (which re-runs every check):
//   • harm scan `quarantined` → Approve HARD-blocked (server returns 422),
//   • harm scan `flagged`     → human-approvable; surfaced as a risk, Approve
//                               allowed but the confirm states the risk,
//   • scan still `pending`    → Approve held until the scan finishes,
//   • a stored proposal already passed signature verification at propose time
//     (presence == verified); Approve additionally needs the OWNER's Ed25519
//     signature over the proposed hash (always owner-key-signed).
//
// The section is anchored at PROPOSALS_ANCHOR (#proposed-changes) so the
// proposal notification deep-links straight onto it; an optional
// `?proposal=<id>` query focuses that specific proposal.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FileDiff } from '@/components/file-diff'
import { Panel } from '@/components/ui/panel'
import {
  fetchProposalDetail,
  fetchSkillProposals,
  pendingOnly,
  PROPOSALS_ANCHOR,
  ProposalDecisionError,
  submitProposalDecision,
  type DecisionResult,
} from '@/lib/proposals'
import { signContentHashForProposal } from '@/lib/proposal-signing'
import { pluralize } from '@/lib/format'
import { delegationErrorUX, isDelegationErrorCode } from '@/lib/delegation-errors'
import type { ProposalDetail, ProposalScanStatus, ProposalSummary } from '@/lib/types'
import { skillHref } from '@/lib/urls'
import { timeAgo } from '@/lib/feed-format'

type LoadState =
  /** Resolving authorization / which proposal to show. Renders nothing. */
  | { kind: 'init' }
  /** Authorized owner, no pending proposals — no action to show. */
  | { kind: 'empty' }
  /** Authorized, pending proposal selected, loading its detail. */
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; proposal: ProposalDetail; canDecide: boolean }
  /** Not the owner/teammate, or a list-level failure — render nothing. */
  | { kind: 'hidden' }

type ActionMode = 'idle' | 'confirm-approve' | 'confirm-reject'

/** Pick the proposal to review: the `?proposal=` one if pending, else most recent. */
function selectProposal(
  pending: ProposalSummary[],
  focusId: string | null,
): ProposalSummary | null {
  if (pending.length === 0) return null
  if (focusId) {
    const match = pending.find((p) => p.proposal_id === focusId)
    if (match) return match
  }
  return [...pending].sort((a, b) => b.created_at - a.created_at)[0]
}

export function ProposedChanges({
  author,
  slug,
  standalone = false,
}: {
  author: string
  slug: string
  /** On the dedicated /review page: show empty/no-access states + open the diff
   * by default. Inline (legacy) it stays silent unless there's something to act on. */
  standalone?: boolean
}) {
  const [state, setState] = useState<LoadState>({ kind: 'init' })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState({ kind: 'init' })

    // Read the optional ?proposal=<id> focus from the URL here (client-only) so
    // the component never calls useSearchParams — that would force the whole
    // statically generated skill page into a Suspense/dynamic deopt.
    const focusId = new URLSearchParams(window.location.search).get('proposal')

    ;(async () => {
      const list = await fetchSkillProposals(author, slug, { signal: controller.signal })
      if (!active) return
      if (list.kind === 'unauthorized' || list.kind === 'error') {
        setState({ kind: 'hidden' })
        return
      }
      const pending = pendingOnly(list.proposals)
      const head = selectProposal(pending, focusId)
      if (!head) {
        setState({ kind: 'empty' })
        return
      }
      setState({ kind: 'loading' })
      const detail = await fetchProposalDetail(author, slug, head.proposal_id, {
        signal: controller.signal,
      })
      if (!active) return
      if (detail.kind === 'ok') {
        // The registry says whether this viewer may decide (`can_decide`).
        // Fail closed: a missing field (dropped by a proxy/serializer) degrades
        // to the read-only view rather than showing actions the POST would 403.
        // Per-action invariants (e.g. a proposer can't approve their own
        // change) stay server-enforced — 403 backstop.
        setState({
          kind: 'loaded',
          proposal: detail.proposal,
          canDecide: detail.proposal.can_decide ?? false,
        })
      } else if (detail.kind === 'unauthorized') {
        setState({ kind: 'hidden' })
      } else if (detail.kind === 'notfound') {
        setState({ kind: 'empty' })
      } else {
        setState({ kind: 'error', message: 'Could not load the proposal detail.' })
      }
    })().catch(() => {
      if (active) setState({ kind: 'hidden' })
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [author, slug])

  // Init renders nothing everywhere. Inline (legacy) also stays silent for
  // not-owner / nothing-pending so the public skill page is unchanged; the
  // standalone /review page shows a friendly empty state instead.
  if (state.kind === 'init') return null
  if (!standalone && (state.kind === 'hidden' || state.kind === 'empty')) return null

  return (
    <div id={PROPOSALS_ANCHOR} className="scroll-mt-24">
      {state.kind === 'loading' && (
        <p className="text-sm text-(--ink-2)">Loading the proposed change…</p>
      )}
      {(state.kind === 'hidden' || state.kind === 'empty') && (
        <EmptyReview
          author={author}
          slug={slug}
          message={
            state.kind === 'hidden'
              ? "You don't have access to review changes for this skill."
              : 'No changes are waiting for your review.'
          }
        />
      )}
      {state.kind === 'error' && (
        <p
          role="alert"
          className="rounded-lg border border-(--danger-line) bg-(--danger-bg) px-4 py-3 text-sm text-(--danger)"
        >
          {state.message}
        </p>
      )}
      {state.kind === 'loaded' && (
        <ProposalReview
          author={author}
          slug={slug}
          proposal={state.proposal}
          canDecide={state.canDecide}
          defaultOpenDiff={standalone}
        />
      )}
    </div>
  )
}

function EmptyReview({ author, slug, message }: { author: string; slug: string; message: string }) {
  return (
    <Panel padding="none" className="px-6 py-12 text-center">
      <p className="text-sm text-(--ink-2)">{message}</p>
      <Link
        href={skillHref(author, slug)}
        className="mt-3 inline-block text-sm text-(--accent) hover:underline"
      >
        ← Back to the skill
      </Link>
    </Panel>
  )
}

function ProposalReview({
  author,
  slug,
  proposal,
  canDecide,
  defaultOpenDiff = false,
}: {
  author: string
  slug: string
  proposal: ProposalDetail
  canDecide: boolean
  /** Open the change preview immediately (the dedicated review page). */
  defaultOpenDiff?: boolean
}) {
  const [mode, setMode] = useState<ActionMode>('idle')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [result, setResult] = useState<DecisionResult | null>(null)
  // Mount-time clock so SSR/CSR stay consistent and the value doesn't churn.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [])

  const scan = proposal.scan.status
  const quarantined = scan === 'quarantined'
  const flagged = scan === 'flagged'
  const scanPending = scan === 'pending'
  const signed = proposal.signature != null

  // Server hard-blocks publishing a quarantined or unsigned bundle, and the scan
  // must have finished. `flagged` is human-approvable, so it does NOT block.
  const approveBlocked = quarantined || scanPending || !signed
  const blockReason = !signed
    ? "This change can't be verified, so it can't be published."
    : quarantined
      ? 'The security check blocked this change, so it can’t be published.'
      : scanPending
        ? 'The security check is still running. Approve unlocks when it finishes.'
        : null

  async function submit(decision: 'approve' | 'reject') {
    setSubmitting(true)
    setActionError(null)
    try {
      // Approve needs the owner's Ed25519 signature over the proposed hash.
      const contentHash = proposal.proposed_hash.startsWith('sha256:')
        ? proposal.proposed_hash
        : `sha256:${proposal.proposed_hash}`
      const res = await submitProposalDecision(author, slug, proposal.proposal_id, decision, {
        ...(decision === 'approve'
          ? { signature: await signContentHashForProposal(contentHash) }
          : {}),
      })
      setResult(res)
    } catch (err: unknown) {
      // A device-keyed approval can fail with a 422 delegation code — surface the
      // re-enroll / scope guidance instead of the terse server message (§4.2.5).
      const message =
        err instanceof ProposalDecisionError && isDelegationErrorCode(err.code)
          ? delegationErrorUX(err.code).message
          : err instanceof ProposalDecisionError
            ? err.message
            : 'Could not submit the decision.'
      setActionError(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    if (result.state === 'approved') {
      return (
        <SuccessNotice>
          Published. Everyone who installed this skill gets the update.{' '}
          <Link
            href={skillHref(author, slug)}
            className="font-medium text-(--accent) underline underline-offset-2 hover:text-(--ink)"
          >
            View skill
          </Link>
        </SuccessNotice>
      )
    }
    return <SuccessNotice>Proposal rejected.</SuccessNotice>
  }

  return (
    <div className="space-y-6">
      {/* Proposal header — who, when, is it safe, then the decision. */}
      <Panel>
        <div className="flex items-center gap-3">
          <Avatar name={proposal.proposer.handle} />
          <div className="min-w-0">
            <p className="text-base text-(--ink)">
              <span className="font-semibold">{proposal.proposer.handle}</span>{' '}
              <span className="text-(--ink-2)">wants to update this skill</span>
            </p>
            {now != null && (
              <p className="text-sm text-(--ink-2)">{timeAgo(proposal.created_at, { suffix: true })}</p>
            )}
          </div>
        </div>

        <SafetyLine scan={scan} signed={signed} findings={proposal.scan.findings_summary ?? null} />

        {/* Decision affordances, pinned above the diff. */}
        {canDecide ? (
          <div className="mt-5">
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="primary"
                disabled={approveBlocked || submitting}
                onClick={() => setMode('confirm-approve')}
                title={blockReason ?? undefined}
              >
                Approve &amp; publish
              </Button>
              <Button
                type="button"
                variant="danger-secondary"
                disabled={submitting}
                onClick={() => setMode('confirm-reject')}
              >
                Reject
              </Button>
            </div>

            {approveBlocked && blockReason && (
              <p className="mt-3 text-sm text-(--ink-2)">{blockReason}</p>
            )}

            {mode === 'confirm-approve' && !approveBlocked && (
              <InlineConfirm
                prompt={
                  <>
                    Publish this change? It becomes the current version, and everyone who
                    installed this skill gets the update.
                    {flagged
                      ? ' The security check flagged something, so you are approving it anyway.'
                      : ''}
                  </>
                }
                confirmLabel="Publish"
                busy={submitting}
                onConfirm={() => submit('approve')}
                onCancel={() => setMode('idle')}
              />
            )}

            {mode === 'confirm-reject' && (
              <InlineConfirm
                prompt="Reject this proposal? This cannot be undone."
                confirmLabel="Reject proposal"
                destructive
                busy={submitting}
                onConfirm={() => submit('reject')}
                onCancel={() => setMode('idle')}
              />
            )}

            {actionError && (
              <p role="alert" className="mt-3 text-sm text-(--danger)">
                {actionError}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-5 text-sm text-(--ink-2)">
            Only the skill owner can decide this proposal. You&apos;re viewing it read-only.
          </p>
        )}
      </Panel>

      {/* What actually changed — opened by default on the review page. */}
      <div>
        <p className="text-sm font-medium text-(--ink)">What changed</p>
        <div className="mt-3">
          <FileDiff files={proposal.diff} defaultExpanded={defaultOpenDiff} />
        </div>
      </div>
    </div>
  )
}

/**
 * One plain-language safety line — folds the signature + scan checks into a
 * single sentence a non-technical owner can act on. No hashes, no key ids.
 */
function SafetyLine({
  scan,
  signed,
  findings,
}: {
  scan: ProposalScanStatus
  signed: boolean
  findings: { total: number; highest_confidence?: string | null } | null
}) {
  const count = findings && findings.total > 0 ? findings.total : 0
  const countText = count
    ? `${count} ${pluralize(count, 'thing')} to look at${
        findings?.highest_confidence ? ` · highest confidence: ${findings.highest_confidence}` : ''
      }`
    : null

  let tone: 'ok' | 'warn' | 'bad' = 'ok'
  let title = 'Looks safe. Passed the security check.'
  if (!signed) {
    tone = 'bad'
    title = "Can't be verified, so this change can't be published."
  } else if (scan === 'quarantined') {
    tone = 'bad'
    title = 'Blocked. The security check found a serious problem.'
  } else if (scan === 'flagged') {
    tone = 'warn'
    title = 'Worth a look. The security check flagged something.'
  } else if (scan === 'pending') {
    tone = 'warn'
    title = 'Running a quick security check…'
  }

  const toneClass =
    tone === 'ok'
      ? 'border-(--success-line) bg-(--success-bg) text-(--success)'
      : tone === 'warn'
        ? 'border-(--warning-line) bg-(--warning-bg) text-(--warning)'
        : 'border-(--danger-line) bg-(--danger-bg) text-(--danger)'

  return (
    <div
      role={tone === 'ok' ? undefined : 'alert'}
      className={`mt-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${toneClass}`}
    >
      <span aria-hidden="true" className="mt-px shrink-0 font-semibold">
        {tone === 'ok' ? '✓' : tone === 'warn' ? '!' : '✕'}
      </span>
      <span>
        {title}
        {countText && <span className="block opacity-90">{countText}</span>}
      </span>
    </div>
  )
}

function InlineConfirm({
  prompt,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  prompt: React.ReactNode
  confirmLabel: string
  destructive?: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="mt-4 rounded-lg border border-(--line) bg-(--accent-bg)/30 px-4 py-3">
      <p className="text-sm text-(--ink-2)">{prompt}</p>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-(--bg) disabled:opacity-50 ${
            destructive ? 'bg-(--danger)' : 'bg-(--accent)'
          }`}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function SuccessNotice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-(--accent)/40 bg-(--accent-bg) px-4 py-3 text-sm text-(--ink)"
    >
      {children}
    </p>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 items-center justify-center rounded-full bg-(--line) text-xs font-semibold text-(--ink-2)"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
