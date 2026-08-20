'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { pluralize } from '@/lib/format'
import { timeAgo } from '@/lib/feed-format'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DialogFooter } from '@/components/ui/dialog-footer'
import { Apple, Bookmark, ChevronRight, Desktop, Device, Terminal, Windows } from '@/components/ui/icons'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { registryAuthApi } from '@/lib/registry-proxy'
import { CoverArt } from '@/components/cover/cover'
import { Avatar } from '@/components/ui/avatar'
import { DeviceLabelEditor } from '@/components/device-label-editor'
import {
  deviceClientKindIcon,
  deviceClientKindLabel,
  deviceClientKindsIcons,
  deviceClientKindsLabel,
  type DeviceClientIcon,
} from '@/lib/device-client-kind'
import { SAVED_KIT_LABEL } from '@/components/kits/use-kit-membership'
import { runtimeLabel } from '@/lib/runtime-labels'
import { AgentGlyph } from '@/components/agent-glyph'

interface RoutableKit {
  key: string
  name: string
  /** Handle used to build the kit / author link (no leading @). */
  owner: string
  /** Kit slug for the `/kits/{owner}/{slug}` permalink; absent for author kits. */
  slug?: string
  /** Author kits (self / subscribed authors) link to the profile, not a kit page. */
  isAuthorKit?: boolean
  /** The auto "Saved" kit links to the profile's Saved tab, where it's managed. */
  isSavedKit?: boolean
  /** Shown in place of the @owner handle for the user's own kits. */
  descriptor?: string
  count: number
  skillRefs: string[]
  skillCategories: (string | null)[]
  avatar?: { url: string | null; initial: string }
}

interface MineKit {
  id: string
  name: string
  owner: string
  slug?: string
  kind?: string
  skills?: Array<{ skill_id: string; category?: string | null }>
}
interface MineAuthorKit {
  owner: string
  name: string
  self?: boolean
  avatar_url?: string | null
  skills?: Array<{ skill_id: string; category?: string | null }>
}
interface MineResponse {
  owned?: MineKit[]
  member?: MineKit[]
  subscribed?: MineKit[]
  author_kits?: MineAuthorKit[]
}

const refsOf = (skills?: Array<{ skill_id: string }>): string[] =>
  (skills ?? []).map((s) => s.skill_id.replace(':', '/'))

const catsOf = (skills?: Array<{ category?: string | null }>): (string | null)[] =>
  (skills ?? []).map((s) => s.category ?? null)

const initialOf = (name: string, owner: string): string => (name || owner).slice(0, 2).toUpperCase()

/**
 * Flatten kits/mine into one routable list, "most yours" first. Each `key` is
 * the manifest's canonical group key (`kit:<id>` / `author:self` /
 * `author:<owner>`), so the toggles line up 1:1 with what the sync manifest
 * filters on the server.
 */
function toRoutable(data: MineResponse): RoutableKit[] {
  const list: RoutableKit[] = []
  // Saved (your individually-added skills) leads, then your author kit, then
  // curated / subscribed kits.
  const saved = data.owned?.find((k) => k.kind === 'saved')
  if (saved) {
    list.push({
      key: `kit:${saved.id}`,
      name: SAVED_KIT_LABEL,
      owner: saved.owner,
      slug: saved.slug,
      isSavedKit: true,
      descriptor: 'added individually',
      count: saved.skills?.length ?? 0,
      skillRefs: refsOf(saved.skills),
      skillCategories: catsOf(saved.skills),
    })
  }
  const self = data.author_kits?.find((a) => a.self)
  if (self) {
    list.push({
      key: 'author:self',
      name: 'Your skills',
      owner: self.owner,
      isAuthorKit: true,
      count: self.skills?.length ?? 0,
      skillRefs: refsOf(self.skills),
      skillCategories: catsOf(self.skills),
      avatar: { url: self.avatar_url ?? null, initial: initialOf(self.name, self.owner) },
    })
  }
  for (const k of data.owned ?? []) {
    if (k.kind === 'saved') continue
    list.push({
      key: `kit:${k.id}`,
      name: k.name,
      owner: k.owner,
      slug: k.slug,
      count: k.skills?.length ?? 0,
      skillRefs: refsOf(k.skills),
      skillCategories: catsOf(k.skills),
    })
  }
  for (const k of data.subscribed ?? []) {
    list.push({
      key: `kit:${k.id}`,
      name: k.name,
      owner: k.owner,
      slug: k.slug,
      count: k.skills?.length ?? 0,
      skillRefs: refsOf(k.skills),
      skillCategories: catsOf(k.skills),
    })
  }
  for (const a of data.author_kits ?? []) {
    if (a.self) continue
    list.push({
      key: `author:${a.owner}`,
      name: a.name,
      owner: a.owner,
      isAuthorKit: true,
      count: a.skills?.length ?? 0,
      skillRefs: refsOf(a.skills),
      skillCategories: catsOf(a.skills),
      avatar: { url: a.avatar_url ?? null, initial: initialOf(a.name, a.owner) },
    })
  }
  for (const k of data.member ?? []) {
    list.push({
      key: `kit:${k.id}`,
      name: k.name,
      owner: k.owner,
      slug: k.slug,
      count: k.skills?.length ?? 0,
      skillRefs: refsOf(k.skills),
      skillCategories: catsOf(k.skills),
    })
  }
  return list
}

/**
 * Permalink for a kit row: the kit page for real kits, the profile for author
 * kits, the profile's Saved tab for the auto Saved kit (its management surface).
 */
function kitRowHref(kit: RoutableKit): string | null {
  if (kit.isSavedKit) return `/${kit.owner}?tab=saved#saved-skills`
  if (kit.isAuthorKit) return `/${kit.owner}`
  if (kit.slug) return `/kits/${kit.owner}/${kit.slug}`
  return null
}

function Cover({ kit }: { kit: RoutableKit }) {
  // Author kits show the owner's avatar full-bleed (keyed on the handle, so it
  // matches the same identity everywhere).
  if (kit.avatar) {
    return (
      <Avatar
        src={kit.avatar.url}
        name={kit.avatar.initial}
        colorKey={kit.owner}
        className="h-9 w-9 shrink-0 rounded-lg shadow-sm ring-1 ring-black/5"
      />
    )
  }
  // Saved is a system collection, not a curated kit: a quiet bookmark tile, so
  // it never reads as a peer of the real kit covers below it.
  if (kit.isSavedKit) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-(--line) text-(--ink-2)">
        <Bookmark className="text-base" />
      </span>
    )
  }
  // Every real kit uses the shared cover engine, where the members' categories
  // drive the composition.
  const seed = kit.key || kit.skillRefs.join(',') || `${kit.owner}/${kit.name}`
  return (
    <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg shadow-sm ring-1 ring-black/5">
      <CoverArt
        seed={seed}
        categories={kit.skillCategories.length ? kit.skillCategories : [null]}
        className="absolute inset-0 h-full w-full"
      />
    </span>
  )
}

/**
 * One connected machine and which kits sync to it. Routing is per-device: each
 * machine carries its own on/off set. We persist the *off* set (exclusions), so
 * default is everything-on and a kit you add later syncs everywhere until you
 * turn it off here. Collapsed to a one-line summary; expand to toggle kits.
 *
 * Pass `deviceId` to persist to the registry. Without it (design preview),
 * toggles are local only.
 */
export function DeviceKitSync({
  label,
  deviceId,
  clientKind,
  clientKinds,
  clientPlatform,
  agents,
  agentsReportedAt,
  lastSeenAt,
  syncCapable = deviceId != null,
  statusLine,
  onRename,
  onRemove,
  onDisconnect,
  disconnectConfirmMessage,
  disconnectLabel = 'Disconnect',
}: {
  label: string
  deviceId?: string
  clientKind?: string | null
  /**
   * Every kind that has connected for this machine. Absent (old registry) →
   * single-kind fallback; present → one icon tile per kind (R8/R9).
   */
  clientKinds?: string[] | null
  clientPlatform?: string | null
  agents?: string[]
  agentsReportedAt?: number | null
  /** Unix seconds of the device's last authenticated registry call. */
  lastSeenAt?: number | null
  /** When false, hide kit routing — legacy signing-only rows. */
  syncCapable?: boolean
  /** Overrides the runtimes / not-syncing line under the header. */
  statusLine?: string
  onRename?: (next: string) => Promise<string | null>
  onRemove?: () => void
  onDisconnect?: () => void | Promise<void>
  disconnectConfirmMessage?: string
  /** Disconnect button label (default: Disconnect). */
  disconnectLabel?: string
}) {
  const [kits, setKits] = useState<RoutableKit[] | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Any authenticated call counts as seen — a machine that syncs but has not
  // reported runtimes yet still shows a live timestamp, not a blank.
  const seenAt = Math.max(agentsReportedAt ?? 0, lastSeenAt ?? 0)
  const lastSeenLine =
    syncCapable && seenAt > 0 ? `Last seen ${timeAgo(seenAt, { suffix: true })}` : null

  // client_kinds present (new registry) drives the icon cluster; absent falls
  // back to the single client_kind tile. An empty array means "no kind info"
  // and renders the generic tile — it never falls back (R9).
  const clusterIcons =
    clientKinds != null ? deviceClientKindsIcons(clientKinds, clientPlatform, label) : null
  const clientKindLine =
    clientKinds != null
      ? deviceClientKindsLabel(clientKinds, clientPlatform)
      : deviceClientKindLabel(clientKind, clientPlatform)
  const clientIcon =
    clientKinds != null ? null : deviceClientKindIcon(clientKind, clientPlatform, label)
  const displayLabel = label?.trim() || 'this machine'

  const handleDisconnect = () => {
    if (!onDisconnect || disconnecting) return
    setConfirmOpen(true)
  }

  const confirmDisconnect = () => {
    if (!onDisconnect || disconnecting) return
    setConfirmOpen(false)
    setDisconnecting(true)
    void Promise.resolve(onDisconnect()).catch(() => {
      setDisconnecting(false)
    })
  }

  useEffect(() => {
    if (!syncCapable) return
    const controller = new AbortController()
    void (async () => {
      try {
        const reqs: Promise<Response>[] = [
          fetch(registryAuthApi('kits/mine'), {
            headers: { accept: 'application/json' },
            signal: controller.signal,
          }),
        ]
        if (deviceId) {
          reqs.push(
            fetch(registryAuthApi(`devices/${deviceId}/sync`), {
              credentials: 'include',
              headers: { accept: 'application/json' },
              signal: controller.signal,
            }),
          )
        }
        const [mineRes, syncRes] = await Promise.all(reqs)
        if (!mineRes.ok) return
        setKits(toRoutable((await mineRes.json()) as MineResponse))
        if (syncRes?.ok) {
          const body = (await syncRes.json()) as { excluded?: string[] }
          setExcluded(new Set(body.excluded ?? []))
        }
      } catch {
        /* aborted or offline */
      }
    })()
    return () => controller.abort()
  }, [deviceId, syncCapable])

  const persist = async (next: Set<string>, previous: Set<string>) => {
    if (!deviceId) return
    try {
      const res = await fetch(registryAuthApi(`devices/${deviceId}/sync`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ excluded: [...next] }),
      })
      if (!res.ok) {
        setExcluded(previous)
        setSaveError('Could not save kit sync settings.')
        return
      }
      setSaveError(null)
    } catch {
      setExcluded(previous)
      setSaveError('Could not save kit sync settings.')
    }
  }

  const agentList = agents ?? []
  // Detected runtimes render as glyphs; the text line is only the fallback
  // (a legacy status override, or the "nothing detected yet" hint).
  const showAgentGlyphs = !statusLine && agentList.length > 0
  const runtimeLine = statusLine ?? 'No runtimes reported yet'

  const total = kits?.length ?? 0
  const onCount = kits ? kits.filter((k) => !excluded.has(k.key)).length : 0
  // A short list is just switches (the common case, Apple-clean). A long one
  // earns a header (count + bulk toggle) and scrolls, so 50 kits stay usable
  // without a wall of manual toggles or an endless card.
  const isLongList = total > 6
  const summary = !syncCapable
    ? null
    : kits === null
      ? 'Loading…'
      : total === 0
        ? 'No kits'
        : onCount === total
          ? 'All kits'
          : `${onCount} of ${total} kits`

  const toggle = (key: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      void persist(next, prev)
      return next
    })

  // "Disable all" excludes every current kit; "Enable all" clears the set.
  const setAll = (on: boolean) => {
    setExcluded((prev) => {
      const next = on ? new Set<string>() : new Set((kits ?? []).map((k) => k.key))
      void persist(next, prev)
      return next
    })
  }

  const iconGlyph = (icon: DeviceClientIcon | null) =>
    icon === 'apple' ? (
      <Apple className="h-[1.35rem] w-[1.35rem]" />
    ) : icon === 'windows' ? (
      <Windows className="h-5 w-5" />
    ) : icon === 'desktop' ? (
      <Desktop className="h-5 w-5" />
    ) : icon === 'terminal' ? (
      <Terminal className="h-5 w-5" />
    ) : (
      <Device className="h-5 w-5" />
    )
  const iconTileClass =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-(--line) text-(--ink-2)'
  // One machine, one tile: its primary form-factor / platform glyph (the cluster
  // is ordered device-first, so [0] is it). The combined "Mac app and CLI" nuance
  // rides the aria-label/tooltip instead of a second competing box.
  const primaryIcon: DeviceClientIcon | null =
    clusterIcons != null ? (clusterIcons[0] ?? null) : clientIcon

  return (
    <li className="overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <span
          className="shrink-0"
          title={clientKindLine ?? undefined}
          aria-label={clientKindLine ?? 'Device'}
          data-testid="device-kind-icons"
        >
          <span className={iconTileClass}>{iconGlyph(primaryIcon)}</span>
        </span>

        <div className="min-w-0 flex-1">
          {/* Rename stays visible next to the name it changes (a quiet pencil). */}
          {onRename ? (
            <DeviceLabelEditor
              label={label}
              fallback="Unnamed agent"
              maxLength={80}
              onSave={onRename}
            />
          ) : (
            <span className="truncate text-sm font-semibold text-(--ink)">{label}</span>
          )}
          {/* One meta line: runtime glyphs, then last-seen — same shape as the
              MCP row so the list scans as a single grid. */}
          {showAgentGlyphs ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {agentList.slice(0, 6).map((key) => (
                <span
                  key={key}
                  title={runtimeLabel(key)}
                  aria-label={runtimeLabel(key)}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-(--ink-2)"
                >
                  <AgentGlyph runtime={key} className="h-3.5 w-3.5" />
                </span>
              ))}
              {agentList.length > 6 && (
                <span className="text-xs text-(--ink-3)">+{agentList.length - 6}</span>
              )}
              {lastSeenLine ? (
                <span className="ml-1.5 text-xs text-(--ink-3)">{lastSeenLine}</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 truncate text-xs text-(--ink-2)">
              {runtimeLine}
              {lastSeenLine ? <span className="text-(--ink-3)"> · {lastSeenLine}</span> : null}
            </p>
          )}
        </div>

        {syncCapable ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Collapse kits' : 'Expand kits'}
            className="flex shrink-0 items-center gap-2 text-(--ink-2) hover:text-(--ink)"
          >
            {summary != null ? (
              <span className="hidden text-xs text-(--ink-3) sm:inline">{summary}</span>
            ) : null}
            <span
              className="inline-flex"
              style={{
                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)',
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </span>
          </button>
        ) : onRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="shrink-0">
            Remove preview
          </Button>
        ) : onDisconnect ? (
          <Button
            type="button"
            variant="danger-tertiary"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="shrink-0"
          >
            {disconnecting ? 'Removing…' : disconnectLabel}
          </Button>
        ) : null}
      </div>

      {syncCapable ? (
        <div
          className="grid"
          style={{
            gridTemplateRows: open ? '1fr' : '0fr',
            opacity: open ? 1 : 0,
            transition:
              'grid-template-rows 220ms cubic-bezier(0.23, 1, 0.32, 1), opacity 160ms ease-out',
          }}
        >
          <div className="overflow-hidden">
            <div className="border-t border-(--line)">
              {/* Kit sub-list is indented (nested under the device); device-level
                  rows like Disconnect stay full-width. */}
              <div className="pl-[4.25rem]">
              {kits !== null && total === 0 ? (
                <p className="py-3.5 pr-4 text-sm text-(--ink-2)">
                  No kits yet. Save a skill or curate a kit, then choose what syncs here.
                </p>
              ) : (
                <>
                  {saveError ? (
                    <p role="alert" className="pt-3 pr-4 text-xs text-(--danger)">
                      {saveError}
                    </p>
                  ) : null}
                  {/* Count on the left gives the bulk toggle a partner so it
                      never reads as a floating lone word. Nesting reads from the
                      hairline + indent. */}
                  <div className="flex items-center justify-between pb-2 pr-4 pt-3">
                    <span className="text-xs text-(--ink-3)">
                      {total} {pluralize(total, 'kit')}
                    </span>
                    <button
                      type="button"
                      className="rounded text-xs font-medium text-(--ink-2) transition-colors hover:text-(--ink)"
                      onClick={() => setAll(onCount !== total)}
                    >
                      {onCount === total ? 'Disable all' : 'Enable all'}
                    </button>
                  </div>
                  <ul
                    className={`divide-y divide-(--line)${
                      isLongList ? ' max-h-[22rem] overflow-y-auto' : ''
                    }`}
                  >
                    {(kits ?? []).map((k) => {
                      const href = kitRowHref(k)
                      return (
                        <li key={k.key} className="flex items-center gap-3.5 py-3.5 pr-4">
                          {href ? (
                            <Link href={href} className="inline-flex shrink-0" aria-label={k.name}>
                              <Cover kit={k} />
                            </Link>
                          ) : (
                            <Cover kit={k} />
                          )}
                          <div className="min-w-0 flex-1">
                            {href ? (
                              <Link
                                href={href}
                                className="block truncate text-sm font-medium text-(--ink) hover:underline"
                              >
                                {k.name}
                              </Link>
                            ) : (
                              <p className="truncate text-sm font-medium text-(--ink)">{k.name}</p>
                            )}
                            <p className="truncate font-mono text-xs text-(--ink-2)">
                              {k.isSavedKit ? null : k.descriptor ? (
                                <>{k.descriptor}{' · '}</>
                              ) : (
                                <>
                                  <Link href={`/${k.owner}`} className="hover:underline">
                                    @{k.owner}
                                  </Link>
                                  {' · '}
                                </>
                              )}
                              {k.count} {pluralize(k.count, 'skill')}
                            </p>
                          </div>
                          <ToggleSwitch
                            checked={!excluded.has(k.key)}
                            onChange={() => toggle(k.key)}
                            ariaLabel={`Sync ${k.name} to this device`}
                          />
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
              </div>
              {onRemove ? (
                <div className="flex justify-end border-t border-(--line) py-3 pr-4 pl-5">
                  <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
                    Remove preview
                  </Button>
                </div>
              ) : onDisconnect ? (
                // Visible destructive row (Apple's "Sign Out" pattern): a real
                // full-width button with a hover wash, so it reads as a tappable
                // row rather than a floating word.
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="w-full border-t border-(--line) px-5 py-3.5 text-left text-sm font-medium text-(--danger) transition-colors hover:bg-(--danger-bg) disabled:opacity-50"
                >
                  {disconnecting ? 'Removing…' : `${disconnectLabel} ${displayLabel}`}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* In-house confirm — never the browser's native confirm() chrome. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {/* Two lines and two buttons: confirm-sized, not form-sized. */}
        <DialogContent className="w-[min(92vw,400px)]">
          <DialogTitle className="text-base font-semibold text-(--ink)">
            {disconnectLabel} {displayLabel}?
          </DialogTitle>
          <p className="mt-2 text-sm leading-relaxed text-(--ink-2)">
            {disconnectConfirmMessage ??
              'Syncing stops. Skills already on it stay put, and you can reconnect anytime.'}
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="danger-secondary"
              size="sm"
              type="button"
              onClick={confirmDisconnect}
            >
              {disconnectLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}
