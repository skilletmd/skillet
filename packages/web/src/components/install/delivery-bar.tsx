'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { InstallActions } from '@/components/install/install-picker'
import { AgentGlyph } from '@/components/agent-glyph'
import { runtimeLabel } from '@/lib/runtime-labels'

/**
 * What follows Add, on a kit page or a skill page.
 *
 * Adding puts the thing on your account and nothing on your machine, so install
 * is not an alternative to Add, it is the rest of it. This is the second half of
 * that one action, and it is shared rather than written twice: the two pages ask
 * the same question, and a copy of this that drifted would answer it differently
 * depending on which page you happened to land on.
 *
 * The rules:
 *
 *  - **Only while it still asks something.** Added with a client connected means
 *    it already worked; the bar says how to use it, not that it synced. Added
 *    with nowhere to land is the one state with real unfinished business.
 *  - **Growth is caused, never surprising.** No reserved height: idle costs
 *    nothing, and the spring opens the page in response to your press, which is
 *    what makes the movement read as yours.
 *  - **Critically damped.** A press carries no momentum, so bounce would be
 *    decoration. Bounce is earned by a flick.
 *  - **It leaves the way it came**, along the same 4px path from under the
 *    buttons, so the bar belongs to the row above it.
 */
export type DeliveryState = 'none' | 'install' | 'run'

export function DeliveryBar({
  state,
  runtimes,
  mcpUrl,
  /** What the install line calls the thing you just added. */
  noun,
  signedIn = true,
}: {
  state: DeliveryState
  runtimes: readonly string[]
  mcpUrl?: string | null
  noun: string
  signedIn?: boolean
}) {
  const reduce = useReducedMotion()
  const spring = reduce
    ? { duration: 0.12 }
    : ({ type: 'spring', bounce: 0, duration: 0.4 } as const)

  return (
    <div>
      {/* popLayout, not the default: two bars coexist for the length of a
          crossfade, and in normal flow the outgoing one would keep its height
          and shove the incoming one down while it left. Not `wait`, which
          would hold the new bar back until the old one finished. */}
      <AnimatePresence initial={false} mode="popLayout">
        {state !== 'none' && (
          <motion.div
            key={state}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, height: 0 }}
            transition={spring}
            style={{ transformOrigin: 'top' }}
            className="overflow-hidden"
          >
            {/* Margin inside the animated box so it collapses with it. On the
                outside it would leave a gap behind when the bar goes. */}
            <div className="pt-4">
              <Notice>
                {state === 'run' ? (
                  <RunIt runtimes={runtimes} />
                ) : (
                  <FinishInstall noun={noun} mcpUrl={mcpUrl} signedIn={signedIn} />
                )}
              </Notice>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * The bar's surface.
 *
 * `--surface` on the page's `--bg`, which is the house elevation: a white card
 * on warm off-white, separated by a hairline rather than a heavy edge. NOT
 * `--accent-bg`, which is the exact beige of the Added button directly above it,
 * so a tinted box would fuse with the button into one shape instead of reading
 * as a thing the button produced.
 *
 * The attention is carried by the entrance and by sitting under the press that
 * caused it. Color would be shouting on top of that.
 */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-(--line) bg-(--surface) px-4 py-3.5 shadow-sm">
      {children}
    </div>
  )
}

function RunIt({ runtimes }: { runtimes: readonly string[] }) {
  // runtimeLabel falls back to the raw key, so an unknown runtime still reads as
  // something rather than vanishing.
  const shown = runtimes
  const names = shown.map(runtimeLabel).join(', ')

  return (
    <div>
      {/* One row: the claim, the glyphs that prove it, and the way out.

          No success mark here. The Added button directly above already carries
          one, and two checks stacked a few pixels apart read as a stutter; the
          install state opens with plain text too, so the states now match.

          The spelled-out names had their own line and grew without bound (five
          runtimes already wrapped; there are eight). The glyphs identify the
          same set in fixed width, so the names moved to hover and to assistive
          tech rather than costing a permanent line. */}
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-(--ink)">
          <span className="shrink-0">Ready in your agents</span>
          {shown.length > 0 && (
            <span className="flex -space-x-1.5">
              {shown.map((r) => (
                <span
                  key={r}
                  title={runtimeLabel(r)}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-(--line) bg-(--bg) text-(--ink) ring-2 ring-(--surface)"
                >
                  <AgentGlyph runtime={r} className="h-3.5 w-3.5" />
                </span>
              ))}
              {/* Hover is not available on touch and title is weak for screen
                  readers, so the list stays in the accessibility tree. */}
              <span className="sr-only">{names}</span>
            </span>
          )}
        </p>
        <Link
          href="/settings"
          className="shrink-0 text-xs text-(--ink-2) underline-offset-2 hover:text-(--ink) hover:underline"
        >
          Manage
        </Link>
      </div>
      <p className="mt-3 text-sm text-(--ink-2)">
        Just say{' '}
        <code className="rounded-md border border-(--line) bg-(--bg) px-1.5 py-0.5 font-mono text-xs text-(--ink)">
          /skillet
        </code>{' '}
        and what you want.
      </p>
    </div>
  )
}

/**
 * Three layers: what state you are in, why you would care, and the doors.
 *
 * Not a bespoke "app or npx" pair, which is what this was: that pair silently
 * drops the third way in, and the third way is the one that installs nothing and
 * the only one that works on a phone.
 */
function FinishInstall({
  noun,
  mcpUrl,
  signedIn,
}: {
  noun: string
  mcpUrl?: string | null
  signedIn: boolean
}) {
  return (
    <div>
      {/* One line, not a headline and a sub. The state and the reason are the
          same sentence, and the doors under it say the rest. */}
      <p className="mb-3.5 max-w-[60ch] text-sm text-(--ink)">
        <span className="font-semibold">Install Skillet</span> where you want to use this {noun}:
      </p>
      <InstallActions signedIn={signedIn} mcpUrl={mcpUrl} />
    </div>
  )
}
