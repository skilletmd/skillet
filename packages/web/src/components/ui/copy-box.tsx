'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'

/**
 * Click-anywhere-to-copy box in the CommandBlock chrome — the signature
 * copyable-string treatment (design/00-foundations.md) for strings that
 * aren't shell commands: pair codes, URLs. Same border, radius, background,
 * and copy glyph; no `$` prompt. `disabled` keeps the box visible but inert
 * (an expired code stays legible without looking copyable).
 */
export function CopyBox({
  value,
  ariaLabel,
  disabled = false,
  className,
  children,
}: {
  /** The string written to the clipboard (may differ from what renders). */
  value: string
  ariaLabel: string
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={() => void copy(value)}
      className={cn(
        // min-h (not padding) sets the height so every copyable box on a
        // surface stands the same tall regardless of its text size — matches
        // CommandBlock md (py-3 + text-sm ≈ 44px).
        'command-block group flex min-h-11 w-full items-center gap-3 px-4 py-1.5 text-left transition-colors duration-200',
        disabled ? 'cursor-default opacity-50' : 'cursor-pointer hover:border-(--accent)',
        className,
      )}
    >
      {children}
      <span className="w-4 shrink-0 text-(--ink-2)" aria-hidden="true">
        {disabled ? null : copied ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8.5L6.5 12L13 4.5"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        )}
      </span>
    </button>
  )
}
