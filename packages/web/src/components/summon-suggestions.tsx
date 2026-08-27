'use client'

/**
 * The three paste-ready lines at the top of a profile.
 *
 * A profile is otherwise a shelf: a grid of cards whose only action is `+`,
 * which asks a visitor to commit before anything has been proven to them. These
 * lines are the opposite trade — copy one, paste it into any agent, get a
 * result with nothing installed. That is also what makes a shared profile link
 * worth following.
 *
 * Every line was generated from a skill that exists in this author's kit and is
 * still public, so pasting one resolves rather than misses.
 */
import { useState } from 'react'
import { summonSuggestionLine } from '@skillet/protocol/summon-suggestions'

interface Props {
  author: string
  suggestions: Array<{ task: string; ref: string }>
  /** An unclaimed mirror is described, never spoken for. */
  voice?: 'first-person' | 'third-person'
}

export function SummonSuggestions({ author, suggestions, voice = 'third-person' }: Props) {
  const [copied, setCopied] = useState<string | null>(null)

  // Absent and empty both render nothing. An empty state here would be a
  // placeholder apologising for a kit that simply has nothing to suggest.
  if (suggestions.length === 0) return null

  const heading =
    voice === 'first-person' ? 'Summon me for:' : `People summon @${author} for:`

  async function copy(line: string) {
    try {
      await navigator.clipboard.writeText(line)
      setCopied(line)
      window.setTimeout(() => setCopied((c) => (c === line ? null : c)), 1600)
    } catch {
      // A denied clipboard is not worth an error state; the line is on screen
      // and selectable either way.
    }
  }

  return (
    <section className="mb-8" aria-label="Suggested invocations">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--ink-2)">
        {heading}
      </h2>
      {/* Lines, not form fields. Each sits on the recessive card surface with no
          border and shrinks to its own width, so three of them read as things
          you copy rather than three inputs waiting to be filled in. The copy
          hint stays hidden until hover or keyboard focus — repeating "Copy"
          down the column competes with the lines themselves. */}
      <ul className="flex flex-col items-start gap-1">
        {suggestions.map((s) => {
          const line = summonSuggestionLine(author, s.task)
          return (
            <li key={s.ref} className="max-w-full">
              <button
                type="button"
                onClick={() => void copy(line)}
                title={`Copy. Uses ${s.ref}`}
                className="group flex max-w-full items-center gap-3 rounded-md bg-(--card-soft) px-2.5 py-1.5 text-left transition-colors hover:bg-(--accent-bg)"
              >
                <code className="min-w-0 truncate font-mono text-sm text-(--ink)">{line}</code>
                <span
                  aria-live="polite"
                  className={`shrink-0 text-xs text-(--ink-2) transition-opacity ${
                    copied === line ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                  }`}
                >
                  {copied === line ? 'Copied' : 'Copy'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
