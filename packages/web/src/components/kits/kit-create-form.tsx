'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { SkillIcon } from '@/components/directory-card'
import { humanizeSlug } from '@/components/skill-card'
import { KitSkillPicker, type PickerSkill } from '@/components/kits/kit-skill-picker'
import { Panel } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { Input, Textarea, FieldLabel } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { PublishAsControl, type PublishAsTarget } from '@/components/publish-as-control'
import { registryAuthApi } from '@/lib/registry-proxy'
import { kitHref, kitHrefFromRecord } from '@/lib/urls'
import type { KitVisibility } from '@/lib/kits'

export type { PickerSkill } from '@/components/kits/kit-skill-picker'

/** Derive a kit name from the staged skills when the curator hasn't typed one.
 *  Uses the dominant author so a Cloudflare-heavy kit suggests "Cloudflare essentials". */
function suggestName(staged: readonly PickerSkill[]): string {
  if (staged.length === 0) return ''
  const counts = new Map<string, number>()
  for (const s of staged) counts.set(s.author, (counts.get(s.author) ?? 0) + 1)
  let top = staged[0].author
  let best = 0
  for (const [author, n] of counts) {
    if (n > best) {
      best = n
      top = author
    }
  }
  return `${humanizeSlug(top)} essentials`
}

export function KitCreateForm({
  mySkills = [],
  savedSkills = [],
  popularSkills = [],
  publishTargets = [],
  sessionHandle = null,
  initialAuthor = null,
}: {
  mySkills?: readonly PickerSkill[]
  savedSkills?: readonly PickerSkill[]
  popularSkills?: readonly PickerSkill[]
  /** Who the user can publish under (self + admin teams). >1 shows the picker. */
  publishTargets?: PublishAsTarget[]
  /** The signed-in user's own handle, to tell a personal kit from a team kit. */
  sessionHandle?: string | null
  /** Preselected owner (e.g. from ?team=); defaults to the user's own handle. */
  initialAuthor?: string | null
}) {
  const router = useRouter()
  // Who the kit is created under — yourself or a team you admin. Sent as `owner`
  // only when it's a team (the registry re-checks admin via canAdminOrgAuthor).
  const [selectedAuthor, setSelectedAuthor] = useState(initialAuthor ?? sessionHandle ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [descOpen, setDescOpen] = useState(false)
  const [visibility, setVisibility] = useState<KitVisibility>('public')
  // Insertion-keyed so add/remove is O(1) and dedup is free.
  const [staged, setStaged] = useState<Map<string, PickerSkill>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const stagedList = useMemo(() => [...staged.values()], [staged])
  const stagedIds = useMemo(() => [...staged.keys()], [staged])
  // A public kit can't carry private skills. You can stage them while the kit is
  // private, but flipping back to public marks them as won't-be-added.
  const incompatibleIds = useMemo(
    () =>
      new Set(
        stagedList
          .filter((s) => visibility === 'public' && s.visibility === 'private')
          .map((s) => s.skill_id),
      ),
    [stagedList, visibility],
  )
  const suggested = useMemo(() => suggestName(stagedList), [stagedList])
  // Typed name wins; otherwise the suggestion from your skills; the placeholder
  // shows whichever would be used, so naming is optional.
  const effectiveName = name.trim() || suggested

  const addSkill = useCallback((skill: PickerSkill) => {
    setStaged((prev) => {
      if (prev.has(skill.skill_id)) return prev
      const next = new Map(prev)
      next.set(skill.skill_id, skill)
      return next
    })
  }, [])

  const removeSkill = useCallback((skillId: string) => {
    setStaged((prev) => {
      if (!prev.has(skillId)) return prev
      const next = new Map(prev)
      next.delete(skillId)
      return next
    })
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const finalName = effectiveName || 'Untitled kit'
    setError(null)
    setPending(true)
    try {
      const res = await fetch(registryAuthApi('kits'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          name: finalName,
          description: description.trim() || null,
          visibility,
          ...(selectedAuthor && selectedAuthor !== sessionHandle
            ? { owner: selectedAuthor }
            : {}),
        }),
      })
      const payload = (await res.json().catch(() => null)) as {
        id?: string
        owner?: string
        slug?: string
        error?: string
        message?: string
      } | null
      if (!res.ok || !payload?.id) {
        setError(payload?.message ?? payload?.error ?? 'Could not create kit')
        return
      }
      const kitId = payload.id

      // Seed the staged skills into the freshly created kit, skipping any that
      // are incompatible with the kit's visibility (the registry would reject
      // them anyway). Failures are non-fatal — the kit exists.
      const toSeed = stagedList.filter((s) => !incompatibleIds.has(s.skill_id))
      if (toSeed.length > 0) {
        await Promise.allSettled(
          toSeed.map((s) =>
            fetch(registryAuthApi(`kits/${kitId}/skills`), {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ author: s.author, slug: s.slug }),
            }),
          ),
        )
      }

      // Reset before navigating so the form is empty if the browser later restores
      // this page from bfcache (Back button) instead of remounting it fresh.
      setName('')
      setDescription('')
      setDescOpen(false)
      setStaged(new Map())
      setVisibility('public')
      setError(null)

      // Land on the kit's own page — the page IS the confirmation, same as
      // publishing a skill lands you on the skill page.
      router.push(
        payload.owner && payload.slug
          ? kitHref(payload.owner, payload.slug)
          : kitHrefFromRecord({ id: kitId }),
      )
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  const count = stagedList.length

  return (
    <form onSubmit={onSubmit} className="mt-4">
      {/* Name + description — on a surface like every other section, never floating
          on the page background. */}
      <Panel padding="sm">
        <FieldLabel className="mb-1.5 block">Kit name</FieldLabel>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggested || 'Name your kit'}
          maxLength={64}
          aria-label="Kit name"
        />
        {descOpen ? (
          <div className="mt-4">
            <FieldLabel className="mb-1.5 block">Description</FieldLabel>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this kit is for (optional)"
              autoFocus
              aria-label="Kit description"
              className="min-h-[72px] resize-y leading-relaxed"
            />
          </div>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setDescOpen(true)} className="mt-2">
            + Add description
          </Button>
        )}
      </Panel>

      {/* Find skills — the picker. */}
      <Panel padding="sm" className="mt-6">
        <FieldLabel className="mb-3 block">Find skills</FieldLabel>
        <KitSkillPicker
          existingSkillIds={stagedIds}
          mySkills={mySkills}
          savedSkills={savedSkills}
          popularSkills={popularSkills}
          kitVisibility={visibility}
          onAdd={addSkill}
        />
      </Panel>

      {/* In this kit — always present so the box doesn't pop in on first add. */}
      <Panel padding="sm" className="mt-4">
        <FieldLabel className="block">
          In this kit <span className="font-normal normal-case tracking-normal">({count})</span>
        </FieldLabel>
        <div className="mt-3 min-h-[1.875rem]">
          {count === 0 ? (
            <p className="text-sm text-(--ink-2)">No skills yet. Add them from the list above.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {stagedList.map((s) => {
                const blocked = incompatibleIds.has(s.skill_id)
                return (
                  <li
                    key={s.skill_id}
                    title={
                      blocked ? "Private: won't be added while this kit is public." : undefined
                    }
                    className={`kit-chip-in flex items-center gap-2 rounded-full border border-(--line) bg-(--bg) py-1 pl-1.5 pr-1 ${
                      blocked ? 'opacity-50' : ''
                    }`}
                  >
                    <span className="relative h-5 w-5 shrink-0" aria-hidden="true">
                      <SkillIcon
                        seed={`${s.author}/${s.slug}`}
                        category={s.category}
                        radius="rounded-md"
                      />
                    </span>
                    <span className="text-sm font-medium text-(--ink)">{humanizeSlug(s.slug)}</span>
                    <button
                      type="button"
                      onClick={() => removeSkill(s.skill_id)}
                      aria-label={`Remove ${humanizeSlug(s.slug)}`}
                      className="flex h-5 w-5 items-center justify-center rounded-full text-(--ink-2) transition-colors hover:bg-(--surface) hover:text-(--ink)"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M3 3l6 6M9 3l-6 6"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {incompatibleIds.size > 0 && (
          <p className="mt-3 text-sm text-(--ink-2)">
            {incompatibleIds.size === 1
              ? "1 private skill won't be added because this kit is public."
              : `${incompatibleIds.size} private skills won't be added because this kit is public.`}
          </p>
        )}
      </Panel>

      {error && <p className="mt-4 text-sm text-(--danger)">{error}</p>}

      {/* Action bar — solid and aligned; visibility on the left, Create on the right. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-(--line) pt-4">
        <PublishAsControl
          targets={publishTargets}
          value={selectedAuthor}
          onChange={setSelectedAuthor}
        />
        <div className="flex items-center gap-3">
          <SegmentedControl
            options={[
              { value: 'public', label: 'Public' },
              { value: 'private', label: 'Private' },
            ]}
            value={visibility}
            onChange={setVisibility}
            ariaLabel="Kit visibility"
          />
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create kit'}
          </Button>
        </div>
      </div>
    </form>
  )
}
