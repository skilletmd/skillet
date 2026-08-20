'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { KitSkillPicker, type PickerSkill } from '@/components/kits/kit-skill-picker'
import { LinkedKitSourcePanel } from '@/components/kits/linked-kit-source-panel'
import { SkillIcon } from '@/components/directory-card'
import { Panel } from '@/components/ui/panel'
import { humanizeSlug } from '@/components/skill-card'
import { KitCoverStack } from '@/components/kit-card'
import { PrivateMark } from '@/components/visibility-badge'
import { BadgeSnippet } from '@/components/badge-snippet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { registryAuthApi } from '@/lib/registry-proxy'
import { slugify } from '@/lib/slugify'
import type { KitPayload, KitVersionEntry } from '@/lib/kits'
import { useBfcacheRestore } from '@/lib/use-bfcache-restore'
import { kitHref, skillHref } from '@/lib/urls'
import { formatShortDate } from '@/lib/feed-format'

export function KitDetailClient({
  kit,
  canEdit,
  origin,
  mySkills = [],
  savedSkills = [],
  popularSkills = [],
}: {
  kit: KitPayload
  canEdit: boolean
  /** Absolute site origin, for the README badge snippet. */
  origin: string
  /** The curator's own + saved + popular skills, for the picker's browse tabs. */
  mySkills?: readonly PickerSkill[]
  savedSkills?: readonly PickerSkill[]
  popularSkills?: readonly PickerSkill[]
}) {
  const router = useRouter()
  const [name, setName] = useState(kit.name)
  const [visibility, setVisibility] = useState(kit.visibility)
  const [showOnProfile, setShowOnProfile] = useState(!kit.profile_hidden)
  const [description, setDescription] = useState(kit.description ?? '')
  // Membership is staged locally like the identity fields — add/remove only
  // touch this list; nothing persists until Save. `save()` diffs it against the
  // server set and commits the difference.
  const [skills, setSkills] = useState(kit.skills)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set when a Save would take a subscribed public kit private; holds the save
  // until the curator confirms they understand the consequences.
  const [confirmPrivate, setConfirmPrivate] = useState(false)
  const [versions, setVersions] = useState<KitVersionEntry[] | null>(null)
  // A deliberately subscribed kit defaults to auto-apply; null means "no
  // explicit preference", which resolves to auto.
  const [trustMode, setTrustMode] = useState<'auto' | 'gate'>(kit.subscription_trust_mode ?? 'auto')
  // Optional release note for the version a public Save publishes. Empty = use
  // the auto-suggested note (shown as the placeholder).
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(registryAuthApi(`kits/${kit.id}/versions`), {
          headers: { accept: 'application/json' },
        })
        if (!res.ok) return
        const payload = (await res.json().catch(() => null)) as {
          versions?: KitVersionEntry[]
        } | null
        if (!cancelled) setVersions(payload?.versions ?? [])
      } catch {
        /* changelog is non-critical; leave it unshown on failure */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [kit.id, busy])

  // Server state is the source of truth for the editable fields: re-sync whenever
  // a router.refresh() delivers changed values (a discard, or an edit from another
  // tab). Deps are the server values themselves, so in-progress local edits — which
  // don't change them — are never clobbered.
  useEffect(() => {
    setName(kit.name)
    setDescription(kit.description ?? '')
    setVisibility(kit.visibility)
    setShowOnProfile(!kit.profile_hidden)
    setConfirmPrivate(false)
  }, [kit.name, kit.description, kit.visibility, kit.profile_hidden])

  // Re-sync the working skill list when the server set changes (a save, or an
  // edit from another tab). Keyed on the id signature so local staging isn't
  // clobbered mid-edit.
  const serverSkillKey = kit.skills.map((s) => s.skill_id).join(',')
  useEffect(() => {
    setSkills(kit.skills)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSkillKey])

  // A bfcache restore (browser back/forward) resurrects the page exactly as it
  // was left — including abandoned, unsaved edits. Drop them and re-pull the
  // server state so the page shows what's actually saved.
  useBfcacheRestore(() => {
    setName(kit.name)
    setDescription(kit.description ?? '')
    setVisibility(kit.visibility)
    setShowOnProfile(!kit.profile_hidden)
    setSkills(kit.skills)
    setConfirmPrivate(false)
    setBusy(null)
    router.refresh()
  })

  const subscriberCount = kit.subscriber_count ?? 0
  // Taking a subscribed public kit private is consequential — confirm first.
  const needsPrivateConfirm =
    visibility === 'private' && kit.visibility === 'public' && subscriberCount > 0

  // A kit holding private skills can't go public (the registry rejects it).
  // Count the WORKING set (staged adds included) so the conflict shows before
  // Save, not at publish: disable the Public toggle up front, and if the kit is
  // already public, block Save until it's resolved.
  const privateSkillCount = skills.filter((s) => s.visibility === 'private').length
  const publicBlocked = privateSkillCount > 0 && visibility !== 'public'
  const publicConflict = privateSkillCount > 0 && visibility === 'public'

  // The identity is editable inline (like create); "Save changes" is enabled only
  // when something actually changed. Publishing a version stays a separate,
  // deliberate step in the Unpublished changes panel below.
  const metaDirty =
    name !== kit.name ||
    description !== (kit.description ?? '') ||
    visibility !== kit.visibility ||
    showOnProfile !== !kit.profile_hidden

  // Staged membership diff vs the server set — what Save will commit.
  const serverIds = new Set(kit.skills.map((s) => s.skill_id))
  const localIds = new Set(skills.map((s) => s.skill_id))
  const addedIds = skills.filter((s) => !serverIds.has(s.skill_id)).map((s) => s.skill_id)
  // Skills staged for removal — kept around (not just filtered out) so they can
  // render struck-through with a Restore, making the pending change legible.
  const removedEntries = kit.skills.filter((s) => !localIds.has(s.skill_id))
  const removedIds = removedEntries.map((s) => s.skill_id)
  const membershipDirty = addedIds.length > 0 || removedIds.length > 0
  const dirty = metaDirty || membershipDirty

  // Stable render order: each server skill keeps its original slot (shown struck
  // if staged for removal), then newly added skills append at the end — so
  // removing an existing skill flips it in place instead of jumping to the bottom.
  const orderedRows: Array<{
    s: (typeof skills)[number]
    state: 'unchanged' | 'added' | 'removed'
  }> = [
    ...kit.skills.map((s) => ({
      s,
      state: localIds.has(s.skill_id) ? ('unchanged' as const) : ('removed' as const),
    })),
    ...skills.filter((s) => !serverIds.has(s.skill_id)).map((s) => ({ s, state: 'added' as const })),
  ]

  // A linked kit mirrors a repo: its skill set is reconciled on every pull, so
  // the owner can't add/remove skills here (name/description stay editable).
  // Unlink to take ownership and edit the contents in Skillet.
  const isLinked = kit.source_type === 'linked' || !!kit.source
  const canEditSkills = canEdit && !isLinked

  // One commit for the whole editor: staged skills + identity, then (for a
  // public kit) a published version. No separate Save vs Publish.
  async function save() {
    if (needsPrivateConfirm && !confirmPrivate) {
      setConfirmPrivate(true)
      return
    }
    setError(null)
    setBusy('save')
    try {
      // Commit staged membership: removals first, then additions.
      for (const id of removedIds) {
        const [a, s] = id.split(':')
        const res = await fetch(
          registryAuthApi(
            `kits/${kit.id}/skills/${encodeURIComponent(a)}/${encodeURIComponent(s)}`,
          ),
          { method: 'DELETE', headers: { accept: 'application/json' } },
        )
        if (!res.ok) {
          setError('Could not remove a skill')
          return
        }
      }
      for (const id of addedIds) {
        const [a, s] = id.split(':')
        const res = await fetch(registryAuthApi(`kits/${kit.id}/skills`), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ author: a, slug: s }),
        })
        if (!res.ok) {
          // Surface the registry's reason (e.g. a private skill can't go in a
          // public kit) rather than a generic, easily-missed message.
          const payload = (await res.json().catch(() => null)) as {
            message?: string
            error?: string
          } | null
          setError(payload?.message ?? payload?.error ?? 'Could not add a skill')
          return
        }
      }
      // Identity (name / description / visibility / profile) — applied live.
      if (metaDirty) {
        const res = await fetch(registryAuthApi(`kits/${kit.id}`), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            name: name.trim() || kit.name,
            description: description.trim() || null,
            visibility,
            profile_hidden: !showOnProfile,
          }),
        })
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { message?: string } | null
          setError(payload?.message ?? 'Could not update kit')
          return
        }
      }
      // A public kit releases the change as a version so subscribers get it; a
      // private kit has no audience, so the draft edits above are the whole save.
      if (visibility === 'public' && membershipDirty) {
        const res = await fetch(registryAuthApi(`kits/${kit.id}/publish`), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ note: note.trim() || suggestedNote }),
        })
        if (!res.ok) {
          setError('Saved, but could not publish the new version')
          return
        }
      }
      setNote('')
      setConfirmPrivate(false)
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  // Throw away staged edits and snap back to the server state — all client-side,
  // since nothing was persisted.
  function discard() {
    setError(null)
    setName(kit.name)
    setDescription(kit.description ?? '')
    setVisibility(kit.visibility)
    setShowOnProfile(!kit.profile_hidden)
    setSkills(kit.skills)
    setNote('')
    setConfirmPrivate(false)
  }

  async function saveTrust(mode: 'auto' | 'gate') {
    const prev = trustMode
    setError(null)
    setBusy('trust')
    setTrustMode(mode)
    try {
      const res = await fetch(registryAuthApi(`kits/${kit.id}/subscribe`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ trust_mode: mode }),
      })
      if (!res.ok) {
        setTrustMode(prev)
        setError('Could not update update-trust preference')
      }
    } catch {
      setTrustMode(prev)
      setError('Could not update update-trust preference')
    } finally {
      setBusy(null)
    }
  }

  // Add/remove only stage into the local working list — the picker and the
  // Remove buttons route here. `save()` commits the diff.
  function addSkill(picked: PickerSkill) {
    setError(null)
    setSkills((prev) =>
      prev.some((s) => s.skill_id === picked.skill_id)
        ? prev
        : [
            ...prev,
            {
              skill_id: picked.skill_id,
              pinned_hash: null,
              current_hash: null,
              added_at: Date.now(),
              description: picked.description ?? null,
              category: picked.category ?? null,
              visibility: picked.visibility ?? undefined,
            },
          ],
    )
  }

  function removeSkill(skillId: string) {
    setError(null)
    setSkills((prev) => prev.filter((s) => s.skill_id !== skillId))
  }

  // Undo a staged removal — put the original server entry back in the working list.
  function restoreSkill(entry: (typeof skills)[number]) {
    setError(null)
    setSkills((prev) => (prev.some((s) => s.skill_id === entry.skill_id) ? prev : [...prev, entry]))
  }

  const metaLine = `${kit.skills.length} ${kit.skills.length === 1 ? 'skill' : 'skills'} · ${kit.visibility}${
    typeof kit.version === 'number' && kit.version > 0 ? ` · v${kit.version}` : ''
  }`

  const hasPublished = typeof kit.version === 'number' && kit.version > 0

  // Auto release-note for the version Save publishes, derived from the staged
  // diff. High-level — the specific skills show in the version-history diff.
  const plural = (n: number) => `${n} ${n === 1 ? 'skill' : 'skills'}`
  const suggestedNote = !hasPublished
    ? 'Created kit'
    : (() => {
        const parts = [
          addedIds.length > 0 ? `added ${plural(addedIds.length)}` : null,
          removedIds.length > 0 ? `removed ${plural(removedIds.length)}` : null,
        ].filter(Boolean)
        const joined = parts.join(', ')
        return joined ? joined.charAt(0).toUpperCase() + joined.slice(1) : 'Updated kit'
      })()

  // One row for the "In this kit" list. A left change-marker (＋ Added / − Removed)
  // and a tint make staged edits obvious; removals render struck-through with a
  // Restore instead of vanishing. The marker column only appears once there are
  // staged changes, so an un-edited kit reads clean.
  function skillRow(s: (typeof skills)[number], state: 'unchanged' | 'added' | 'removed') {
    const [author, slug] = s.skill_id.split(':')
    const desc = s.description?.trim() ? s.description : null
    const isBusy = busy === 'save'
    const added = state === 'added'
    const removed = state === 'removed'
    return (
      <li key={`${state}-${s.skill_id}`} className="flex items-center gap-3">
        {/* Change marker — a bold green + / red − OUTSIDE the card, in a left
          gutter, so staged edits read at a glance without crowding the row. */}
        {membershipDirty && (
          <span
            className="flex w-8 shrink-0 items-center justify-center text-2xl font-bold leading-none"
            aria-label={added ? 'Added' : removed ? 'Removed' : undefined}
          >
            {added && <span className="text-(--success)">+</span>}
            {removed && <span className="text-(--danger)">−</span>}
          </span>
        )}
        <div
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-3 ${
            added
              ? 'bg-(--success-bg)/50 ring-1 ring-inset ring-(--success)/25'
              : removed
                ? 'bg-(--danger)/[0.05] ring-1 ring-inset ring-(--danger)/25'
                : 'surface-card'
          }`}
        >
          <span
            className={`relative h-11 w-11 shrink-0 ${removed ? 'grayscale' : ''}`}
            aria-hidden="true"
          >
          <SkillIcon seed={`${author}/${slug}`} category={s.category} />
        </span>
        <Link href={skillHref(author, slug)} className="group min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`text-base font-semibold ${
                removed ? 'text-(--ink-2) line-through' : 'text-(--ink) group-hover:text-(--accent)'
              }`}
            >
              {humanizeSlug(slug)}
            </span>
            <span className="font-mono text-xs text-(--ink-2)">@{author}</span>
            {/* Public is the default, so only private earns a badge — a lock in a
              rounded rectangle, the app's private treatment. */}
            {!removed && s.visibility === 'private' && (
              <PrivateMark className="rounded-lg border border-(--warning-line) px-2 py-0.5 text-(--warning)" />
            )}
            {!removed && s.pinned_hash && (
              <span className="rounded-full border border-(--line) px-2 py-0.5 font-mono text-xs text-(--ink-2)">
                pinned
              </span>
            )}
          </span>
          {!removed && desc && (
            <span className="mt-1 line-clamp-1 block text-sm text-(--ink-2)">{desc}</span>
          )}
        </Link>
        {canEditSkills &&
          (removed ? (
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              disabled={isBusy}
              onClick={() => restoreSkill(s)}
            >
              Restore
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              disabled={isBusy}
              onClick={() => removeSkill(s.skill_id)}
            >
              Remove
            </Button>
          ))}
        </div>
      </li>
    )
  }

  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_300px] md:items-start">
      <div className="min-w-0">
        {canEdit ? (
          /* Owner view — the create composer, in place: a cover + editable
             identity header, the picker, the kit's skills, then an action bar.
             Linked-source controls and publishing sit below the header. */
          <>
            <header className="flex items-start gap-4">
              <div className="relative h-16 w-16 shrink-0 sm:h-20 sm:w-20">
                <KitCoverStack
                  seed={kit.id}
                  owner={kit.owner}
                  skillCategories={kit.skills.map((s) => s.category ?? null)}
                />
              </div>
              <div className="min-w-0 flex-1">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name your kit"
                  maxLength={64}
                  aria-label="Kit name"
                  className="w-full bg-transparent text-3xl font-semibold leading-tight tracking-tight text-(--ink) placeholder:text-(--ink-2)/60 focus:outline-none"
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this kit is for (optional)"
                  rows={1}
                  className="mt-2 block field-sizing-content min-h-[28px] w-full resize-none bg-transparent text-base leading-relaxed text-(--ink) placeholder:text-(--ink-2)/60 focus:outline-none"
                />
              </div>
              <Button href={kitHref(kit.owner, kit.slug)} variant="secondary" className="shrink-0">
                View
              </Button>
            </header>

            {kit.source && (
              <div className="mt-6">
                <LinkedKitSourcePanel kit={kit} />
              </div>
            )}

            {/* Add skills — a single search field; results open in a dropdown.
              Hidden on linked kits, whose skills are repo-managed (the Linked
              source panel above carries that message). */}
            {canEditSkills && (
              <div className="mt-6">
                <KitSkillPicker
                  existingSkillIds={skills.map((s) => s.skill_id)}
                  mySkills={mySkills}
                  savedSkills={savedSkills}
                  popularSkills={popularSkills}
                  kitVisibility={visibility}
                  onAdd={(s) => addSkill(s)}
                  busy={busy !== null}
                  placeholder="Add skills…"
                />
              </div>
            )}

            {/* In this kit — full rows for the management view: each skill shows
              its description and a clear Remove, with removed-pending below. */}
            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
                In this kit{' '}
                <span className="font-normal normal-case tracking-normal">({skills.length})</span>
              </p>
              {orderedRows.length === 0 ? (
                <p className="mt-3 text-sm text-(--ink-2)">
                  No skills yet. Add them from the search above.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {orderedRows.map(({ s, state }) => skillRow(s, state))}
                </ul>
              )}
            </div>

            {error && <p className="mt-4 text-sm text-(--danger)">{error}</p>}

            {confirmPrivate && (
              <div className="mt-4 rounded-lg border border-(--danger)/40 bg-(--danger)/8 p-4">
                <p className="text-sm font-semibold text-(--ink)">Make this kit private?</p>
                <p className="mt-1 text-sm leading-[1.5] text-(--ink-2)">
                  Its {subscriberCount}{' '}
                  {subscriberCount === 1 ? 'subscriber keeps' : 'subscribers keep'} access and keep
                  getting updates, but the kit will be removed from search and your profile, and no
                  one new can subscribe.
                </p>
              </div>
            )}

            {/* Release note — only when this Save will publish a version (a
              public kit with skill changes). Optional; blank uses the auto note. */}
            {visibility === 'public' && membershipDirty && (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
                  Release note
                </p>
                <Input
                  className="mt-2 w-full"
                  placeholder={suggestedNote}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            )}

            {/* Action bar — visibility + profile toggle on the left, save on the right. */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-(--line) pt-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <SegmentedControl
                  options={[
                    {
                      value: 'public',
                      label: 'Public',
                      disabled: publicBlocked,
                      title: publicBlocked
                        ? 'This kit contains private skills, so it can’t be public.'
                        : undefined,
                    },
                    { value: 'private', label: 'Private' },
                  ]}
                  value={visibility}
                  onChange={(v) => {
                    setVisibility(v)
                    setConfirmPrivate(false)
                  }}
                  ariaLabel="Kit visibility"
                />
                <label className="flex items-center gap-2 text-sm text-(--ink-2)">
                  <input
                    type="checkbox"
                    checked={showOnProfile}
                    onChange={(e) => setShowOnProfile(e.target.checked)}
                  />
                  Show on profile
                </label>
              </div>
              <div className="flex items-center gap-5">
                {dirty && (
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={discard}
                    disabled={busy === 'save'}
                  >
                    Discard
                  </Button>
                )}
                <Button
                  type="button"
                  variant={confirmPrivate ? 'danger-secondary' : 'primary'}
                  onClick={save}
                  disabled={busy === 'save' || !dirty || publicConflict}
                >
                  {busy === 'save'
                    ? visibility === 'public'
                      ? 'Publishing…'
                      : 'Saving…'
                    : confirmPrivate
                      ? 'Make private'
                      : visibility === 'public'
                        ? 'Publish'
                        : 'Save'}
                </Button>
              </div>
            </div>
            {/* Only an ACTUAL conflict (a public kit holding private skills) earns
              the warning. A private kit with private skills is fine; the disabled
              Public toggle + its tooltip already explain why it can't go public. */}
            {publicConflict && (
              <p className="mt-2 text-sm text-(--warning)">
                {`This public kit contains ${privateSkillCount} private ${
                  privateSkillCount === 1 ? 'skill' : 'skills'
                }. Remove ${
                  privateSkillCount === 1 ? 'it' : 'them'
                } or set the kit to private to save.`}
              </p>
            )}
          </>
        ) : (
          /* Viewer (non-owner) — read-only detail. */
          <>
            <header>
              <p className="font-mono text-sm tracking-[0.01em] text-(--accent)">
                @{kit.owner}/{slugify(kit.name, { fallback: 'kit' })}
              </p>
              <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight">
                {kit.name}
              </h1>
              {kit.description?.trim() && (
                <p className="mt-2 max-w-[60ch] text-base leading-[1.55] text-(--ink-2)">
                  {kit.description}
                </p>
              )}
              <p className="mt-1.5 font-mono text-sm text-(--ink-2)">{metaLine}</p>
            </header>

            <section className="mt-10">
              <h2 className="text-lg font-semibold tracking-tight text-(--ink)">
                Skills <span className="font-normal text-(--ink-2)">({kit.skills.length})</span>
              </h2>
              {kit.skills.length === 0 ? (
                <p className="mt-4 text-sm text-(--ink-2)">No skills in this kit yet.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {kit.skills.map((s) => {
                    const [author, slug] = s.skill_id.split(':')
                    const description = s.description?.trim() ? s.description : null
                    return (
                      <li
                        key={s.skill_id}
                        className="flex items-center gap-4 surface-card px-4 py-3"
                      >
                        <span className="relative h-11 w-11 shrink-0" aria-hidden="true">
                          <SkillIcon seed={`${author}/${slug}`} category={s.category} />
                        </span>
                        <Link href={skillHref(author, slug)} className="group min-w-0 flex-1">
                          <span className="block font-mono text-sm font-semibold text-(--ink) group-hover:text-(--accent)">
                            @{author}/{slug}
                          </span>
                          {description && (
                            <span className="mt-1 line-clamp-1 block text-sm text-(--ink-2)">
                              {description}
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* Subscriber-only: how updates reach your machines. */}
            {kit.subscribed && (
              <Panel as="section" padding="none" className="mt-8 p-5">
                <h2 className="font-mono text-sm uppercase tracking-[0.06em] text-(--accent)">
                  Updates
                </h2>
                <p className="mt-2 text-sm text-(--ink-2)">
                  How updates from this kit reach your machines when the curator changes it.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <label className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="trust-mode"
                      className="mt-1"
                      checked={trustMode === 'auto'}
                      disabled={busy === 'trust'}
                      onChange={() => saveTrust('auto')}
                    />
                    <span>
                      <span className="block font-medium">Auto-apply updates</span>
                      <span className="block text-sm text-(--ink-2)">
                        New versions sync silently. Signing and safety scans still run.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="trust-mode"
                      className="mt-1"
                      checked={trustMode === 'gate'}
                      disabled={busy === 'trust'}
                      onChange={() => saveTrust('gate')}
                    />
                    <span>
                      <span className="block font-medium">Review each update</span>
                      <span className="block text-sm text-(--ink-2)">
                        Hold updates for a diff you approve before they apply.
                      </span>
                    </span>
                  </label>
                </div>
              </Panel>
            )}

            {error && <p className="mt-4 text-sm text-(--danger)">{error}</p>}
          </>
        )}
      </div>

      <aside className="md:sticky md:top-24">
        <Panel as="section" padding="none" className="p-5">
          <h2 className="font-mono text-sm uppercase tracking-[0.06em] text-(--accent)">
            Version history
          </h2>
          {versions && versions.length > 0 ? (
            <ul className="mt-3 divide-y divide-(--line) border-t border-(--line)">
              {versions.map((v) => (
                <li key={v.version} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-sm text-(--ink)">v{v.version}</span>
                    <span className="shrink-0 font-mono text-xs text-(--ink-2)">
                      {formatShortDate(v.created_at)}
                    </span>
                  </div>
                  {v.summary && (
                    <p className="mt-1 text-sm leading-[1.5] text-(--ink-2)">{v.summary}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-(--ink-2)">No published versions yet.</p>
          )}
        </Panel>

        {canEdit && kit.visibility !== 'private' && (
          <Panel as="section" padding="none" className="mt-6 p-5">
            <BadgeSnippet
              badgePath={`${origin}/api/badge/kit/${kit.owner}/${kit.slug}`}
              targetUrl={`${origin}${kitHref(kit.owner, kit.slug)}`}
              alt={`${kit.name} on Skillet`}
            />
          </Panel>
        )}
      </aside>
    </div>
  )
}
