// Pure render logic for the ?view=viewer window (customize-in-place, U6).
//
// Two concerns, both pure (string in → string out) so they're testable without
// Tauri or a live window — the DOM wiring in viewer.ts stays thin:
//   1. renderMarkdownToSafeHtml — untrusted skill markdown → sanitized HTML.
//      marked → DOMPurify → link guard. Skill bodies are untrusted local
//      content (an author or agent wrote them), so nothing reaches innerHTML
//      without sanitizing AND inerting hostile link schemes (R13, AE6).
//   2. diffToHtml — the `edit_diff` JSON (yours-vs-theirs) → a diff view (R12).

import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { isSafeUntrustedHref } from '@skillet/protocol/untrusted-href'
import { escapeHtml } from './escape-html'

// One shared guard hook (module-level so it registers exactly once). DOMPurify
// already drops `javascript:`/`data:` on its own, but the shared guard is the
// single source of truth for link-scheme safety across web + desktop — so we
// re-check every anchor here and INERT anything it rejects: strip the href
// (the link becomes plain, un-clickable text) rather than trusting the default
// allowlist. Safe links get rel/target hardening.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName !== 'A') return
  const el = node as Element
  const href = el.getAttribute('href')
  if (href === null) return
  if (isSafeUntrustedHref(href)) {
    el.setAttribute('rel', 'noopener noreferrer nofollow')
    el.setAttribute('target', '_blank')
  } else {
    el.removeAttribute('href')
    el.removeAttribute('target')
  }
})

/** Untrusted skill markdown → sanitized, link-guarded HTML ready for innerHTML. */
export function renderMarkdownToSafeHtml(md: string): string {
  const rawHtml = marked.parse(md, { async: false, gfm: true }) as string
  return DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target', 'rel'] })
}

// ── diff (yours vs theirs) ────────────────────────────────────────────────────
// `edit_diff` → `skillet edits diff <skill> --json` returns a per-file status of
// the LIVE tree (yours) against the current upstream bundle (theirs):
//   { ok, skill, customized, hasUpdate, held?, files: [{ path, status }] }
// `added`/`removed`/`changed` are relative to yours: you added a file, you
// removed one the author still ships, or the bytes differ. `hunks`/`binary` are
// optional — the JSON is file-level today, so a file with no hunks renders as a
// status row; if a richer diff ever carries line hunks, they render inline.

export type EditDiffFileStatus = 'added' | 'removed' | 'changed' | 'unchanged'

export type EditDiffLine = { kind: 'add' | 'del' | 'ctx'; text: string }

export type EditDiffFile = {
  path: string
  status: EditDiffFileStatus
  /** True when the file is binary/non-text — content can't be shown as lines. */
  binary?: boolean
  /** Optional line-level hunk, when the diff source carries one. */
  hunks?: EditDiffLine[]
}

export type EditDiffJson = {
  ok?: boolean
  skill?: string
  customized?: boolean
  hasUpdate?: boolean
  error?: string
  files?: EditDiffFile[]
}

/** Tolerant parse of the `edit_diff` stdout — never throws; malformed → error shape. */
export function parseEditDiff(raw: string): EditDiffJson {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, error: 'empty diff output', files: [] }
  try {
    const parsed = JSON.parse(trimmed) as EditDiffJson
    if (!Array.isArray(parsed.files)) parsed.files = []
    return parsed
  } catch {
    return { ok: false, error: 'could not parse diff output', files: [] }
  }
}

/** Files that actually differ — `unchanged` is noise in a reconcile view. */
export function changedFiles(files: EditDiffFile[]): EditDiffFile[] {
  return files.filter((f) => f.status !== 'unchanged')
}


function hunkHtml(lines: EditDiffLine[]): string {
  const rows = lines
    // Drop blank added/removed lines — a trailing-newline diff renders as an empty
    // green/red row, which reads as meaningless noise to a non-technical user.
    .filter((l) => l.kind === 'ctx' || l.text.trim() !== '')
    .map((l) => {
      // The CLI orients hunks yours→baseline, so a line YOU added arrives as 'del'.
      // Flip for display: your additions read as green +, your removals as red −.
      const shown = l.kind === 'add' ? 'del' : l.kind === 'del' ? 'add' : 'ctx'
      const sign = shown === 'add' ? '+' : shown === 'del' ? '−' : ' '
      return `<div class="vw-line vw-line-${shown}"><span class="vw-line-sign">${sign}</span><span class="vw-line-text">${escapeHtml(l.text)}</span></div>`
    })
    .join('')
  return `<div class="vw-hunk">${rows}</div>`
}

/**
 * The `edit_diff` files → a yours-vs-theirs diff view. Each changed file is a
 * labelled row (+/−/~ · path · status); a binary file says so instead of
 * showing bytes; line hunks, when present, render beneath the file. Empty (no
 * changed files) is a clean "nothing to reconcile" state, not a blank panel.
 */
export function diffToHtml(files: EditDiffFile[]): string {
  const changed = changedFiles(files)
  if (changed.length === 0) {
    return `<div class="vw-diff-empty">No changes yet. This matches the original.</div>`
  }
  // Written for non-technical readers: no git chrome (~/+/− file marks, filenames,
  // "changed" badges). A single-file skill is the common case — show just the
  // changes. A bundle keeps a quiet filename so you know which file each change is in.
  const single = changed.length === 1
  const blocks = changed
    .map((f) => {
      const head = single ? '' : `<div class="vw-diff-head">${escapeHtml(f.path)}</div>`
      let detail = ''
      if (f.binary) {
        detail = `<div class="vw-diff-note">Image or binary file, not shown.</div>`
      } else if (f.hunks && f.hunks.length > 0) {
        detail = hunkHtml(f.hunks)
      }
      return `<div class="vw-diff-file">${head}${detail}</div>`
    })
    .join('')
  return `<div class="vw-diff">${blocks}</div>`
}

// ── Multi-file bundle (viewer sidebar) ───────────────────────────────────────

/** One entry in a skill's bundle, from the `skill_files` IPC manifest. */
export type SkillFileEntry = { rel: string; size: number; binary: boolean }

/** The `skill_file` IPC payload for a single file's contents. */
export type SkillFileContent = {
  rel: string
  binary: boolean
  tooBig: boolean
  size: number
  content: string
}

/** Markdown files render; everything else shows as raw/monospace text. */
export function fileIsMarkdown(rel: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(rel)
}

/** Compact byte size for the sidebar ("1.2 KB", "3.4 MB"). */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let n = bytes / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

/** A node in the sidebar file tree: a folder (with children) or a leaf file. */
export type FileTreeNode =
  | { kind: 'file'; rel: string; name: string; size: number; binary: boolean }
  | { kind: 'dir'; name: string; path: string; children: FileTreeNode[] }

/**
 * Group a flat bundle manifest into a nested folder tree. Ordering per level:
 * SKILL.md first (it's the entry point), then folders, then files, each group
 * case-insensitive by name. Pure so the sidebar rendering stays testable.
 */
export function buildFileTree(files: SkillFileEntry[]): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const dirChildren = new Map<string, FileTreeNode[]>([['', root]])
  const ensureDir = (path: string): FileTreeNode[] => {
    const existing = dirChildren.get(path)
    if (existing) return existing
    const slash = path.lastIndexOf('/')
    const parentPath = slash === -1 ? '' : path.slice(0, slash)
    const name = slash === -1 ? path : path.slice(slash + 1)
    const siblings = ensureDir(parentPath)
    const node: FileTreeNode = { kind: 'dir', name, path, children: [] }
    siblings.push(node)
    dirChildren.set(path, node.children)
    return node.children
  }
  for (const f of files) {
    const slash = f.rel.lastIndexOf('/')
    const dirPath = slash === -1 ? '' : f.rel.slice(0, slash)
    const name = slash === -1 ? f.rel : f.rel.slice(slash + 1)
    ensureDir(dirPath).push({ kind: 'file', rel: f.rel, name, size: f.size, binary: f.binary })
  }
  sortFileTree(root)
  return root
}

function sortFileTree(nodes: FileTreeNode[]): void {
  nodes.sort((a, b) => {
    const aSkill = a.kind === 'file' && a.rel === 'SKILL.md'
    const bSkill = b.kind === 'file' && b.rel === 'SKILL.md'
    if (aSkill !== bSkill) return aSkill ? -1 : 1
    if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })
  for (const n of nodes) if (n.kind === 'dir') sortFileTree(n.children)
}

// ── Frontmatter header card ──────────────────────────────────────────────────

/** Parsed SKILL.md frontmatter: the description, the remaining fields as a flat
 *  key/value list (one level of nesting flattened to `parent.child`), and the
 *  body with the frontmatter block removed. */
export type Frontmatter = {
  description: string | null
  fields: { key: string; value: string }[]
  body: string
}

/**
 * Parse a leading `---`-fenced YAML block into a description + flat fields, for
 * the viewer's header card (matches the web's rendered SKILL.md). Deliberately
 * lightweight — top-level `key: value` scalars plus one level of nested map
 * (`metadata:` → `metadata.author`). `name`/`description` are pulled out; the
 * rest become table rows. No frontmatter → empty fields and the body untouched.
 */
export function parseFrontmatter(raw: string): Frontmatter {
  const m = raw.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { description: null, fields: [], body: raw }
  const body = raw.slice(m[0].length)
  const fields: { key: string; value: string }[] = []
  let description: string | null = null
  let parent: string | null = null
  const unquote = (v: string): string => v.replace(/^["']([\s\S]*)["']$/, '$1').trim()
  const lines = m[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const kv = line.match(/^(\s*)([A-Za-z0-9_.\- ]+?):\s*(.*)$/)
    if (!kv) continue
    const indent = kv[1].length
    const key = kv[2].trim()
    let value = unquote(kv[3])
    // YAML block scalar (`>`/`|` with optional chomping): the value is the
    // following deeper-indented lines — folded to one line for the card.
    // Without this, `description: >-` rendered a literal ">-" and dropped
    // the actual text.
    if (/^[>|][+-]?$/.test(value)) {
      const chunk: string[] = []
      while (i + 1 < lines.length) {
        const next = lines[i + 1]
        if (next.trim() && next.match(/^\s*/)![0].length <= indent) break
        chunk.push(next.trim())
        i++
      }
      value = chunk.filter(Boolean).join(' ')
    }
    if (indent === 0) {
      parent = null
      if (value === '') {
        parent = key // a nested map follows
        continue
      }
      if (key.toLowerCase() === 'description') description = value
      else if (key.toLowerCase() !== 'name') fields.push({ key, value })
    } else if (value !== '') {
      fields.push({ key: parent ? `${parent}.${key}` : key, value })
    }
  }
  return { description, fields, body }
}

/** The frontmatter card HTML (description + a key/value table). Empty string
 *  when there's nothing to show, so callers can prepend it unconditionally. */
export function frontmatterCardHtml(fm: Frontmatter): string {
  if (!fm.description && fm.fields.length === 0) return ''
  const desc = fm.description ? `<p class="vw-fm-desc">${escapeHtml(fm.description)}</p>` : ''
  const rows = fm.fields
    .map(
      (f) =>
        `<div class="vw-fm-row"><dt class="vw-fm-key">${escapeHtml(f.key)}</dt><dd class="vw-fm-val">${escapeHtml(f.value)}</dd></div>`,
    )
    .join('')
  const table = rows ? `<dl class="vw-fm-fields">${rows}</dl>` : ''
  return `<div class="vw-fm">${desc}${table}</div>`
}
