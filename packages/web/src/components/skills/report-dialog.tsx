'use client'

// Abuse-report dialog, mounted at the foot of every skill page.
//
// Signed-in viewers get a form (category + optional reason); the copyright
// branch adds an ownership acknowledgement and points to the formal DMCA
// policy. Anonymous viewers get a sign-in prompt instead — the registry
// enforces the session gate regardless, this is just the friendlier path.
//
// The trigger + wrapper are split from the exported `ReportDialogForm` so tests
// can drive the form without stubbing the auth session.

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppLink } from '@/components/app-link'
import { loginHref } from '@/lib/urls'
import { Dialog, DialogContent, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { DialogFooter } from '@/components/ui/dialog-footer'
// The form uses plain headings/buttons (no Radix Dialog context) so it renders
// and tests standalone; the wrapper below supplies the Dialog + Portal.
import { Button } from '@/components/ui/button'
import { Select, Textarea, FieldLabel } from '@/components/ui/input'
import { REPORT_CATEGORIES, submitReport, ReportError, type ReportCategory } from '@/lib/report'

const TRIGGER_CLASS = 'hover:text-(--ink) transition-colors'

export function ReportDialog({
  author,
  slug,
  label = 'Report it',
}: {
  author: string
  slug: string
  label?: string
}) {
  const { status } = useSession()
  const authed = status === 'authenticated'

  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button type="button" className={TRIGGER_CLASS} onClick={() => setOpen(true)}>
        {label}
      </button>
      <DialogContent aria-label={`Report ${author}/${slug}`}>
        {authed ? (
          <ReportDialogForm
            author={author}
            slug={slug}
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        ) : (
          <SignInPrompt author={author} slug={slug} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SignInPrompt({ author, slug }: { author: string; slug: string }) {
  return (
    <div>
      <DialogTitle className="text-lg font-semibold text-(--ink)">Report this skill</DialogTitle>
      <p className="mt-2 text-sm text-(--ink-2)">
        You need to be signed in to report a skill.
      </p>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost" size="sm" type="button">
            Cancel
          </Button>
        </DialogClose>
        <AppLink href={loginHref(`/${author}/${slug}`)}>
          <Button variant="primary" size="sm" type="button">
            Sign in
          </Button>
        </AppLink>
      </DialogFooter>
    </div>
  )
}

type Phase = 'idle' | 'submitting' | 'done'

export function ReportDialogForm({
  author,
  slug,
  onDone,
  onCancel,
}: {
  author: string
  slug: string
  onDone?: () => void
  onCancel?: () => void
}) {
  const [category, setCategory] = useState<ReportCategory | ''>('')
  const [reason, setReason] = useState('')
  const [ownership, setOwnership] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const isCopyright = category === 'copyright'
  const isOther = category === 'other'
  const canSubmit =
    category !== '' &&
    phase !== 'submitting' &&
    (!isOther || reason.trim().length > 0) &&
    (!isCopyright || ownership)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (category === '' || !canSubmit) return
    setPhase('submitting')
    setError(null)
    try {
      await submitReport(author, slug, {
        category,
        reason,
        claimsOwnership: isCopyright ? ownership : undefined,
      })
      setPhase('done')
    } catch (err) {
      setPhase('idle')
      setError(err instanceof ReportError ? err.message : 'Something went wrong. Try again.')
    }
  }

  if (phase === 'done') {
    return (
      <div>
        <h2 className="text-lg font-semibold text-(--ink)">Report received</h2>
        <p className="mt-2 text-sm text-(--ink-2)">
          Thanks. Our team will review it. Enforcement actions show up on the public{' '}
          <AppLink href="/moderation" className="underline">
            moderation log
          </AppLink>
          .
        </p>
        <DialogFooter>
          <Button variant="primary" size="sm" type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-lg font-semibold text-(--ink)">Report this skill</h2>
      <p className="mt-1 text-sm text-(--ink-2)">
        Reports are private. Tell us what’s wrong with{' '}
        <span className="font-medium text-(--ink)">
          {author}/{slug}
        </span>
        .
      </p>

      <div className="mt-4 space-y-4">
        <label className="block space-y-1.5">
          <FieldLabel>Reason</FieldLabel>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as ReportCategory)}
            required
          >
            <option value="" disabled>
              Choose a reason…
            </option>
            {REPORT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>

        {isCopyright && (
          <div className="rounded-lg border border-(--line) bg-(--accent-bg) p-3 text-sm text-(--ink-2)">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={ownership}
                onChange={(e) => setOwnership(e.target.checked)}
                className="mt-0.5"
              />
              <span>I’m the copyright owner or authorized to act on their behalf.</span>
            </label>
            <p className="mt-2 text-(--ink-3)">
              For a formal DMCA notice, see our{' '}
              <AppLink href="/legal/dmca" className="underline">
                copyright policy
              </AppLink>
              .
            </p>
          </div>
        )}

        <label className="block space-y-1.5">
          <FieldLabel>Details {isOther ? '(required)' : '(optional)'}</FieldLabel>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            placeholder={
              isCopyright
                ? 'Link to the original work you own, and what was copied.'
                : 'What’s wrong with this skill?'
            }
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-(--danger)">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={!canSubmit}>
          {phase === 'submitting' ? 'Sending…' : 'Send report'}
        </Button>
      </DialogFooter>
    </form>
  )
}
