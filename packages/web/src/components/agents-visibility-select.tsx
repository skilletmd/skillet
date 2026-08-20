'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { Plus } from '@/components/ui/icons'
import { RUNTIME_LABELS, EXTRA_AGENTS, runtimeLabel } from '@/lib/runtime-labels'
import { AgentGlyph } from '@/components/agent-glyph'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { updateShownAgents } from '@/lib/profile-update'

/** The agents Skillet detects on a device — always shown as chips (a verified check
 *  appears on the ones actually detected). */
const COMMON_AGENTS = Object.keys(RUNTIME_LABELS)
/** Stable display order for the persisted list: detectable first, then long-tail. */
export const ORDER = [...COMMON_AGENTS, ...EXTRA_AGENTS]

/**
 * Chip multi-select for the public "Runs on" row. Shows one chip per agent you've
 * selected or that's detected on a connected device (detected ones carry a verified
 * check) — the same set the read-only card renders. Every other agent is opt-in via
 * the "Add agent" menu. No master switch — deselecting everything hides the row.
 * Optimistic, reverts on failure.
 */
export function AgentsVisibilitySelect({
  handle,
  detectedAgents,
  initialShown,
  onSelectedChange,
}: {
  handle: string
  /** Device-detected union — drives the verified mark and pre-fills the selection. */
  detectedAgents: string[]
  /** Raw curated selection; `null` = uncurated (pre-fill to all detected). */
  initialShown: string[] | null
  /** Notified (optimistically) whenever the selection changes — lets a parent
   *  mirror the picks for a read-only display without owning persistence. */
  onSelectedChange?: (selected: Set<string>) => void
}) {
  const detectedSet = new Set(detectedAgents)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialShown ?? detectedAgents),
  )
  const [pending, setPending] = useState(false)

  // Chips: agents detected on a device (always shown, with a verified check, so you
  // can toggle them even when off) plus your current picks — exactly what the
  // read-only card shows. Canonical order first, then any detected agent we don't
  // have a label for. Everything else (undetected detectable agents and the long
  // tail) lives behind "Add agent".
  const visibleSet = new Set([...detectedAgents, ...selected])
  const visible = [
    ...ORDER.filter((key) => visibleSet.has(key)),
    ...[...visibleSet].filter((key) => !ORDER.includes(key)),
  ]
  // Menu: every known agent not already a chip, sorted A–Z by label.
  const menuOptions = ORDER.filter((key) => !visibleSet.has(key)).sort((a, b) =>
    runtimeLabel(a).localeCompare(runtimeLabel(b)),
  )

  async function commit(next: Set<string>) {
    if (pending) return
    const prev = selected
    setSelected(next) // optimistic
    onSelectedChange?.(next)
    setPending(true)
    try {
      const ordered = [...new Set([...ORDER, ...next])].filter((k) => next.has(k))
      await updateShownAgents(handle, ordered)
    } catch {
      setSelected(prev) // revert on failure
      onSelectedChange?.(prev)
    } finally {
      setPending(false)
    }
  }

  function toggle(key: string) {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    void commit(next)
  }

  function add(key: string) {
    if (!key || selected.has(key)) return
    void commit(new Set(selected).add(key))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((key) => {
        const on = selected.has(key)
        const verified = detectedSet.has(key)
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            disabled={pending}
            aria-pressed={on}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-200 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:cursor-not-allowed',
              on
                ? 'border-(--ink) bg-(--ink)/[0.04] text-(--ink) hover:bg-(--ink)/[0.07]'
                : 'border-(--line) bg-transparent text-(--ink-3) hover:border-(--ink-3) hover:text-(--ink-2)',
            )}
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center',
                on ? 'text-(--ink)' : 'text-(--ink-3) opacity-50',
              )}
            >
              <AgentGlyph runtime={key} className="h-4 w-4" />
            </span>
            {runtimeLabel(key)}
            {/* Verified = detected on a connected device. A quiet trailing check —
                no disc, so it never collides with the agent's mark. */}
            {verified && (
              <span
                aria-label="Verified"
                title="Detected on a connected device"
                className="flex h-4 w-4 shrink-0 items-center justify-center text-(--success)"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-[15px] w-[15px]"
                >
                  <path d="M13 4.5 6.5 11 3 7.5" />
                </svg>
              </span>
            )}
          </button>
        )
      })}

      {menuOptions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-(--line) bg-transparent px-3 py-1.5 text-sm font-medium text-(--ink-2) transition-colors hover:border-(--ink-2) hover:text-(--ink) disabled:cursor-not-allowed data-[state=open]:border-(--ink-2) data-[state=open]:text-(--ink)"
            >
              <Plus className="h-3.5 w-3.5" />
              Add agent
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-y-auto">
            {menuOptions.map((key) => (
              <DropdownMenuItem key={key} onSelect={() => add(key)} className="gap-2.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-(--ink)">
                  <AgentGlyph runtime={key} className="h-4 w-4" />
                </span>
                {runtimeLabel(key)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
