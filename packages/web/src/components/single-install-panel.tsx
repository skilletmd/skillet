'use client'

import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'

export function SingleInstallPanel({
  command,
  accent,
  slashCommand,
  lead = 'It\u2019s free, and every skill you add syncs into every AI tool on your computer, instantly.',
}: {
  command: string
  /** Substring highlighted gold in the command, e.g. `@owner/slug`. */
  accent?: string
  /** When the skill exposes a `/command`, show how to run it after install.
   *  Omitted for model-invoked-only skills (running is automatic — no line). */
  slashCommand?: string
  /** The sentence above the buttons. The default pitches install to someone who
   *  has not committed to anything yet, which is right on a skill page. A caller
   *  that only renders this AFTER an add (see {@link KitDelivery}) should say
   *  what just happened instead. */
  lead?: string
}) {
  return (
    <section>
      {/* A plain section like the page's others — no card. App first: the filled
          button is the goal (adds on Skillet auto-sync); the command is the quiet
          fallback, the one bordered copy field. */}
      <Eyebrow>Install</Eyebrow>
      <p className="mt-3 max-w-[64ch] text-sm leading-snug text-(--ink-2)">{lead}</p>
      <div className="mt-3 flex flex-wrap items-stretch gap-3">
        <Button href="/install" variant="primary" className="shrink-0">
          Get the Skillet app
        </Button>
        <span className="self-center text-xs font-medium uppercase tracking-wider text-(--ink-2)">
          or
        </span>
        <InlineCommand command={command} accent={accent} />
      </div>
      {slashCommand && (
        <p className="mt-3 text-sm text-(--ink-2)">
          Then run it with{' '}
          <code className="rounded border border-(--line) bg-(--surface) px-1.5 py-0.5 font-mono text-xs text-(--ink)">
            /{slashCommand}
          </code>
        </p>
      )}
    </section>
  )
}

// A single-line command field — the one bordered element in the module. No `$`,
// no scrollbar: long commands clip with a soft right-edge fade and the copy
// button (always visible) grabs the full string. Click anywhere to copy.
function InlineCommand({ command, accent }: { command: string; accent?: string }) {
  const { copied, copy } = useCopyToClipboard()

  const [before, after] =
    accent && command.includes(accent)
      ? [
          command.slice(0, command.indexOf(accent)),
          command.slice(command.indexOf(accent) + accent.length),
        ]
      : [command, '']

  return (
    <div
      onClick={() => void copy(command)}
      className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-(--line) bg-(--bg) px-3.5 font-mono text-xs transition-colors hover:border-(--ink-2)"
    >
      <span
        className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-(--ink)"
        style={{ maskImage: 'linear-gradient(to right, #000 calc(100% - 28px), transparent)' }}
      >
        {before}
        {accent && command.includes(accent) && <span className="text-(--accent)">{accent}</span>}
        {after}
      </span>
      <button
        type="button"
        aria-label="Copy command"
        className="shrink-0 text-(--ink-2) transition-colors hover:text-(--ink)"
        onClick={(e) => {
          e.stopPropagation()
          void copy(command)
        }}
      >
        {copied ? (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 8.5L6.5 12L13 4.5"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        )}
      </button>
    </div>
  )
}
