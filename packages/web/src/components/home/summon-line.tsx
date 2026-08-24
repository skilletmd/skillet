import { CommandBlock } from '@/components/command-block'

/** The handle the hero demonstrates. Fixed rather than rotating: `SummonDemo`
 *  beside it already cycles five authors to show breadth, and this block's job
 *  is the opposite — one line stable enough to copy. Real mirrored author with
 *  a real public kit, so the URL in it resolves. */
const HANDLE = '@mattpocock'
const SUMMON_LINE = `Read skillet.md/${HANDLE}/summon and use their best skill to review my PR`

/**
 * The borrow rung, as one copyable line.
 *
 * This is the hero's only action, and it costs nothing: no account, no CLI, no
 * files on disk. Any agent that can fetch a URL completes the whole flow,
 * because `/{handle}/summon` returns the candidate list with descriptions and
 * the routing instruction lives in the sentence the user already typed.
 *
 * It replaced an install box. The headline promises borrowing, so asking for a
 * package manager in the same breath contradicted it before the visitor had
 * seen a single reason to install anything. Install now lives in the adopt band
 * further down the page, where it is the answer to a question the visitor has
 * actually formed.
 */
export function SummonLine() {
  return (
    <div className="mx-auto mt-10 w-full max-w-[520px] lg:mx-0">
      <p className="text-sm font-medium text-(--ink)">Try it now, nothing installed</p>
      <CommandBlock
        command={SUMMON_LINE}
        accent={HANDLE}
        prompt={null}
        size="sm"
        wrap
        className="mt-2"
      />
      <p className="mt-2 px-1 text-xs text-(--ink-2)">
        Paste it into Claude Code, Cursor, Codex, or ChatGPT.
      </p>
    </div>
  )
}
