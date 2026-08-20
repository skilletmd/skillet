/**
 * The actual source at an evidence location, for inline review in the trust
 * panel. Caps a range to 3 lines (the permalink covers full context), and
 * DEDENTS — strips the common leading whitespace so a picked-out line sits
 * flush-left instead of staggering by nesting depth. Null if the slice is
 * blank. Computed on the server from the bundle text so only these few lines
 * cross the RSC boundary — never whole files (see skill-page-view).
 */
export function evidenceSnippet(
  source: string | undefined,
  start: number,
  end: number,
): string | null {
  if (typeof source !== 'string') return null
  const lines = source.split('\n')
  const slice = lines.slice(
    Math.max(0, start - 1),
    Math.min(lines.length, Math.max(start, end), start + 2),
  )
  const indents = slice.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)?.[0].length ?? 0)
  const dedent = indents.length ? Math.min(...indents) : 0
  const joined = slice
    .map((l) => l.slice(dedent))
    .join('\n')
    .replace(/\s+$/, '')
  return joined.trim() ? joined : null
}
