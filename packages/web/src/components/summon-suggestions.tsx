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

  const heading = voice === 'first-person' ? 'Summon me for' : `People summon @${author} for`

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
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--ink-subtle)">
        {heading}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {suggestions.map((s) => {
          const line = summonSuggestionLine(author, s.task)
          return (
            <li key={s.ref}>
              <button
                type="button"
                onClick={() => void copy(line)}
                title={`Copy. Uses ${s.ref}`}
                className="group flex w-full items-center justify-between gap-3 rounded-lg border border-(--rule) bg-(--surface) px-3 py-2 text-left transition-colors hover:border-(--ink-subtle)"
              >
                <code className="min-w-0 truncate font-mono text-sm text-(--ink)">{line}</code>
                <span className="shrink-0 text-xs text-(--ink-subtle)">
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
