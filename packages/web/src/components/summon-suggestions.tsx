'use client'

/**
 * The three paste-ready lines at the top of a profile.
 *
 * A profile is otherwise a shelf: a grid of cards whose only action is `+`,
 * which asks a visitor to commit before anything has been proven to them. These
 * lines are the opposite trade. Copy one, paste it into any agent, get a result
 * with nothing installed. That is also what makes a shared profile link worth
 * following.
 *
 * Every line was generated from a skill that exists in this author's kit and is
 * still public, so pasting one resolves rather than misses.
 */
import { useRef } from 'react'
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'
import { registryAuthApi } from '@/lib/registry-proxy'
import { CopyGlyph, CopiedGlyph } from '@/components/ui/copy-glyph'
import { summonSuggestionLine } from '@skillet/protocol/summon-suggestions'

/**
 * Tell the registry a line was copied. Anonymous and aggregate — see
 * registry lib/suggestion-copy-events.ts.
 *
 * Every failure path is swallowed. This number is ours, not the visitor's: a
 * blocked request, an offline browser, or a 500 must leave the row behaving
 * exactly as it does with the network unplugged.
 */
async function reportSuggestionCopy(author: string, skillRef: string): Promise<void> {
  try {
    await fetch(registryAuthApi(`authors/${encodeURIComponent(author)}/suggestions/copy`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: skillRef }),
      keepalive: true,
    })
  } catch {
    // Counting is not the visitor's problem.
  }
}

interface Props {
  author: string
  suggestions: Array<{ task: string; ref: string }>
  /** An unclaimed mirror is described, never spoken for. */
  voice?: 'first-person' | 'third-person'
}

/**
 * One row. A component per line rather than a copied-ref in the parent, because
 * `useCopyToClipboard` tracks a single boolean and each row confirms its own
 * copy.
 */
function SuggestionRow({ author, task, skillRef }: { author: string; task: string; skillRef: string }) {
  const { copied, copy } = useCopyToClipboard()
  const reported = useRef(false)
  const line = summonSuggestionLine(author, task)

  /**
   * Copy first, count second, and never let the count affect the copy.
   *
   * The clipboard write is the thing the visitor asked for; the count is ours.
   * A failed or blocked report must leave the row behaving exactly as it does
   * offline — the text on the clipboard and the glyph flipped.
   *
   * Reported once per row per mount. Someone mashing the same line is not three
   * people wanting it, and this number only means something if it counts
   * intent rather than clicks.
   */
  async function copyAndCount() {
    await copy(line)
    if (reported.current) return
    reported.current = true
    void reportSuggestionCopy(author, skillRef)
  }

  return (
    <li className="max-w-full">
      <button
        type="button"
        onClick={() => void copyAndCount()}
        title={`Copy. Uses ${skillRef}`}
        aria-label={`Copy ${line}`}
        className="group flex max-w-full items-center gap-2.5 rounded-md bg-(--card-soft) px-2.5 py-1.5 text-left transition-colors hover:bg-(--accent-bg)"
      >
        <code className="min-w-0 truncate font-mono text-sm text-(--ink)">{line}</code>
        {/* Below the label in contrast: the line carries the meaning, this only
            says the row copies. Same pair the install command uses. */}
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-(--ink-2)"
        >
          {copied ? <CopiedGlyph /> : <CopyGlyph />}
        </span>
        <span className="sr-only" role="status">
          {copied ? 'Copied' : ''}
        </span>
      </button>
    </li>
  )
}

export function SummonSuggestions({ author, suggestions, voice = 'third-person' }: Props) {
  // Absent and empty both render nothing. An empty state here would be a
  // placeholder apologising for a kit that simply has nothing to suggest.
  if (suggestions.length === 0) return null

  const heading = voice === 'first-person' ? 'Summon me for:' : `People summon @${author} for:`

  return (
    <section className="mb-8" aria-label="Suggested invocations">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--ink-2)">
        {heading}
      </h2>
      {/* Lines, not form fields. No border, the recessive card surface, each row
          shrunk to its own width, so three of them read as things you copy
          rather than three inputs waiting to be filled in. */}
      <ul className="flex flex-col items-start gap-1">
        {suggestions.map((s) => (
          <SuggestionRow key={s.ref} author={author} task={s.task} skillRef={s.ref} />
        ))}
      </ul>
    </section>
  )
}
