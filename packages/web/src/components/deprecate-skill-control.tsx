'use client'

// Owner-facing deprecate / restore control.
//
// Mounted on the skill detail page. It is the web action that replaces a
// delete button: an owner can soft-sunset a skill (unlist from the public
// directory, keep it for audit) and restore it later. There is deliberately NO
// delete control in v1.
//
// Visibility: the action is owner / org-admin only. For v1 personal skills the
// owner is "the signed-in handle equals the skill's author" — a dependency-free
// client signal. Org-admin deprecation of `@org/skill` lands later; the
// registry is the final authority either way and re-checks on every
// POST, so a non-owner who somehow reaches the action gets a 403 we surface as
// an error rather than a silent success. Everyone who is not the owner sees
// nothing, so the public skill page is unchanged for visitors.

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  deprecateSkill,
  undeprecateSkill,
  SkillLifecycleError,
  type SkillDeprecation,
} from '@/lib/deprecation'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DialogFooter } from '@/components/ui/dialog-footer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { DeprecatedBadge } from './deprecated-badge'

/** v1 ownership signal for button visibility — the server re-authorizes the action. */
export function isSkillOwner(handle: string | null | undefined, author: string): boolean {
  return Boolean(handle) && handle === author
}

export function DeprecateSkillControl({
  author,
  slug,
  initialDeprecated = false,
  initialMessage = null,
}: {
  author: string
  slug: string
  initialDeprecated?: boolean
  initialMessage?: string | null
}) {
  const { data: session, status } = useSession()

  // Render nothing until we know who the viewer is, and nothing at all for
  // non-owners — keeps the statically-generated public page free of any
  // owner-only chrome flashing in for visitors.
  if (status === 'loading') return null
  if (!isSkillOwner(session?.handle, author)) return null

  return (
    <DeprecateSkillPanel
      author={author}
      slug={slug}
      initialDeprecated={initialDeprecated}
      initialMessage={initialMessage}
    />
  )
}

type Phase = 'idle' | 'confirming' | 'submitting'

/**
 * The owner-only panel itself — exported (and owner-gated by the wrapper) so
 * tests can drive it without stubbing the auth session.
 */
export function DeprecateSkillPanel({
  author,
  slug,
  initialDeprecated = false,
  initialMessage = null,
}: {
  author: string
  slug: string
  initialDeprecated?: boolean
  initialMessage?: string | null
}) {
  const [state, setState] = useState<SkillDeprecation>({
    deprecated: initialDeprecated,
    message: initialMessage,
  })
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function confirmDeprecate() {
    setPhase('submitting')
    setError(null)
    try {
      const next = await deprecateSkill(author, slug, { message })
      setState(next)
      setPhase('idle')
      setMessage('')
    } catch (err) {
      setError(err instanceof SkillLifecycleError ? err.message : 'Something went wrong.')
      setPhase('confirming')
    }
  }

  async function restore() {
    setPhase('submitting')
    setError(null)
    try {
      const next = await undeprecateSkill(author, slug)
      setState(next)
      setPhase('idle')
    } catch (err) {
      setError(err instanceof SkillLifecycleError ? err.message : 'Something went wrong.')
      setPhase('idle')
    }
  }

  return (
    <section aria-label="Skill lifecycle" className="mt-2 border-t border-(--line) pt-6">
      {state.deprecated ? (
        <div>
          <DeprecatedBadge />
          <p className="mt-3 text-sm leading-[1.5] text-(--ink-2)">
            This skill is hidden from the public directory. Only you can see it here.
          </p>
          {state.message && (
            <p className="mt-2 rounded-md border border-(--line) bg-(--bg) px-3 py-2 text-sm leading-[1.5] text-(--ink-2)">
              {state.message}
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={restore}
            disabled={phase === 'submitting'}
            className="mt-3"
          >
            {phase === 'submitting' ? 'Restoring…' : 'Restore skill'}
          </Button>
        </div>
      ) : (
        <div>
          <h2 className="text-base font-semibold text-(--ink)">Deprecate this skill</h2>
          <p className="mt-1 text-sm leading-[1.5] text-(--ink-2)">
            Sunset the skill: it stays installed for existing users and visible to you, but
            disappears from the public directory. You can restore it later.
          </p>
          <Button
            type="button"
            variant="danger-secondary"
            onClick={() => {
              setError(null)
              setPhase('confirming')
            }}
            className="mt-3"
          >
            Deprecate
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-(--danger)">
          {error}
        </p>
      )}

      <ConfirmDeprecateModal
        open={phase !== 'idle' && !state.deprecated}
        author={author}
        slug={slug}
        message={message}
        setMessage={setMessage}
        submitting={phase === 'submitting'}
        onConfirm={confirmDeprecate}
        onCancel={() => {
          setPhase('idle')
          setError(null)
        }}
      />
    </section>
  )
}

function ConfirmDeprecateModal({
  open,
  author,
  slug,
  message,
  setMessage,
  submitting,
  onConfirm,
  onCancel,
}: {
  open: boolean
  author: string
  slug: string
  message: string
  setMessage: (v: string) => void
  submitting: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape / overlay click close the dialog — route through the same
        // cancel path, but never close mid-request.
        if (!next && !submitting) onCancel()
      }}
    >
      <DialogContent className="w-[min(92vw,480px)]" aria-describedby={undefined}>
        <DialogTitle className="text-lg font-semibold text-(--ink)">
          Deprecate @{author}/{slug}?
        </DialogTitle>
        <p className="mt-2 text-sm leading-[1.5] text-(--ink-2)">
          The skill will be removed from the public directory. Existing installs keep working and
          you can restore it anytime. This is not a delete.
        </p>

        <label htmlFor="deprecate-message" className="mt-4 block text-sm font-medium text-(--ink)">
          Message for the skill page <span className="font-normal text-(--ink-2)">(optional)</span>
        </label>
        <Textarea
          id="deprecate-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="e.g. Superseded by @acme/deploy-v2."
          className="mt-1.5 resize-y"
        />

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger-secondary"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? 'Deprecating…' : 'Deprecate skill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
