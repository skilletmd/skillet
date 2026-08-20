'use client'

import '@/components/skill-editor.css'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { ChevronDown } from '@/components/ui/icons'
import { MarkdownContent } from '@/components/markdown-content'
import { useViewerSync } from '@/components/skills/viewer-sync'
import { SkillDownloadMenu } from '@/components/skills/skill-download-menu'
import { formatBytes, SKILL_ENTRYPOINT } from '@/lib/skill-bundle'
import { pluralize } from '@/lib/format'
import { SKILLET_EVENTS } from '@/lib/events'
import type { SkillBundleFileEntry } from '@/lib/skill-bundle-content'
import { bundleImageResolver, bundleImageUrl, type SkillBundleAssets } from '@/lib/bundle-images'
import { isInlineImagePath } from '@skillet/protocol/inline-images'

// Mirrors the canonical markdown family in the registry's file-classes primitive
// (packages/registry/src/scanner/file-classes.ts MARKDOWN_EXTENSIONS). The web
// is a separate package and can't import registry internals; a shared
// @skillet/protocol constant is the deferred end-state. `.mdc` = Cursor rules.
function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|mdc|markdown)$/i.test(path)
}

/**
 * Read-only file browser for a multi-file skill — the public mirror of the
 * edit/create page's file rail. Same window chrome and `skill-rail-*` styling as
 * {@link SkillFilesEditor} (not a new look), but it groups paths into
 * collapsible folders instead of a flat indented list and renders content
 * read-only. SKILL.md is shown above this, so only supporting files appear here.
 */

interface TreeNode {
  name: string
  path: string
  /** Present on folders. */
  children?: TreeNode[]
  /** Present on files. */
  file?: SkillBundleFileEntry
}

function buildTree(files: SkillBundleFileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    parts.forEach((name, i) => {
      const isLeaf = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')
      const kids = (node.children ??= [])
      let child = kids.find((c) => c.name === name && Boolean(c.file) === isLeaf)
      if (!child) {
        child = isLeaf ? { name, path, file } : { name, path, children: [] }
        kids.push(child)
      }
      node = child
    })
  }
  const sortNodes = (nodes: TreeNode[]) => {
    // Folders first, then files, each alphabetical — like a file explorer.
    nodes.sort((a, b) => {
      const af = a.children ? 0 : 1
      const bf = b.children ? 0 : 1
      return af - bf || a.name.localeCompare(b.name)
    })
    for (const n of nodes) if (n.children) sortNodes(n.children)
  }
  sortNodes(root.children!)
  return root.children!
}

/** Every directory path in the tree — used to start the rail fully collapsed. */
function collectFolderPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.children) {
      paths.push(node.path)
      paths.push(...collectFolderPaths(node.children))
    }
  }
  return paths
}

const BINARY_FALLBACK = <p className="text-sm text-(--ink-2)">Binary file. No preview available.</p>

/** Inline preview for an image file selected in the tree. A load failure falls
 *  back to the binary message (never a broken-image icon); keyed by src at the
 *  call site so the failed state resets when the selection changes. */
function ImagePreview({ src, alt, size }: { src: string; alt: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) return BINARY_FALLBACK
  return (
    <figure className="flex flex-col items-center gap-2">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="max-w-full"
        onError={() => setFailed(true)}
      />
      <figcaption className="font-mono text-xs text-(--ink-2)">{formatBytes(size)}</figcaption>
    </figure>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <ChevronDown
      className={`h-2.5 w-2.5 shrink-0 text-(--ink-2) transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
    />
  )
}

/** `</>` — toggles between rendered Markdown and raw source. */
function CodeIcon() {
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

export function SkillFileTree({
  files,
  skillMdSlot,
  author,
  slug,
  loadingPath,
  errorPath,
  onRetryLoad,
  assets,
  headerAction,
  compact,
}: {
  files: SkillBundleFileEntry[]
  /** Server-rendered SKILL.md markdown, shown when the entry file is selected. */
  skillMdSlot?: ReactNode
  author: string
  slug: string
  loadingPath?: string | null
  errorPath?: string | null
  onRetryLoad?: () => void
  /** Raw-image URL context — enables markdown image resolution + image previews. */
  assets?: SkillBundleAssets
  /** Optional trailing control in the header bar (e.g. the Expand-to-overlay icon). */
  headerAction?: ReactNode
  /** Half-height viewport for the inline preview; the overlay runs full height. */
  compact?: boolean
}) {
  // SKILL.md is pinned at the top of the rail (the entry), not sorted into the
  // folder tree — everything else groups into folders below it.
  const entry = useMemo(() => files.find((f) => f.path === SKILL_ENTRYPOINT), [files])
  const supporting = useMemo(() => files.filter((f) => f.path !== SKILL_ENTRYPOINT), [files])
  const tree = useMemo(() => buildTree(supporting), [supporting])
  const defaultPath =
    entry?.path ?? [...supporting].sort((a, b) => a.path.localeCompare(b.path))[0]?.path ?? ''
  // Selected file + rendered/source mode are SHARED with the expand overlay when
  // one exists (via FilesSection's ViewerSyncContext), so expanding opens the same
  // file in the same mode instead of resetting to the root. Standalone (no
  // provider) → local state, unchanged. A ref keeps the setters stable so effects
  // that depend on them don't re-subscribe every time the selection changes.
  const sync = useViewerSync()
  const syncRef = useRef(sync)
  syncRef.current = sync
  const [localSelected, setLocalSelected] = useState<string>(defaultPath)
  const [localMode, setLocalMode] = useState<'rendered' | 'source'>('rendered')
  const selected = sync ? (sync.selected ?? defaultPath) : localSelected
  const mode = sync ? sync.mode : localMode
  const setSelected = useCallback((path: string) => {
    const s = syncRef.current
    if (s) s.setSelected(path)
    else setLocalSelected(path)
  }, [])
  const setMode = useCallback((next: 'rendered' | 'source') => {
    const s = syncRef.current
    if (s) s.setMode(next)
    else setLocalMode(next)
  }, [])
  // Seed the shared selection from this tree's default the first time, so both
  // instances agree before any click.
  useEffect(() => {
    if (sync && sync.selected == null) sync.setSelected(defaultPath)
  }, [sync, defaultPath])
  // Folders start collapsed — a tidy rail (SKILL.md + folder names) reads cleaner
  // than every directory unfurled on load. Opening one, or a finding's "View in
  // file" jump, expands as needed.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(collectFolderPaths(tree)))
  const [railShown, setRailShown] = useState(true)
  const [pendingLine, setPendingLine] = useState<number | null>(null)
  // When a reveal jumps to a file, scroll the rail to that row too (the rail holds
  // hundreds of files, so the target is usually off-screen). Cleared once scrolled.
  const [railScrollTo, setRailScrollTo] = useState<string | null>(null)
  const railRef = useRef<HTMLUListElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // On phones the file rail eats half the already-narrow width, so start it
  // collapsed there (the header toggle reopens it). Desktop keeps it open.
  useEffect(() => {
    if (window.matchMedia('(max-width: 639px)').matches) setRailShown(false)
  }, [])

  const selectedFile = files.find((f) => f.path === selected) ?? entry
  // Non-null only when the selected file is a servable inline image (allowlisted
  // extension, within the size cap, proxy-safe path) — over-cap or excluded
  // files (.svg) keep the binary fallback without issuing a request.
  const selectedImageSrc =
    assets && selectedFile?.kind === 'binary' ? bundleImageUrl(assets, selectedFile.path) : null
  const totalBytes = files.reduce((sum, f) => sum + (f.size ?? 0), 0)
  const isMd = !!selectedFile && selectedFile.kind === 'text' && isMarkdownPath(selectedFile.path)
  const showRich = mode === 'rendered' && isMd
  const showSkillMd = selected === SKILL_ENTRYPOINT && skillMdSlot != null

  // Open a file (expanding any collapsed parent folders), bring the viewer on
  // screen, switch to source (line numbers only exist there), then flag the line
  // to scroll-to + highlight once it has rendered. Shared by the in-page
  // "View in file" event and the cross-page deep-link below.
  const applyReveal = useCallback(
    (path: string, line: number) => {
      if (!files.some((f) => f.path === path)) return
      setCollapsed((prev) => {
        const next = new Set(prev)
        const parts = path.split('/')
        for (let i = 1; i < parts.length; i++) next.delete(parts.slice(0, i).join('/'))
        return next
      })
      setRailShown(true)
      setSelected(path)
      setMode('source')
      setPendingLine(line)
      setRailScrollTo(path)
      rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    },
    [files],
  )

  // A finding's "View in file" button fires this in-page event.
  useEffect(() => {
    function onReveal(event: Event) {
      const detail = (event as CustomEvent<{ path?: string; line?: number }>).detail
      if (!detail?.path) return
      applyReveal(detail.path, detail.line ?? 1)
    }
    window.addEventListener(SKILLET_EVENTS.revealFinding, onReveal as EventListener)
    return () => window.removeEventListener(SKILLET_EVENTS.revealFinding, onReveal as EventListener)
  }, [applyReveal])

  // Cross-page deep-link: a kit page links a flagged member-skill line to
  // `/{author}/{slug}?view=<path>&line=<n>`. On arrival, open that file at the
  // line. The params are left in the URL on purpose — a refresh or shared link
  // re-reveals the same file — and re-firing is idempotent (it re-selects the
  // same file), so we don't need to strip them or guard a single run. Re-runs
  // until `files` includes the path (the bundle may hydrate after mount).
  const deepLinkRevealed = useRef<string | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const path = params.get('view')
    if (!path || !files.some((f) => f.path === path)) return
    if (deepLinkRevealed.current === path) return // already revealed this target
    deepLinkRevealed.current = path
    applyReveal(path, Number(params.get('line')) || 1)
  }, [applyReveal, files])

  // Once the targeted file has rendered, scroll its line into view and flash it.
  useEffect(() => {
    if (pendingLine == null) return
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-skill-line="${pendingLine}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('skill-line-flash')
    const t = window.setTimeout(() => el.classList.remove('skill-line-flash'), 1800)
    setPendingLine(null)
    return () => window.clearTimeout(t)
  }, [selected, pendingLine, selectedFile?.text, loadingPath])

  // After a reveal expands the folders, bring the selected file's rail row into
  // view (block:'nearest' is a no-op when it's already visible). Re-runs as the
  // tree expands; waits (doesn't clear) until the row is actually in the DOM.
  useEffect(() => {
    if (railScrollTo == null) return
    const el = railRef.current?.querySelector<HTMLElement>(
      `[data-rail-path="${railScrollTo.replace(/"/g, '\\"')}"]`,
    )
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    setRailScrollTo(null)
  }, [railScrollTo, collapsed, selected, railShown])

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function renderNodes(nodes: TreeNode[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      const indent = `${12 + depth * 14}px`
      if (node.children) {
        const open = !collapsed.has(node.path)
        return (
          <li key={`d:${node.path}`}>
            <button
              type="button"
              onClick={() => toggleFolder(node.path)}
              title={node.path}
              className="skill-rail-item min-w-0"
              style={{ paddingLeft: indent }}
            >
              <ChevronIcon open={open} />
              <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
            </button>
            {open && <ul>{renderNodes(node.children, depth + 1)}</ul>}
          </li>
        )
      }
      const active = node.path === selected
      return (
        <li key={`f:${node.path}`}>
          <button
            type="button"
            onClick={() => setSelected(node.path)}
            title={node.path}
            data-active={active}
            data-rail-path={node.path}
            className="skill-rail-item min-w-0"
            style={{ paddingLeft: `calc(${indent} + 16px)` }}
          >
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {node.file?.kind === 'binary' && (
              <span className="shrink-0 text-xs text-(--ink-2)">
                {isInlineImagePath(node.file.path) ? 'img' : 'bin'}
              </span>
            )}
            {node.file?.executable && (
              <span className="shrink-0 text-xs text-(--warning)">exec</span>
            )}
          </button>
        </li>
      )
    })
  }

  return (
    <div
      ref={rootRef}
      className="scroll-mt-24 flex flex-col overflow-hidden surface-card"
    >
      {/* Top bar — same controls as the editor (/skills/new): rail toggle, the
          current file, and the Markdown view toggle. */}
      <div className="flex items-center gap-2 border-b border-(--line) px-3 py-2">
        <Tooltip content={railShown ? 'Hide files' : 'Show files'}>
          <Button
            variant="icon"
            type="button"
            onClick={() => setRailShown((v) => !v)}
            className="shrink-0"
            aria-label={railShown ? 'Hide files' : 'Show files'}
            aria-pressed={railShown}
          >
            <SidebarIcon open={railShown} />
          </Button>
        </Tooltip>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-(--ink-2)">
          {selectedFile?.path}
        </span>
        {isMd && (
          <Tooltip content={mode === 'source' ? 'Show rendered' : 'Show source'}>
            <Button
              variant="icon"
              type="button"
              onClick={() => setMode(mode === 'rendered' ? 'source' : 'rendered')}
              className="shrink-0 aria-pressed:bg-(--accent-bg)"
              aria-pressed={mode === 'source'}
              aria-label={mode === 'source' ? 'Show rendered' : 'Show source'}
            >
              <CodeIcon />
            </Button>
          </Tooltip>
        )}
        <SkillDownloadMenu author={author} slug={slug} />
        {headerAction}
      </div>

      <div
        className={`flex min-h-0 ${compact ? 'h-[clamp(240px,34vh,380px)]' : 'h-[clamp(440px,64vh,720px)]'}`}
      >
        {railShown && (
          <aside className="flex w-[196px] shrink-0 flex-col border-r border-(--line)">
            <ul ref={railRef} className="skill-rail-scroll min-h-0 flex-1 overflow-auto py-2">
              {entry && (
                <li key="entry">
                  <button
                    type="button"
                    onClick={() => setSelected(SKILL_ENTRYPOINT)}
                    title={SKILL_ENTRYPOINT}
                    data-active={selected === SKILL_ENTRYPOINT}
                    data-rail-path={SKILL_ENTRYPOINT}
                    className="skill-rail-item min-w-0"
                    style={{ paddingLeft: '28px' }}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{SKILL_ENTRYPOINT}</span>
                  </button>
                </li>
              )}
              {renderNodes(tree, 0)}
            </ul>
          </aside>
        )}

        <div ref={contentRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
          {selected === loadingPath ? (
            <p className="p-6 text-sm text-(--ink-2)">Loading file…</p>
          ) : selected === errorPath ? (
            <div className="flex flex-col gap-3 p-6">
              <p className="text-sm text-(--ink-2)">Could not load this file.</p>
              {onRetryLoad && (
                <Button variant="secondary" type="button" onClick={onRetryLoad}>
                  Retry
                </Button>
              )}
            </div>
          ) : showRich ? (
            <div className="skill-document px-5 py-5 sm:px-6 sm:py-6">
              {showSkillMd ? (
                skillMdSlot
              ) : (
                <MarkdownContent
                  content={selectedFile?.text ?? ''}
                  resolveImageSrc={
                    assets && selectedFile ? bundleImageResolver(assets, selectedFile.path) : undefined
                  }
                />
              )}
            </div>
          ) : selectedFile == null ? null : (
            <div className="p-4">
              {selectedFile.executable && (
                <p className="mb-3 rounded-lg border border-(--warning-line) bg-(--warning-bg) px-3 py-2 text-xs leading-[1.5] text-(--warning)">
                  This file is a script or executable. It can run on your machine when the skill is
                  used. Review it before installing.
                </p>
              )}
              {selectedFile.kind === 'text' && selectedFile.text != null ? (
                // One element per line so a finding can scroll to + highlight its line.
                <pre className="overflow-auto rounded-lg bg-(--bg) py-3 font-mono text-xs leading-[1.6] text-(--ink)">
                  {selectedFile.text.split('\n').map((ln, i) => (
                    <div key={i} data-skill-line={i + 1} className="px-3">
                      {ln || ' '}
                    </div>
                  ))}
                </pre>
              ) : selectedImageSrc ? (
                <ImagePreview
                  key={selectedImageSrc}
                  src={selectedImageSrc}
                  alt={selectedFile.path}
                  size={selectedFile.size}
                />
              ) : (
                BINARY_FALLBACK
              )}
            </div>
          )}
        </div>
      </div>

      {/* A quiet secondary bar. Left: the bundle summary (count + total size) —
          that's what the file rail lists, so it hides when the rail is hidden.
          Right: the current file's size, always kept (pinned right so it holds
          its place when the bundle summary drops away). */}
      <div className="flex items-center gap-2 border-t border-(--line) px-3 py-1.5 font-mono text-xs text-(--ink-2)">
        {railShown && (
          <span>
            {files.length} {pluralize(files.length, 'file')} · {formatBytes(totalBytes)}
          </span>
        )}
        {selectedFile && <span className="ml-auto">{formatBytes(selectedFile.size)}</span>}
      </div>
    </div>
  )
}
