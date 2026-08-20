'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createTeamAction, type CreateTeamState } from '@/app/(consumer)/settings/teams/actions'
import { slugifyTeam } from '@/lib/team-slug'
import { Button } from '@/components/ui/button'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} variant="primary" className="mt-6">
      {pending ? 'Creating…' : 'Create team'}
    </Button>
  )
}

export function CreateTeamForm() {
  const [state, action] = useActionState<CreateTeamState, FormData>(createTeamAction, {})
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  // Show the slug the server will derive so the URL isn't a surprise.
  const slugPreview = slugifyTeam(slug || name)

  return (
    <form action={action} className="mt-8 max-w-md">
      {state.error && (
        <p
          role="alert"
          className="mb-5 rounded-lg border border-(--danger-line)/50 bg-(--danger-bg) px-4 py-3 text-sm text-(--danger)"
        >
          {state.error}
        </p>
      )}

      <label className="block">
        <span className="text-sm font-medium text-(--ink)">Team name</span>
        <span className="ui-input-shell mt-1.5">
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="off"
            placeholder="Acme Skills"
            className="min-w-0 flex-1 bg-transparent text-(--ink) outline-none placeholder:text-(--ink-2)/60"
          />
        </span>
      </label>

      <label className="mt-5 block">
        <span className="text-sm font-medium text-(--ink)">
          Team URL <span className="font-normal text-(--ink-2)">(optional)</span>
        </span>
        <span className="ui-input-shell mt-1.5">
          <input
            name="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            autoComplete="off"
            placeholder={slugPreview || 'acme-skills'}
            className="min-w-0 flex-1 bg-transparent text-(--ink) outline-none placeholder:text-(--ink-2)/60"
          />
        </span>
        {slugPreview && (
          <span className="mt-1.5 block font-mono text-xs text-(--ink-2)">
            https://skillet.md/{slugPreview}
          </span>
        )}
      </label>

      <SubmitButton />
    </form>
  )
}
