'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { SkillDocumentView } from '@/components/skill-document-view'
import { SkillFileTree } from '@/components/skill-file-tree'
import { ViewerSyncContext, type ViewerSync } from '@/components/skills/viewer-sync'
import type { SkillBundleFileEntry } from '@/lib/skill-bundle-content'
import { fetchSkillBundleFileClient } from '@/lib/skill-bundle-file-fetch'
import type { SkillBundleAssets } from '@/lib/bundle-images'

/**
 * Files — the bundle viewer at its natural height, plus a focused full-screen
 * view one tap away. The expand control is a fullscreen icon in the viewer's own
 * header bar (right of the download icon); the overlay is just the same viewer
 * rendered wider over a dimmed backdrop, with that icon swapped for a collapse
 * icon. No second "modal" frame around it — the viewer is its own chrome.
 *
 * The inline and overlay are two independent viewer instances, so without
 * shared state expanding would reset to the root SKILL.md. {@link ViewerSyncContext}
 * lifts the selected file + rendered/source mode so the overlay opens exactly
 * where the inline viewer was (scroll-within-file still differs — the two render
 * at different widths).
 *
 * This component is the client boundary on purpose: the bundle's file text
 * crosses the RSC wire ONCE (its props), and the two viewer copies are built
 * client-side from that one copy. Rendering the copies in the server parent
 * instead serializes the full file text into the flight payload twice — on a
 * many-file skill that alone doubles the page weight.
 */

/** Fullscreen-corners icon — the Expand control in the viewer header. */
const expandTrigger = (
  <Tooltip content="Expand">
    <DialogTrigger asChild>
      <Button variant="icon" type="button" className="shrink-0" aria-label="Expand files">
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
          <path d="M7.5 4.5H4.5V7.5M12.5 4.5H15.5V7.5M7.5 15.5H4.5V12.5M12.5 15.5H15.5V12.5" />
        </svg>
      </Button>
    </DialogTrigger>
  </Tooltip>
)

/** Inward-corners icon — collapses the overlay back to the inline viewer. */
const collapseTrigger = (
  <Tooltip content="Collapse">
    <DialogClose asChild>
      <Button variant="icon" type="button" className="shrink-0" aria-label="Collapse files">
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
          <path d="M4.5 7.5H7.5V4.5M15.5 7.5H12.5V4.5M4.5 12.5H7.5V15.5M15.5 12.5H12.5V15.5" />
        </svg>
      </Button>
    </DialogClose>
  </Tooltip>
)

/** The Dialog shell shared by both sections: inline copy + full-screen overlay. */
function ExpandableViewer({ inline, overlay }: { inline: ReactNode; overlay: ReactNode }) {
  return (
    <Dialog>
      {inline}
      <DialogContent
        className="w-[min(96vw,1120px)] border-0 bg-transparent p-0 shadow-none"
        // Don't autofocus the first control on open: that lands focus on the
        // viewer's "Hide files" toggle, whose (focus-triggered) tooltip would then
        // pop open with no hover. The overlay is a viewer, not a form — Escape and
        // the focus trap still work once the user tabs in.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Files</DialogTitle>
        {overlay}
      </DialogContent>
    </Dialog>
  )
}

export function FilesSection({
  files,
  versionHash,
  skillMdSlot,
  author,
  slug,
  assets,
}: {
  files: SkillBundleFileEntry[]
  versionHash: string
  /** Server-rendered SKILL.md markdown, shown when the entry file is selected. */
  skillMdSlot?: ReactNode
  author: string
  slug: string
  /** Raw-image URL context for the bundle (markdown images + tree previews). */
  assets?: SkillBundleAssets
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered')
  const [loadedText, setLoadedText] = useState<Record<string, string>>({})
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [errorPath, setErrorPath] = useState<string | null>(null)
  const [loadGeneration, setLoadGeneration] = useState(0)

  const mergedFiles = useMemo(
    () =>
      files.map((f) => {
        const text = loadedText[f.path]
        return text != null ? { ...f, kind: 'text' as const, text } : f
      }),
    [files, loadedText],
  )

  useEffect(() => {
    // SKILL.md's *rendered* view comes from skillMdSlot, but its *source* view
    // needs the raw file text like any other file — so it must lazy-load too
    // (it used to be skipped here, which left source mode showing "Binary file").
    if (!selected) return
    const meta = files.find((f) => f.path === selected)
    if (!meta || meta.text != null || loadedText[selected]) return

    let cancelled = false
    setLoadingPath(selected)
    setErrorPath(null)
    void fetchSkillBundleFileClient(author, slug, versionHash, selected).then((entry) => {
      if (cancelled) return
      setLoadingPath(null)
      if (!entry) {
        setErrorPath(selected)
        return
      }
      if (entry.text != null) {
        setLoadedText((prev) => ({ ...prev, [selected]: entry.text as string }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [author, slug, versionHash, selected, files, loadedText, loadGeneration])

  const retryLoad = () => {
    if (!errorPath) return
    setErrorPath(null)
    setLoadGeneration((n) => n + 1)
  }

  // Memoized so the value identity only changes when the selection actually
  // does — a fresh object each render would re-run consumers' effects needlessly.
  const sync = useMemo<ViewerSync>(
    () => ({ selected, setSelected, mode, setMode }),
    [selected, mode],
  )

  return (
    <ViewerSyncContext.Provider value={sync}>
      <ExpandableViewer
        inline={
          <SkillFileTree
            files={mergedFiles}
            skillMdSlot={skillMdSlot}
            author={author}
            slug={slug}
            loadingPath={loadingPath}
            errorPath={errorPath}
            onRetryLoad={retryLoad}
            assets={assets}
            headerAction={expandTrigger}
            compact
          />
        }
        overlay={
          <SkillFileTree
            files={mergedFiles}
            skillMdSlot={skillMdSlot}
            author={author}
            slug={slug}
            loadingPath={loadingPath}
            errorPath={errorPath}
            onRetryLoad={retryLoad}
            assets={assets}
            headerAction={collapseTrigger}
          />
        }
      />
    </ViewerSyncContext.Provider>
  )
}

/** Single-file counterpart: SKILL.md alone, same inline/expand pattern. The two
 *  copies keep independent rendered/source state (as before this boundary moved). */
export function DocumentSection({
  source,
  frontmatter,
  author,
  slug,
  assets,
}: {
  source: string
  frontmatter?: string | null
  author: string
  slug: string
  /** Raw-image URL context for the bundle (markdown image resolution). */
  assets?: SkillBundleAssets
}) {
  return (
    <ExpandableViewer
      inline={
        <SkillDocumentView
          source={source}
          frontmatter={frontmatter}
          author={author}
          slug={slug}
          assets={assets}
          headerAction={expandTrigger}
          compact
        />
      }
      overlay={
        <SkillDocumentView
          source={source}
          frontmatter={frontmatter}
          author={author}
          slug={slug}
          assets={assets}
          headerAction={collapseTrigger}
        />
      }
    />
  )
}
