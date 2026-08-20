'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'

// The signature component (design/00-foundations.md): the install CTA is a
// command, not a button. Clicking anywhere on the block copies it.
export function CommandBlock({
  command,
  accent,
  size = 'md',
  wrap = false,
  className,
  prompt = '$',
  bare = false,
}: {
  command: string
  /** Substring rendered in gold, e.g. "@taylor/deploy-ritual". */
  accent?: string
  size?: 'sm' | 'md' | 'lg'
  wrap?: boolean
  className?: string
  /** Leading prompt glyph. `$` for shell; pass null for agent/slash commands. */
  prompt?: string | null
  /** Lighter treatment (no elevated box) for command lines nested in a card. */
  bare?: boolean
}) {
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
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 text-left font-mono transition-colors duration-200',
        bare
          ? 'rounded-lg border border-(--line) bg-(--bg) hover:border-(--ink-2)'
          : 'command-block hover:border-(--accent)',
        size === 'lg'
          ? 'px-5 py-4 text-base sm:text-lg'
          : size === 'sm'
            ? 'gap-2 px-3 py-2.5 text-xs'
            : 'px-4 py-3 text-sm',
        className,
      )}
    >
      {prompt ? <span className="select-none text-(--ink-2)">{prompt}</span> : null}
      <span
        className={`min-w-0 flex-1 text-(--ink) ${
          wrap ? 'whitespace-normal break-all leading-[1.45]' : 'overflow-x-auto whitespace-nowrap'
        }`}
      >
        {before}
        {accent && command.includes(accent) && <span className="text-(--accent)">{accent}</span>}
        {after}
      </span>
      <Button
        variant="icon"
        type="button"
        aria-label="Copy command"
        className="shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          void copy(command)
        }}
      >
        {copied ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {/* Strokes itself in, so the copy reads as something that just
                happened rather than a glyph that was always there. */}
            <path
              className="copy-check-path"
              d="M3 8.5L6.5 12L13 4.5"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect
              x="5.5"
              y="5.5"
              width="8"
              height="8"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path
              d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        )}
      </Button>
    </div>
  )
}
