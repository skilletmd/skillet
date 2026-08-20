'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { pluralize } from '@/lib/format'
import type { ProposalFileDiff } from '@/lib/types'

// The markdown renderer is heavy and only used for added-file previews, so it
// stays out of the initial bundle (same split as the notifications feed).
const MarkdownPreview = dynamic(() => import('./notifications/markdown-preview'), {
  loading: () => <span className="text-(--ink-2)">Loading…</span>,
})

// Compact prose for the added-file preview — sized for a review panel, not a
// reading column.
const PREVIEW_PROSE =
  'text-sm leading-[1.6] text-(--ink) ' +
  '[&_h1]:mb-2 [&_h1]:mt-0 [&_h1]:text-base [&_h1]:font-semibold ' +
  '[&_h2]:mb-1.5 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold ' +
  '[&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold ' +
  '[&_p]:mb-2.5 ' +
  '[&_ul]:mb-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul>li]:mb-0.5 ' +
  '[&_ol]:mb-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol>li]:mb-0.5 ' +
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-(--bg) [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-xs ' +
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-(--bg) [&_pre]:p-3 [&_pre]:text-xs ' +
  '[&_a]:text-(--accent) [&_strong]:font-semibold'

/** Drop the YAML frontmatter block so the preview reads as content, not config. */
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/)
  return m ? md.slice(m[0].length).replace(/^\n+/, '') : md
}

/** CRLF sources leave a trailing `\r` on every line after splitting on `\n`. */
function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

type CleanLine = { type: 'add' | 'del' | 'ctx'; text: string }

/**
 * Parse the registry's unified diff positionally, not by matching each line
 * against a header pattern. The serializer (registry lib/diff.ts) emits the two
 * file-header lines (`--- a/…`, `+++ b/…`) first, then `@@ -N,N +N,N @@` hunk
 * headers, then content lines each prefixed with a single `+`/`-`/space. So the
 * file headers live only at the top, and every content line is classified by
 * its FIRST CHARACTER.
 *
 * That distinction is load-bearing for review integrity: an added line whose
 * text is `++ b/…` serializes to `+++ b/…`, and a per-line pattern match would
 * mistake it for the `+++ b/` file header and drop it from the rendered diff,
 * the counts, and the added-file preview — hiding it from the owner while it
 * still lands in the approved, hash-signed content. Positionally it is just an
 * `add` whose text happens to begin with `+`. Hunk headers and the
 * `\ No newline` marker start with neither `+`/`-`/space, so they fall through
 * as non-content without a pattern that content could imitate.
 */
function parseDiff(diff: string): CleanLine[] {
  const lines = diff.split('\n').map(stripCr)
  // Drop the leading file-header block. The serializer emits the two header
  // lines (`--- …` / `+++ …`) as a pair at the top, or omits both (diffs that
  // begin at the first `@@` hunk). They come as a pair, so strip only when BOTH
  // are present at positions 0/1 — never a lone header-shaped line, which lower
  // down is real content (a deleted `-- a/x` serializes to `--- a/x`).
  const start = lines[0]?.startsWith('--- ') && lines[1]?.startsWith('+++ ') ? 2 : 0

  const out: CleanLine[] = []
  for (let i = start; i < lines.length; i++) {
    const marker = lines[i][0]
    if (marker === '+') out.push({ type: 'add', text: lines[i].slice(1) })
    else if (marker === '-') out.push({ type: 'del', text: lines[i].slice(1) })
    else if (marker === ' ') out.push({ type: 'ctx', text: lines[i].slice(1) })
    // Hunk headers (`@@ …`), the `\ No newline at end of file` marker, and the
    // empty trailing split carry no content — skip them.
  }
  return out
}

/** Reconstruct the added text from a unified diff (the `+` lines, minus the marker). */
function addedContent(diff: string): string {
  return parseDiff(diff)
    .filter((l) => l.type === 'add')
    .map((l) => l.text)
    .join('\n')
}

function countDiffLines(diff: string | null): { additions: number; deletions: number } {
  if (!diff) return { additions: 0, deletions: 0 }
  let additions = 0
  let deletions = 0
  for (const l of parseDiff(diff)) {
    if (l.type === 'add') additions++
    else if (l.type === 'del') deletions++
  }
  return { additions, deletions }
}

/** SKILL.md is a proposal's implicit subject, so its name adds nothing; every
 *  other single-file path is worth showing so the reviewer knows what changed. */
function isSkillMd(path: string): boolean {
  return path === 'SKILL.md' || path.endsWith('/SKILL.md')
}

const GUTTER_GLYPH = { add: '+', del: '−', ctx: ' ' } as const

/** What one file's change looks like: rendered content for a brand-new file,
 *  a colour-coded line view for an edit, plain fallbacks otherwise. */
function FileBody({ file }: { file: ProposalFileDiff }) {
  if (file.binary) {
    return <p className="px-3 py-2 text-sm text-(--ink-2)">Binary file. No preview.</p>
  }
  if (!file.diff) {
    return <p className="px-3 py-2 text-sm text-(--ink-2)">No text changes.</p>
  }
  if (file.status === 'added') {
    // A brand-new file reads best as its rendered content, not a wall of green
    // diff — framed as Added (green rail + label) so it reads as "what got added".
    return (
      <div className="px-3 py-2">
        <Badge variant="success" appearance="chip" className="mb-2">
          <span aria-hidden="true">+</span> Added
        </Badge>
        <div className={`border-l-2 border-(--success-line) pl-3 ${PREVIEW_PROSE}`}>
          <MarkdownPreview>{stripFrontmatter(addedContent(file.diff))}</MarkdownPreview>
        </div>
      </div>
    )
  }
  return (
    <div className="font-mono text-xs leading-[1.6]">
      {parseDiff(file.diff).map((l, i) => (
        <div
          key={i}
          className={`flex px-3 py-px ${
            l.type === 'add'
              ? 'bg-(--success-bg) text-(--success)'
              : l.type === 'del'
                ? 'bg-(--danger-bg) text-(--danger)'
                : 'text-(--ink-2)'
          }`}
        >
          {/* Colour alone can't carry add/delete (colourblind users, screenshots),
              so a +/− gutter does too — aria-hidden and select-none so the marker
              never enters copied text or screen-reader output. */}
          <span aria-hidden="true" className="w-4 shrink-0 select-none">
            {GUTTER_GLYPH[l.type]}
          </span>
          <span
            className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${
              l.type === 'del' ? 'line-through decoration-(--danger-line)' : ''
            }`}
          >
            {l.text || ' '}
          </span>
        </div>
      ))}
    </div>
  )
}

function FileRow({
  file,
  counts,
  defaultExpanded,
}: {
  file: ProposalFileDiff
  counts: { additions: number; deletions: number }
  defaultExpanded: boolean
}) {
  const [open, setOpen] = useState(defaultExpanded)
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        <span aria-hidden="true" className="text-(--ink-2)">
          {open ? '▾' : '▸'}
        </span>
        <span className="min-w-0 break-all font-mono text-sm text-(--ink)">{file.path}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-xs">
          {file.binary ? (
            <span className="text-(--ink-2)">binary</span>
          ) : (
            <>
              <span className="text-(--success)">+{counts.additions}</span>
              <span className="text-(--danger)">−{counts.deletions}</span>
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto pb-3">
          <FileBody file={file} />
        </div>
      )}
    </li>
  )
}

/**
 * The one renderer for a `ProposalFileDiff[]` — proposals, update cards, and
 * previews all show a diff through this. Files that changed are grouped with a
 * count summary; each edit is a colour-coded (plus gutter-marked) line view and
 * each brand-new file is rendered as its content.
 */
export function FileDiff({
  files,
  defaultExpanded = false,
  showCountHeader = true,
  framed = true,
}: {
  files: ProposalFileDiff[]
  /** Render every file's diff open instead of collapsed behind its row. */
  defaultExpanded?: boolean
  /** Hide the "N files changed +A −D" summary line. */
  showCountHeader?: boolean
  /** Wrap a single-file diff in a bordered, scroll-contained frame so its rows
   *  don't bleed to the page edge. Off when the caller already supplies a frame
   *  (e.g. the update card's own bordered panel). Multi-file diffs are always
   *  framed by their file-list border. */
  framed?: boolean
}) {
  // The server includes unchanged files in the diff payload; the review surface
  // only lists files that actually changed.
  const changed = files.filter((f) => f.status !== 'unchanged')
  if (changed.length === 0) {
    return <p className="px-3 py-2 text-sm text-(--ink-2)">No changes.</p>
  }

  const counts = changed.map((f) => countDiffLines(f.diff))
  const totalAdd = counts.reduce((n, c) => n + c.additions, 0)
  const totalDel = counts.reduce((n, c) => n + c.deletions, 0)

  return (
    <div>
      {showCountHeader && (
        <div className="flex flex-wrap items-center gap-3 font-mono text-sm text-(--ink-2)">
          <span>
            <span className="text-(--ink)">{changed.length}</span>{' '}
            {pluralize(changed.length, 'file')} changed
          </span>
          <span className="text-(--success)">+{totalAdd}</span>
          <span className="text-(--danger)">−{totalDel}</span>
        </div>
      )}

      {changed.length === 1 ? (
        // One file: skip the collapse row and show the change directly. Show the
        // path unless it's SKILL.md (the proposal's implicit subject), so a
        // single non-SKILL.md change isn't an unlabeled diff.
        <div className={showCountHeader ? 'mt-3' : ''}>
          {!isSkillMd(changed[0].path) && (
            <div className="mb-1 break-all font-mono text-sm text-(--ink-2)">
              {changed[0].path}
            </div>
          )}
          {framed ? (
            <div className="overflow-hidden rounded-xl border border-(--line)">
              <div className="overflow-x-auto">
                <FileBody file={changed[0]} />
              </div>
            </div>
          ) : (
            <FileBody file={changed[0]} />
          )}
        </div>
      ) : (
        <ul
          className={`divide-y divide-(--line) overflow-hidden rounded-xl border border-(--line) ${showCountHeader ? 'mt-4' : ''}`}
        >
          {changed.map((f, i) => (
            <FileRow key={f.path} file={f} counts={counts[i]} defaultExpanded={defaultExpanded} />
          ))}
        </ul>
      )}
    </div>
  )
}
