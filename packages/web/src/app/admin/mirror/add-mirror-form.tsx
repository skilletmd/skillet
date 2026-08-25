'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? 'Screening…' : 'Add'}
    </Button>
  )
}

/**
 * Paste a GitHub URL to queue a repo.
 *
 * Client-side only for the result line: the screen takes a couple of GitHub
 * round trips, so the button has to say it is working, and the outcome ("added,
 * awaiting review" vs "failed the screen") is worth reading rather than
 * inferring from a list that silently grew by one.
 *
 * Submitting is not approving. The row lands as pending with the same notes a
 * discovered candidate carries, and approve still re-screens against live
 * GitHub before anything syncs.
 */
export function AddMirrorForm({
  action,
}: {
  action: (prev: string | null, form: FormData) => Promise<string | null>
}) {
  const [message, formAction] = useActionState(action, null)
  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          type="url"
          name="url"
          required
          placeholder="https://github.com/owner/repo"
          className="min-w-0 flex-1 rounded-lg border border-(--line) bg-(--surface) px-3 py-2 text-sm text-(--ink) placeholder:text-(--ink-2) focus:border-(--ink-2) focus:outline-none"
        />
        <Submit />
      </form>
      {message && <p className="mt-2 text-sm text-(--ink-2)">{message}</p>}
    </div>
  )
}
