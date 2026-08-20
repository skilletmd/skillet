'use client'

import '@/components/skill-editor.css'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { SkillMarkdownEditor, type SkillEditorMode } from '@/components/skill-markdown-editor'
import { useRevealLine } from '@/components/use-reveal-line'
import {
  bundlePathError,
  decodeFile,
  entryFromBytes,
  entryFromText,
  formatBytes,
  isJunkPath,
  isLikelyExecutable,
  removeBundleFile,
  renameBundleFile,
  setBundleFile,
  SKILL_ENTRYPOINT,
  validateBundleFiles,
  type BundleFiles,
} from '@/lib/skill-bundle'

type DroppedFile = { path: string; file: File }

function isMarkdownPath(path: string): boolean {
  return path === SKILL_ENTRYPOINT || /\.(md|markdown)$/i.test(path)
}

// ---------------------------------------------------------------------------
// File tree.
//
// The bundle is a flat path→entry map; the rail renders it as a folder tree so
// nested files stay legible (a dozen `README.md` rows across a dozen folders are
// indistinguishable when you only show the basename). We build the tree, sort
// each level (SKILL.md pinned first at the root, then folders, then files), and
// flatten it to rows honoring per-folder collapse state.
// ---------------------------------------------------------------------------

type TreeNode =
  | { type: 'file'; name: string; path: string }
  | { type: 'dir'; name: string; path: string; children: TreeNode[] }

type TreeRow = { kind: 'file' | 'dir'; name: string; path: string; depth: number }

function buildFileTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = []
  const dirs = new Map<string, TreeNode[]>([['', root]])

  // Return (creating on the way) the children array for a directory path.
  function childrenOf(dirPath: string): TreeNode[] {
    const existing = dirs.get(dirPath)
    if (existing) return existing
    const slash = dirPath.lastIndexOf('/')
    const parent = slash === -1 ? '' : dirPath.slice(0, slash)
    const name = slash === -1 ? dirPath : dirPath.slice(slash + 1)
    const children: TreeNode[] = []
    childrenOf(parent).push({ type: 'dir', name, path: dirPath, children })
    dirs.set(dirPath, children)
    return children
  }

  for (const path of paths) {
    const slash = path.lastIndexOf('/')
    const dirPath = slash === -1 ? '' : path.slice(0, slash)
    const name = slash === -1 ? path : path.slice(slash + 1)
    childrenOf(dirPath).push({ type: 'file', name, path })
  }
  return root
}

function sortTree(nodes: TreeNode[], isRoot: boolean): void {
  nodes.sort((a, b) => {
    if (isRoot && a.path === SKILL_ENTRYPOINT) return -1
    if (isRoot && b.path === SKILL_ENTRYPOINT) return 1
    const aDir = a.type === 'dir'
    const bDir = b.type === 'dir'
    if (aDir !== bDir) return aDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const node of nodes) if (node.type === 'dir') sortTree(node.children, false)
}

function flattenTree(
  nodes: TreeNode[],
  collapsed: Set<string>,
  depth = 0,
  out: TreeRow[] = [],
): TreeRow[] {
  for (const node of nodes) {
    if (node.type === 'dir') {
      out.push({ kind: 'dir', name: node.name, path: node.path, depth })
      if (!collapsed.has(node.path)) flattenTree(node.children, collapsed, depth + 1, out)
    } else {
      out.push({ kind: 'file', name: node.name, path: node.path, depth })
    }
  }
  return out
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-3 w-3 shrink-0 transition-transform"
      style={{ transform: open ? 'rotate(90deg)' : 'none' }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 3 8 6l-3.5 3" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.13 2.44a1.55 1.55 0 0 1 2.2 2.2l-7.4 7.39-2.96.76.76-2.95z" />
    </svg>
  )
}

function SidebarIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <line x1="8" y1="4" x2="8" y2="16" />
      {open && <line x1="5.4" y1="7" x2="5.4" y2="7" strokeLinecap="round" />}
    </svg>
  )
}

/** `</>` — toggles rich text vs Markdown source (matches the view toolbar). */
function CodeToggleIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.5 6.5 4 10l3.5 3.5M12.5 6.5 16 10l-3.5 3.5M11.2 5.8 8.8 14.2" />
    </svg>
  )
}

/** Four-corner expand glyph for the full-screen toggle. */
function ExpandIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3H3v4M13 3h4v4M13 17h4v-4M7 17H3v-4" />
    </svg>
  )
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function readDirectory(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    const read = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all)
        } else {
          all.push(...batch)
          read()
        }
      }, reject)
    read()
  })
}

async function collectEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: DroppedFile[],
): Promise<void> {
  if (entry.isFile) {
    const file = await fileFromEntry(entry as FileSystemFileEntry)
    out.push({ path: `${prefix}${entry.name}`, file })
  } else if (entry.isDirectory) {
    const entries = await readDirectory((entry as FileSystemDirectoryEntry).createReader())
    for (const child of entries) await collectEntry(child, `${prefix}${entry.name}/`, out)
  }
}

function CodeFileEditor({
  path,
  value,
  onChange,
  revealLine,
  revealNonce,
}: {
  path: string
  value: string
  onChange: (value: string) => void
  revealLine?: number
  revealNonce?: number
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const revealFlash = useRevealLine(textareaRef, value, revealLine, revealNonce)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center border-b border-(--line) px-4 py-2 font-mono text-xs text-(--ink-2)">
        <span className="min-w-0 truncate">{path}</span>
      </div>
      {/* Relative + overflow-hidden so the scan-jump flash overlays the flagged
          line and clips at the textarea's edges. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          aria-label={`Editor for ${path}`}
          placeholder="File contents..."
          className="skill-editor-textarea h-full"
        />
        {revealFlash}
      </div>
    </div>
  )
}

function BinaryFileCard({
  path,
  size,
  executable,
  onReplace,
  onRemove,
}: {
  path: string
  size: number
  executable: boolean
  onReplace: () => void
  onRemove?: () => void
}) {
  return (
    <section className="px-5 py-6">
      <p className="font-mono text-sm text-(--ink)">{path}</p>
      <p className="mt-1 text-sm text-(--ink-2)">
        Binary file · {formatBytes(size)}. Binary files cannot be edited here.
      </p>
      {executable && (
        <p className="mt-3 rounded-lg border border-(--warning-line) bg-(--warning-bg) px-3 py-2 text-sm text-(--warning)">
          This looks like a script or executable. Anyone installing this skill is warned before it
          runs on their machine.
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button type="button" onClick={onReplace} variant="secondary">
          Replace
        </Button>
        {onRemove && (
          <Button type="button" onClick={onRemove} variant="danger-secondary">
            Remove
          </Button>
        )}
      </div>
    </section>
  )
}

export interface SkillFilesEditorProps {
  files: BundleFiles
  onChange: (files: BundleFiles) => void
  /** Controls rendered in the left of the top bar (e.g. the import row). */
  topBarLeft?: ReactNode
  /** Publish/submit controls, docked as the window footer. */
  footer?: ReactNode
  /** Extra actions for the SKILL.md markdown toolbar (e.g. reset template). */
  skillMdToolbarActions?: ReactNode
  /** A scan-findings jump request: open `path` in source mode and scroll to
   *  `line`. `nonce` re-triggers the same target. */
  reveal?: { path: string; line: number; nonce: number }
}

export function SkillFilesEditor({
  files,
  onChange,
  topBarLeft,
  footer,
  skillMdToolbarActions,
  reveal,
}: SkillFilesEditorProps) {
  const [selected, setSelected] = useState<string>(SKILL_ENTRYPOINT)
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null)
  // Paths dropped from an upload that can't live in a bundle (absolute/`..`/
  // illegal). Surfaced inline and dismissible — never a blocking alert.
  const [skippedUnsafe, setSkippedUnsafe] = useState<string[] | null>(null)
  const [dragActive, setDragActive] = useState(false)
  // null = follow the default (hidden until 2+ files); true/false = user override.
  const [railOverride, setRailOverride] = useState<boolean | null>(null)
  // Rail opens by default on roomy screens; small screens keep it collapsed
  // until there are multiple files. Initialized after mount to avoid an SSR
  // mismatch; a manual toggle (railOverride) always wins.
  const [largeScreen, setLargeScreen] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setLargeScreen(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const [mode, setMode] = useState<SkillEditorMode>('rich')
  const [fullscreen, setFullscreen] = useState(false)
  // Escape leaves full screen (matches the view overlay).
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])
  const lastRevealNonce = useRef(0)
  // A scan-findings jump: open the target file in source mode (you fix lines in
  // source, and the jump-to-line is a source-textarea behavior). The markdown
  // editor handles the actual scroll once it's the selected, source-mode view.
  useEffect(() => {
    if (!reveal || reveal.nonce === lastRevealNonce.current) return
    lastRevealNonce.current = reveal.nonce
    if (files[reveal.path]) setSelected(reveal.path)
    setMode('source')
  }, [reveal, files])
  const [editing, setEditing] = useState<{
    path: string
    draft: string
    isNew: boolean
    error: boolean
  } | null>(null)
  const dragDepth = useRef(0)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const paths = useMemo(() => Object.keys(files).sort(), [files])
  const validation = useMemo(() => validateBundleFiles(files), [files])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const rows = useMemo(() => {
    const tree = buildFileTree(paths)
    sortTree(tree, true)
    return flattenTree(tree, collapsed)
  }, [paths, collapsed])

  function toggleDir(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const selectedPath = files[selected] ? selected : SKILL_ENTRYPOINT
  const selectedEntry = files[selectedPath]
  const selectedDecoded = selectedEntry ? decodeFile(selectedEntry) : null

  function commit(next: BundleFiles, nextSelected?: string) {
    onChange(next)
    if (nextSelected) setSelected(nextSelected)
  }

  function updateText(path: string, text: string) {
    onChange(setBundleFile(files, path, entryFromText(text)))
  }

  function addFile() {
    // Create the file immediately and drop straight into inline rename.
    let path = 'untitled.md'
    let n = 2
    while (files[path]) path = `untitled-${n++}.md`
    setRailOverride(true)
    commit(setBundleFile(files, path, entryFromText('')), path)
    setEditing({ path, draft: path, isNew: true, error: false })
  }

  function beginRename(path: string) {
    if (path === SKILL_ENTRYPOINT) return
    setSelected(path)
    setEditing({ path, draft: path, isNew: false, error: false })
  }

  function commitRename() {
    if (!editing) return
    const from = editing.path
    const to = editing.draft.trim()
    if (!to || to === from) {
      setEditing(null)
      return
    }
    if (bundlePathError(to) || (files[to] && to !== from)) {
      setEditing({ ...editing, error: true })
      return
    }
    setEditing(null)
    commit(renameBundleFile(files, from, to), to)
  }

  function cancelRename() {
    if (!editing) return
    if (editing.isNew && files[editing.path]) {
      commit(removeBundleFile(files, editing.path), SKILL_ENTRYPOINT)
    }
    setEditing(null)
  }

  function finalizeRenameOnBlur() {
    if (!editing) return
    const from = editing.path
    const to = editing.draft.trim()
    if (!to || to === from || bundlePathError(to) || (files[to] && to !== from)) {
      cancelRename()
      return
    }
    setEditing(null)
    commit(renameBundleFile(files, from, to), to)
  }

  async function ingestPaths(records: Array<{ path: string; bytes: Uint8Array }>) {
    if (records.length === 0) return
    let next = { ...files }
    let lastPath = selectedPath
    const skippedUnsafe: string[] = []
    for (const { path: raw, bytes } of records) {
      const path = raw.trim()
      if (!path) continue
      // Build artifacts and OS cruft (.DS_Store, node_modules, .git…) are
      // dropped silently — nobody wants them in a skill, and flagging every
      // folder's .DS_Store on a drop is noise, not information.
      if (isJunkPath(path)) continue
      // Structurally-invalid paths can't be represented in a bundle (absolute,
      // `..`, control chars) and the registry rejects them at publish. Skip and
      // name them so the author sees exactly what didn't come in — no modal.
      if (bundlePathError(path)) {
        skippedUnsafe.push(path)
        continue
      }
      next = setBundleFile(next, path, entryFromBytes(bytes))
      lastPath = path
    }
    commit(next, lastPath)
    setSkippedUnsafe(skippedUnsafe.length > 0 ? skippedUnsafe : null)
  }

  async function onDrop(event: React.DragEvent<HTMLElement>) {
    const dataTransfer = event.dataTransfer
    const items = Array.from(dataTransfer.items ?? [])
    const hasFiles =
      (dataTransfer.files?.length ?? 0) > 0 || items.some((item) => item.kind === 'file')
    if (!hasFiles) {
      // Not a file drop (e.g. dragging text inside the editor) — let the default happen.
      dragDepth.current = 0
      setDragActive(false)
      return
    }
    event.preventDefault()
    dragDepth.current = 0
    setDragActive(false)

    const entries = items
      .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
      .filter((entry): entry is FileSystemEntry => entry != null)

    const records: Array<{ path: string; bytes: Uint8Array }> = []

    if (entries.length > 0) {
      // A single dropped folder is the bundle root, so strip its top-level name.
      const stripTop = entries.length === 1 && entries[0].isDirectory
      const dropped: DroppedFile[] = []
      for (const entry of entries) await collectEntry(entry, '', dropped)
      for (const item of dropped) {
        const path = stripTop ? item.path.split('/').slice(1).join('/') : item.path
        records.push({ path, bytes: await readFileBytes(item.file) })
      }
    } else {
      for (const file of Array.from(event.dataTransfer.files)) {
        records.push({ path: file.name, bytes: await readFileBytes(file) })
      }
    }

    await ingestPaths(records)
  }

  function onDragEnter(event: React.DragEvent<HTMLElement>) {
    // Only light up for file drags, not text dragged within the editor.
    const types = Array.from(event.dataTransfer.types ?? [])
    if (types.length > 0 && !types.includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }

  function onDragOver(event: React.DragEvent<HTMLElement>) {
    // Must always preventDefault so the browser allows the drop. Some browsers
    // (notably Safari) do not list 'Files' in types until drop, so we can't gate on it.
    event.preventDefault()
    try {
      event.dataTransfer.dropEffect = 'copy'
    } catch {
      // dropEffect can be read-only in some engines; ignore.
    }
  }

  function onDragLeave() {
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragActive(false)
    }
  }

  function removePath(path: string) {
    if (path === SKILL_ENTRYPOINT) return
    if (!window.confirm(`Remove ${path}?`)) return
    commit(removeBundleFile(files, path), path === selected ? SKILL_ENTRYPOINT : selected)
  }

  function startReplace(path: string) {
    setReplaceTarget(path)
    replaceInputRef.current?.click()
  }

  async function onReplaceChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !replaceTarget) return
    const bytes = await readFileBytes(file)
    onChange(setBundleFile(files, replaceTarget, entryFromBytes(bytes)))
    setReplaceTarget(null)
  }

  const isBinary = !!selectedDecoded?.binary
  const isMd = !!selectedDecoded && !selectedDecoded.binary && isMarkdownPath(selectedPath)
  const decodedText = selectedDecoded && !selectedDecoded.binary ? (selectedDecoded.text ?? '') : ''
  // Open by default on large screens, or whenever a skill has more than its
  // single SKILL.md. The toggle (railOverride) overrides either default.
  const railShown = railOverride ?? (largeScreen || paths.length > 1)

  return (
    <>
      {skippedUnsafe && skippedUnsafe.length > 0 && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-(--warning-line) bg-(--warning-bg) px-4 py-2.5 text-sm text-(--warning)">
          <div className="min-w-0">
            <p>
              {skippedUnsafe.length} file{skippedUnsafe.length === 1 ? '' : 's'} couldn’t be added.
              Their paths aren’t allowed in a skill (absolute paths, “..”, or illegal characters):
            </p>
            <ul className="mt-1 font-mono text-xs">
              {skippedUnsafe.slice(0, 8).map((path) => (
                <li key={path} className="truncate">
                  {path}
                </li>
              ))}
              {skippedUnsafe.length > 8 && <li>+{skippedUnsafe.length - 8} more</li>}
            </ul>
          </div>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-label="Dismiss"
            className="shrink-0"
            onClick={() => setSkippedUnsafe(null)}
          >
            ×
          </Button>
        </div>
      )}
      {validation.errors.length > 0 && (
        <div className="mb-3 space-y-2">
          {validation.errors.map((message) => (
            <p
              key={message}
              className="rounded-lg border border-(--danger-line) bg-(--danger-bg) px-4 py-2.5 text-sm text-(--danger)"
            >
              {message}
            </p>
          ))}
        </div>
      )}

      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={(event) => void onDrop(event)}
        className={`relative overflow-hidden surface-card ${
          fullscreen ? 'fixed inset-0 z-50 flex flex-col rounded-none' : ''
        }`}
      >
        {/* Top bar: import + file controls left, editor controls right */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-(--line) px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Button
              variant="icon"
              type="button"
              onClick={() => setRailOverride(!railShown)}
              className="shrink-0"
              title={railShown ? 'Hide files' : 'Show files'}
              aria-label={railShown ? 'Hide files' : 'Show files'}
              aria-pressed={railShown}
            >
              <SidebarIcon open={railShown} />
            </Button>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-(--ink-2)">
              {selectedPath}
            </span>
            {topBarLeft}
          </div>
          <div className="flex items-center gap-1">
            {isMd && (
              <Button
                variant="icon"
                type="button"
                onClick={() => setMode((m) => (m === 'rich' ? 'source' : 'rich'))}
                className="shrink-0 aria-pressed:bg-(--accent-bg)"
                aria-pressed={mode === 'source'}
                title={mode === 'rich' ? 'Show Markdown source' : 'Show rich text'}
                aria-label={mode === 'rich' ? 'Show Markdown source' : 'Show rich text'}
              >
                <CodeToggleIcon />
              </Button>
            )}
            {selectedPath === SKILL_ENTRYPOINT && skillMdToolbarActions}
            <Button
              variant="icon"
              type="button"
              onClick={() => setFullscreen((f) => !f)}
              className="shrink-0 aria-pressed:bg-(--accent-bg)"
              aria-pressed={fullscreen}
              title={fullscreen ? 'Exit full screen' : 'Full screen'}
              aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            >
              <ExpandIcon />
            </Button>
          </div>
        </div>

        {/* Body: quiet rail (only when multi-file) + single surface */}
        <div className={`flex min-h-0 ${fullscreen ? 'flex-1' : 'h-[clamp(440px,64vh,720px)]'}`}>
          {railShown && (
            <aside className="flex w-[208px] shrink-0 flex-col border-r border-(--line)">
              <ul className="skill-rail-scroll min-h-0 flex-1 overflow-auto py-2">
                {rows.map((row) => {
                  const path = row.path
                  const indent = `${16 + row.depth * 12}px`
                  if (row.kind === 'dir') {
                    const isCollapsed = collapsed.has(path)
                    return (
                      <li key={`dir:${path}`}>
                        <button
                          type="button"
                          onClick={() => toggleDir(path)}
                          title={path}
                          aria-expanded={!isCollapsed}
                          className="skill-rail-item min-w-0"
                          style={{ paddingLeft: indent }}
                        >
                          <Chevron open={!isCollapsed} />
                          <span className="min-w-0 flex-1 truncate">{row.name}</span>
                        </button>
                      </li>
                    )
                  }
                  const decoded = decodeFile(files[path])
                  const isEntry = path === SKILL_ENTRYPOINT
                  const executable = isLikelyExecutable(path, decoded.bytes)
                  const active = path === selectedPath
                  const isEditing = editing?.path === path
                  if (isEditing) {
                    return (
                      <li key={path} className="px-2 py-0.5" style={{ paddingLeft: indent }}>
                        <input
                          ref={(el) => {
                            if (el && el.dataset.init !== '1') {
                              el.dataset.init = '1'
                              el.focus()
                              el.select()
                            }
                          }}
                          value={editing.draft}
                          onChange={(event) =>
                            setEditing({ ...editing, draft: event.target.value, error: false })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              commitRename()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelRename()
                            }
                          }}
                          onBlur={finalizeRenameOnBlur}
                          className={`w-full rounded-md border bg-(--surface) px-2 py-1 font-mono text-xs text-(--ink) outline-none ${
                            editing.error ? 'border-(--danger-line)' : 'border-(--accent)'
                          }`}
                        />
                      </li>
                    )
                  }
                  return (
                    // Actions overlay the row's right edge on hover instead of
                    // reserving layout space — the filename gets the full rail
                    // width, and the tail fades under the overlay's gradient.
                    <li key={path} className="group relative flex items-center">
                      <button
                        type="button"
                        onClick={() => setSelected(path)}
                        onDoubleClick={() => beginRename(path)}
                        title={path}
                        data-active={active}
                        className="skill-rail-item min-w-0 flex-1"
                        style={{ paddingLeft: indent }}
                      >
                        <span className="min-w-0 flex-1 truncate">{row.name}</span>
                        {decoded.binary && (
                          <span className="shrink-0 text-xs text-(--ink-2)">bin</span>
                        )}
                        {executable && (
                          <span className="shrink-0 text-xs text-(--warning)">exec</span>
                        )}
                      </button>
                      {!isEntry && (
                        <span
                          className="pointer-events-none absolute inset-y-0 right-0 flex items-center pl-6 pr-1.5 opacity-0 transition focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                          style={{
                            background:
                              'linear-gradient(to right, transparent, var(--surface) 20px)',
                          }}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            title="Rename"
                            aria-label={`Rename ${path}`}
                            onClick={() => beginRename(path)}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            variant="danger-tertiary"
                            size="sm"
                            type="button"
                            title="Remove"
                            aria-label={`Remove ${path}`}
                            onClick={() => removePath(path)}
                          >
                            ×
                          </Button>
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
              <div className="border-t border-(--line) px-2 py-1.5">
                <Button
                  variant="quiet"
                  type="button"
                  onClick={addFile}
                  className="w-full justify-start"
                  title="New file or folder"
                >
                  + New file
                </Button>
              </div>
            </aside>
          )}

          <div className="min-h-0 min-w-0 flex-1">
            {selectedDecoded == null ? null : isBinary ? (
              <BinaryFileCard
                path={selectedPath}
                size={selectedDecoded.bytes.length}
                executable={isLikelyExecutable(selectedPath, selectedDecoded.bytes)}
                onReplace={() => startReplace(selectedPath)}
                onRemove={
                  selectedPath === SKILL_ENTRYPOINT ? undefined : () => removePath(selectedPath)
                }
              />
            ) : isMd ? (
              <SkillMarkdownEditor
                mode={mode}
                value={decodedText}
                onChange={(value) => updateText(selectedPath, value)}
                showMetadata={selectedPath === SKILL_ENTRYPOINT}
                revealLine={reveal && reveal.path === selectedPath ? reveal.line : undefined}
                revealNonce={reveal && reveal.path === selectedPath ? reveal.nonce : undefined}
              />
            ) : (
              <CodeFileEditor
                path={selectedPath}
                value={decodedText}
                onChange={(value) => updateText(selectedPath, value)}
                revealLine={reveal && reveal.path === selectedPath ? reveal.line : undefined}
                revealNonce={reveal && reveal.path === selectedPath ? reveal.nonce : undefined}
              />
            )}
          </div>
        </div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-(--line) px-3 py-2">
            {footer}
          </div>
        )}

        {dragActive && (
          <div
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
            style={{ background: 'color-mix(in srgb, var(--accent-bg) 78%, transparent)' }}
          >
            <span className="rounded-xl border-2 border-dashed border-(--accent) bg-(--surface) px-5 py-3 text-sm font-medium text-(--ink) shadow-sm">
              Drop files to upload
            </span>
          </div>
        )}
      </div>

      <input
        ref={replaceInputRef}
        type="file"
        hidden
        onChange={(event) => void onReplaceChange(event)}
      />
    </>
  )
}
