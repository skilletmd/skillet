'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Button, buttonClasses } from '@/components/ui/button'
import { CONTROL_HEIGHT } from '@/components/ui/control-size'
import { AddCoinIcon } from '@/components/kits/add-coin'
import { useKitMembership, SAVED_KIT_LABEL } from '@/components/kits/use-kit-membership'
import { cn } from '@/lib/cn'
import {
  addIntentClaimHref,
  addIntentLoginHref,
  kitHrefFromRecord,
  loginHref,
  skillHref,
} from '@/lib/urls'
import { Plus } from '@/components/ui/icons'
import type { KitPayload } from '@/lib/kits'

const SkillKitDropdown = dynamic(
  () => import('@/components/kits/skill-kit-menu').then((m) => m.SkillKitDropdown),
  { ssr: false },
)

export function SkillKitControl({
  author,
  slug,
  variant = 'compact',
}: {
  author: string
  slug: string
  // 'compact' = the split Add pill on cards. 'hero' = the same control, sized up
  // for the detail-page primary action. 'panel' = the legacy stacked picker.
  variant?: 'compact' | 'hero' | 'panel'
}) {
  const {
    kitsCtx,
    pending,
    error,
    setError,
    toggleSaved,
    addToKit,
    createKitAndAdd,
    removeFromKit,
  } = useKitMembership(author, slug)
  const refreshKits = kitsCtx?.refresh
  const { data: session } = useSession()
  const [kitId, setKitId] = useState('')
  const [confirmRemoveKitId, setConfirmRemoveKitId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // Which section's inline "New kit" form is open: a team slug, the viewer's
  // handle for the personal section, or null for none.
  const [createIn, setCreateIn] = useState<string | null>(null)
  const [newKitName, setNewKitName] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  // The menu is portaled to <body> so no card stacking context can ever clip or
  // bury it. We position it (fixed) under the caret and keep it pinned on scroll.
  const portalRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [menuReady, setMenuReady] = useState(false)

  // Reset the inline create form whenever the menu closes.
  useEffect(() => {
    if (!menuOpen) {
      setCreateIn(null)
      setNewKitName('')
    }
  }, [menuOpen])

  useEffect(() => {
    if (menuOpen) setMenuReady(true)
  }, [menuOpen])

  // Opening the menu silently refetches your kits, so a kit you just created on
  // another page (or tab) shows up here without a hard refresh.
  useEffect(() => {
    if (menuOpen) void refreshKits?.()
  }, [menuOpen, refreshKits])

  useEffect(() => {
    if (!menuOpen) return
    function reposition() {
      const r = menuRef.current?.getBoundingClientRect()
      if (!r) return
      // Hang the menu from the control's RIGHT edge (it sits under the caret), so
      // the two right edges line up. Clamp into the viewport so it never spills
      // off either side when the control is near the left edge instead.
      const MENU_W = 220
      const MARGIN = 8
      const left = Math.max(MARGIN, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - MARGIN))
      setMenuPos({ top: r.bottom + 6, left })
    }
    reposition()
    function onPointer(event: MouseEvent) {
      const t = event.target as Node
      if (menuRef.current?.contains(t) || portalRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [menuOpen])

  const memberships = kitsCtx?.membershipsFor(author, slug) ?? []
  const ownedKits = kitsCtx?.ownedKits ?? []
  // A GitHub-synced kit mirrors its repo — its skills are managed there, not here.
  // It's not a valid "Add to" destination, so it never belongs in these pickers.
  const editableKits = useMemo(
    () => ownedKits.filter((k) => k.source_type !== 'linked' && !k.source),
    [ownedKits],
  )
  const addableKits = useMemo(
    () => editableKits.filter((k) => !memberships.some((m) => m.kitId === k.id)),
    [editableKits, memberships],
  )

  // Split editable destinations into your own kits and one section per team you
  // admin. A team's kits (its Saved + custom) carry the org slug as `owner`.
  const viewerHandle = kitsCtx?.viewerHandle ?? null
  const teams = kitsCtx?.teams ?? []
  const personalKits = useMemo(
    () => (viewerHandle == null ? editableKits : editableKits.filter((k) => k.owner === viewerHandle)),
    [editableKits, viewerHandle],
  )
  const teamSections = useMemo(() => {
    if (viewerHandle == null) return []
    const byOwner = new Map<string, KitPayload[]>()
    for (const k of editableKits) {
      if (k.owner === viewerHandle) continue
      const arr = byOwner.get(k.owner) ?? []
      arr.push(k)
      byOwner.set(k.owner, arr)
    }
    const known = teams.map((t) => t.slug).filter((s) => byOwner.has(s))
    const extra = [...byOwner.keys()].filter((s) => !teams.some((t) => t.slug === s))
    return [...known, ...extra].map((slug) => ({
      slug,
      name: teams.find((t) => t.slug === slug)?.name ?? slug,
      // The team's Saved kit leads its section, mirroring your own library.
      kits: [...(byOwner.get(slug) ?? [])].sort(
        (a, b) => (b.kind === 'saved' ? 1 : 0) - (a.kind === 'saved' ? 1 : 0),
      ),
    }))
  }, [editableKits, viewerHandle, teams])

  // No membership context: the viewer is signed out, or signed in without a
  // claimed username (the provider only mounts once a handle exists). Either way
  // they can't add yet — but they still get a real primary "Add". Signed out
  // routes through login; signed-in-but-handle-less routes to claim a username.
  // Both carry the add intent so the skill auto-adds on return (AddIntentHandler).
  const notReady = !kitsCtx || !kitsCtx.authed
  if (notReady) {
    const intent = { type: 'skill' as const, author, slug }
    const claimFirst = !kitsCtx && session != null
    const href = claimFirst ? addIntentClaimHref(intent) : addIntentLoginHref(intent)
    // On cards (compact) and the detail hero, keep the same pill the kit card
    // shows. Only the legacy stacked `panel` keeps the plain sentence.
    if (variant === 'compact' || variant === 'hero') {
      const big = variant === 'hero'
      return (
        <Link
          href={href}
          className={cn(
            buttonClasses(big ? 'primary' : 'secondary', { size: big ? 'md' : 'sm' }),
            !big && 'min-w-[4.75rem]',
          )}
        >
          {big && <Plus className="h-4 w-4" />}
          <span>
            Add{big && <span className="hidden sm:inline">&nbsp;skill</span>}
          </span>
        </Link>
      )
    }
    // The legacy panel needs the Saved kit to add, so it can't act here.
    if (!kitsCtx) return null
    return (
      <p className="text-sm text-(--ink-2)">
        <Link href={loginHref(skillHref(author, slug))} className="text-(--accent) hover:underline">
          Sign in
        </Link>{' '}
        to add skills to your kits.
      </p>
    )
  }

  const split = variant === 'compact' || variant === 'hero'

  if (kitsCtx.loading) {
    return (
      <span
        className={
          split
            ? cn(
                // Same face as the resting control (primary hero / secondary card)
                // so the loading beat doesn't flash a different button.
                buttonClasses(variant === 'hero' ? 'primary' : 'secondary', {
                  size: variant === 'hero' ? 'md' : 'sm',
                }),
                'opacity-60',
              )
            : 'text-sm text-(--ink-2)'
        }
      >
        {split ? '…' : 'Loading kits…'}
      </span>
    )
  }

  // Compact (on cards): one consistent split control everywhere — a labeled
  // "Add" that toggles your library (Liked Songs), and a caret that routes the
  // skill into a named kit. Same shape for your own skills and everyone else's.
  if (split) {
    const big = variant === 'hero'
    const saved = kitsCtx.isSaved(author, slug)
    // In a named kit (anything that isn't the auto Saved kit).
    const inNamed = memberships.some((m) => m.kitId !== kitsCtx.savedKit?.id)
    // "Added" means in ANY kit — Saved or a named one — so the button never
    // says "Add" while the menu shows it checked into kits.
    const added = saved || inNamed

    const renderKitRow = (k: KitPayload) => {
      const isIn = memberships.some((m) => m.kitId === k.id)
      return (
        <li key={k.id}>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={isIn}
            className="skill-kit-menu-item"
            disabled={pending}
            onClick={() => (isIn ? void removeFromKit(k.id) : void addToKit(k.id))}
          >
            <span className={`skill-kit-menu-check ${isIn ? 'is-on' : ''}`} aria-hidden>
              {isIn ? '✓' : ''}
            </span>
            <span className="min-w-0 flex-1 truncate">{k.name}</span>
          </button>
        </li>
      )
    }

    // Each section owns its "New kit" affordance, so it's always clear which
    // library a new kit lands in — your handle for personal, the team's slug for
    // a team. Toggling one open closes any other and clears the field.
    const openCreate = (id: string) => {
      setNewKitName('')
      setError(null)
      setCreateIn((cur) => (cur === id ? null : id))
    }

    const sectionHeader = (id: string, label: string, title?: string) => (
      <li className="skill-kit-menu-section-row" title={title}>
        <span className="skill-kit-menu-section-label">{label}</span>
        <button type="button" className="skill-kit-menu-newbtn" onClick={() => openCreate(id)}>
          {createIn === id ? 'Cancel' : '+ New'}
        </button>
      </li>
    )

    // The inline creator for a section — `owner` scopes it to a team (omitted for
    // personal, where the server defaults to your handle).
    const createRow = (id: string, owner?: string) =>
      createIn === id ? (
        <li>
          <form
            className="skill-kit-menu-create-form is-inline"
            onSubmit={(e) => {
              e.preventDefault()
              void createKitAndAdd(
                newKitName,
                () => {
                  setNewKitName('')
                  setCreateIn(null)
                },
                owner,
              )
            }}
          >
            <input
              autoFocus
              value={newKitName}
              onChange={(e) => setNewKitName(e.target.value)}
              placeholder="Kit name"
              aria-label="New kit name"
              maxLength={60}
              className="skill-kit-menu-input"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="shrink-0"
              disabled={pending || !newKitName.trim()}
            >
              {pending ? '…' : 'Create'}
            </Button>
          </form>
        </li>
      ) : null

    const personalId = viewerHandle ?? '__me__'

    const menuInner = (
      <>
        <ul className="skill-kit-menu-list">
          {/* Your kits — Saved (library) plus your named kits. "+ New" here makes a
              personal kit. */}
          {sectionHeader(personalId, 'Your kits')}
          {kitsCtx.savedKit && (
            <li>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={saved}
                className="skill-kit-menu-item"
                disabled={pending}
                onClick={() => void toggleSaved()}
              >
                <span className={`skill-kit-menu-check ${saved ? 'is-on' : ''}`} aria-hidden>
                  {saved ? '✓' : ''}
                </span>
                <span className="min-w-0 flex-1 truncate">{SAVED_KIT_LABEL}</span>
              </button>
            </li>
          )}
          {personalKits.map(renderKitRow)}
          {createRow(personalId)}

          {/* One section per team you admin (its Saved + custom kits). "+ New"
              creates the kit under that team. */}
          {teamSections.map((section) => (
            <Fragment key={section.slug}>
              <li className="skill-kit-menu-divider" aria-hidden="true" />
              {sectionHeader(section.slug, section.name, `@${section.slug}`)}
              {section.kits.map(renderKitRow)}
              {createRow(section.slug, section.slug)}
            </Fragment>
          ))}

          {/* Already yours via a kit you added (a followed kit / author-kit / team
              kit): a LOCKED checkmark — checked, but not yours to toggle here. To
              drop it, leave that kit from the kit itself. */}
          {memberships.some((m) => m.kind === 'followed') && (
            <>
              <li className="skill-kit-menu-divider" aria-hidden="true" />
              <li className="skill-kit-menu-section px-2 pb-1.5 pt-0.5 text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
                Also in
              </li>
            </>
          )}
          {memberships
            .filter((m) => m.kind === 'followed')
            .map((m) => (
              <li key={m.kitId}>
                {/* Checked (you have it) but read-only here — it's a link to the
                    kit that supplies it, so you manage it there. */}
                <Link href={m.href} className="skill-kit-menu-item" title={`Open “${m.name}”`}>
                  <span className="skill-kit-menu-check is-locked" aria-hidden>
                    ✓
                  </span>
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <svg
                    className="skill-kit-menu-chevron"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </li>
            ))}
        </ul>
        {error && <p className="skill-kit-menu-error">{error}</p>}
      </>
    )

    // One control for every skill. At rest it's a single "Add" that drops the
    // skill into your library — same shape as the kit card's Add, so a browse
    // grid stays consistent. Once it's in, it goes gold and grows the
    // destination caret ([ ✓ Added | ⌄ ]) for routing into named kits.
    return (
      <div className="skill-kit-dd" ref={menuRef}>
        <div
          className={cn(
            // 1px border, same button surfaces as the rest of the family. The hero
            // is the standard `primary` face (flat, no shadow/ring — buttons don't
            // lift in this system), matching the kit page's Add and the profile's
            // Follow: one CTA across every detail hero. Compact (card grid) is the
            // quieter bordered `secondary`.
            'inline-flex items-center overflow-hidden border transition-[border-color,background-color] duration-150',
            big ? 'rounded-xl' : 'rounded-lg',
            big && !added && 'min-w-[112px]',
            // "Added" is a done state — it recedes so a grid of added skills isn't a
            // wall of loud pills: the accent-tinted "connected" chip (you own
            // this) — identical big or compact.
            added
              ? 'border-transparent bg-(--accent-bg) hover:border-[color-mix(in_srgb,var(--line)_65%,var(--ink-2))]'
              : big
                ? 'border-transparent bg-(--ink)'
                : 'border-(--line) bg-(--surface) hover:border-[color-mix(in_srgb,var(--line)_65%,var(--ink-2))] hover:bg-(--accent-bg)',
          )}
        >
          <button
            type="button"
            className={cn(
              'flex items-center font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--accent) disabled:opacity-50',
              big
                ? `${CONTROL_HEIGHT.lg} gap-2 px-5 text-base`
                : `${CONTROL_HEIGHT.sm} gap-1.5 px-3 text-xs`,
              // Resting compact "Add" gets a min-width + centered text so a grid of
              // them lines up with the wider "Added ⌄" split instead of jittering.
              // Narrow cards (container query) collapse to icon-only — the
              // min-width and label only return once the card can afford them.
              !big && !added && 'justify-center @[24rem]:min-w-[4.75rem]',
              big && !added && 'flex-1 justify-center',
              added
                ? 'text-(--accent) hover:bg-black/[0.04]'
                : big
                  ? // The primary button's exact hover, painted by the inner
                    // segment since the split container owns the resting bg.
                    '[color:var(--surface)] hover:bg-[color-mix(in_srgb,var(--ink)_82%,var(--surface))]'
                  : 'text-(--ink)',
            )}
            aria-label={
              saved
                ? 'Added · remove from Saved'
                : inNamed
                  ? 'In your kits · manage'
                  : 'Add to Saved'
            }
            disabled={pending}
            // Saved → quick remove. In a named kit only → open the menu to manage
            // (no single obvious target to toggle). Not anywhere → quick add.
            onClick={() => (inNamed && !saved ? setMenuOpen(true) : void toggleSaved())}
          >
            {/* Hero keeps the glyph in both states (the + → ✓ morph reads well on
                a loud primary). Compact shows only the ✓ once added — at rest a
                bare "Add" is cleaner in a grid and drops the redundant plus. */}
            {/* Hero and added-state always carry the glyph. Resting compact
                shows it only when the card is too narrow for the label —
                below the threshold the control is just [+] / [✓|⌄]. */}
            <span
              className={cn(
                'relative items-center justify-center transition-transform duration-150',
                big ? 'flex h-[18px] w-[18px]' : 'h-4 w-4',
                !big && (added ? 'flex' : 'flex @[24rem]:hidden'),
              )}
            >
              <AddCoinIcon added={added} />
            </span>
            <span
              className={cn(
                'items-center whitespace-nowrap',
                big ? 'inline-flex' : 'hidden @[24rem]:inline-flex',
              )}
            >
              Add
              <span
                className={cn(
                  'inline-block overflow-hidden transition-[max-width,opacity] duration-200 ease-out',
                  added ? 'max-w-[2ch] opacity-100' : 'max-w-0 opacity-0',
                )}
              >
                ed
              </span>
              {/* Spell it out in the hero at rest ("Add skill"); collapses to the
                  morphing "Add → Added" on mobile and once added. */}
              {!added && big && <span className="hidden sm:inline">&nbsp;skill</span>}
            </span>
          </button>
          {/* The destination caret appears only once the skill is in. A skill has
              many possible homes (Library + named kits), so "move / also add to a
              kit" is a post-add action — hidden at rest so a browse grid stays
              calm and matches the single-action kit card. */}
          {added && (
            <>
              <span
                className={cn('w-px bg-(--accent)/20', big ? 'h-5' : 'h-4')}
                aria-hidden="true"
              />
              <button
                type="button"
                className={cn(
                  'flex items-center justify-center transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--accent)',
                  'text-(--accent) hover:bg-black/[0.04]',
                  big ? `${CONTROL_HEIGHT.lg} w-12` : `${CONTROL_HEIGHT.sm} w-[26px]`,
                )}
                aria-label="Add to a kit"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <svg
                  width={big ? 13 : 11}
                  height={big ? 13 : 11}
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.85"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </button>
            </>
          )}
        </div>
        {menuReady && (
          <SkillKitDropdown open={menuOpen} menuPos={menuPos} portalRef={portalRef}>
            {menuInner}
          </SkillKitDropdown>
        )}
      </div>
    )
  }

  function requestRemove(targetKitId: string, kitName: string) {
    setConfirmRemoveKitId(targetKitId)
    setError(null)
  }

  if (memberships.length > 0) {
    return (
      <div className="space-y-4">
        <ul className="space-y-2">
          {memberships.map((m) => (
            <li
              key={m.kitId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-(--line) px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-(--ink)">
                  In{' '}
                  <Link
                    href={kitHrefFromRecord({ id: m.kitId })}
                    className="text-(--accent) hover:underline"
                  >
                    {m.kitId === kitsCtx.savedKit?.id ? SAVED_KIT_LABEL : m.name}
                  </Link>
                </p>
                <p className="font-mono text-xs text-(--ink-2)">
                  @{m.owner}/{m.kitId === kitsCtx.savedKit?.id ? SAVED_KIT_LABEL : m.name}
                </p>
              </div>
              {m.canRemove &&
                (confirmRemoveKitId === m.kitId ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void removeFromKit(m.kitId, () => setConfirmRemoveKitId(null))}
                    >
                      {pending ? 'Removing…' : 'Confirm remove'}
                    </Button>
                    <Button
                      type="button"
                      variant="tertiary"
                      disabled={pending}
                      onClick={() => setConfirmRemoveKitId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => requestRemove(m.kitId, m.name)}
                  >
                    Remove
                  </Button>
                ))}
            </li>
          ))}
        </ul>
        {addableKits.length > 0 && (
          <AddKitPicker
            kits={addableKits}
            kitId={kitId || addableKits[0]?.id || ''}
            onKitIdChange={setKitId}
            pending={pending}
            onAdd={() => void addToKit(kitId || addableKits[0]?.id || '')}
            label="Also add to"
          />
        )}
        {error && <p className="text-sm text-(--danger)">{error}</p>}
      </div>
    )
  }

  if (editableKits.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-[1.5] text-(--ink-2)">
          Create a kit first to add skills from the web.
        </p>
        <Button href="/kits/new" variant="primary" block>
          Create a kit
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <AddKitPicker
        kits={editableKits}
        kitId={kitId || editableKits[0]?.id || ''}
        onKitIdChange={setKitId}
        pending={pending}
        onAdd={() => void addToKit(kitId || editableKits[0]?.id || '')}
      />
      {error && <p className="text-sm text-(--danger)">{error}</p>}
    </div>
  )
}

function AddKitPicker({
  kits,
  kitId,
  onKitIdChange,
  pending,
  onAdd,
  label = 'Kit',
  compact = false,
}: {
  kits: Array<{ id: string; name: string; owner: string }>
  kitId: string
  onKitIdChange: (id: string) => void
  pending: boolean
  onAdd: () => void
  label?: string
  compact?: boolean
}) {
  const selected = kits.find((k) => k.id === kitId)

  return (
    <div className={compact ? 'skill-kit-picker-inner' : 'space-y-2'}>
      {!compact && (
        <span className="text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
          {label}
        </span>
      )}
      {kits.length > 1 ? (
        <select
          className={compact ? 'artifact-btn artifact-btn--select' : 'ui-input mt-2 w-full'}
          value={kitId}
          onChange={(e) => onKitIdChange(e.target.value)}
          aria-label="Choose kit"
        >
          {kits.map((k) => (
            <option key={k.id} value={k.id}>
              @{k.owner}/{k.name}
            </option>
          ))}
        </select>
      ) : selected ? (
        <Link
          href={kitHrefFromRecord({ id: selected.id })}
          className={
            compact
              ? 'font-mono text-xs text-(--accent) hover:underline'
              : 'mt-2 block break-all font-mono text-sm text-(--accent) hover:underline'
          }
        >
          @{selected.owner}/{selected.name}
        </Link>
      ) : null}
      <Button
        type="button"
        variant="primary"
        size={compact ? 'sm' : 'md'}
        block={!compact}
        onClick={onAdd}
        disabled={pending || !kitId}
      >
        {pending ? 'Adding…' : 'Add to kit'}
      </Button>
    </div>
  )
}
