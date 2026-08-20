'use client'

// Owner-facing proposal-pending notification (AC #1–#3).
//
// Mounted on the skill detail page. In the browser it asks the owner-authorized
// list endpoint whether this skill has pending proposals; if so it renders a
// notice with one entry per pending proposal that deep-links into the review
// surface. For anyone who is not the owner/teammate the endpoint
// answers 401/403 → the component renders nothing, so the public page is
// unchanged for visitors. Decided proposals drop out of the pending list, so
// the count and entries clear themselves once the owner approves/rejects.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  fetchSkillProposals,
  pendingOnly,
  reviewSurfaceHref,
  type ProposalsResult,
} from '@/lib/proposals'
import type { ProposalSummary } from '@/lib/types'
import { Eyebrow } from '@/components/ui/eyebrow'
import { PendingProposalsBadge } from './pending-proposals-badge'

type State =
  | { status: 'loading' }
  | { status: 'ready'; pending: ProposalSummary[] }
  /** Not the owner, signed out, or load failed — render nothing. */
  | { status: 'hidden' }

function toState(result: ProposalsResult): State {
  if (result.kind === 'ok') return { status: 'ready', pending: pendingOnly(result.proposals) }
  return { status: 'hidden' }
}

export function OwnerProposalAlerts({ author, slug }: { author: string; slug: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState({ status: 'loading' })
    fetchSkillProposals(author, slug, { signal: controller.signal })
      .then((result) => {
        if (active) setState(toState(result))
      })
      .catch(() => {
        if (active) setState({ status: 'hidden' })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [author, slug])

  // While loading we render nothing rather than a skeleton: this surface is
  // hidden for everyone except the owner, and the skill page is statically
  // generated, so a skeleton would ship into every public page's HTML and flash
  // for visitors before the fetch resolves to "not authorized". The notice
  // simply appears once an owner's pending proposals load.
  if (state.status === 'loading') return null

  // Hidden (not owner / load failed) and the owner-with-zero-pending case both
  // render nothing: there is nothing for the owner to act on.
  if (state.status === 'hidden' || state.pending.length === 0) return null

  // Own the section wrapper so the label and the pill appear together — and only
  // when there's something to review. The parent no longer renders a standalone
  // header that would otherwise dangle over empty space.
  return (
    <section className="py-4 first:pt-0">
      <Eyebrow>Pending review</Eyebrow>
      <div className="mt-3">
        <ProposalNotice author={author} slug={slug} pending={state.pending} />
      </div>
    </section>
  )
}

/**
 * Pure render of the pending-proposals affordance — exported for unit tests.
 *
 * A compact owner-only control that sits in the skill's action row (not a big
 * banner that dominates the page): one pill that links to the dedicated review
 * page and carries the count. When any pending change is quarantined or flagged
 * the pill turns loud so a risky change is never hidden behind a calm label.
 */
export function ProposalNotice({
  author,
  slug,
  pending,
}: {
  author: string
  slug: string
  pending: ProposalSummary[]
}) {
  const worst = pending.some((p) => p.scan.status === 'quarantined')
    ? 'danger'
    : pending.some((p) => p.scan.status === 'flagged' || p.scan.status === 'pending')
      ? 'warn'
      : 'ok'

  const tone =
    worst === 'danger'
      ? 'border-(--danger) text-(--danger) hover:bg-(--danger)/5'
      : worst === 'warn'
        ? 'border-(--warning-line) text-(--warning) hover:bg-(--warning-bg)'
        : 'border-(--accent) text-(--ink) hover:bg-(--accent-bg)'

  return (
    <span aria-label="Pending proposals">
      <Link
        href={reviewSurfaceHref(author, slug, pending[0]?.proposal_id)}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${tone}`}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
        {pending.length === 1 ? 'Review change' : 'Review changes'}
        <PendingProposalsBadge count={pending.length} />
        {worst === 'danger' && <span className="text-xs font-normal">· needs attention</span>}
      </Link>
    </span>
  )
}
