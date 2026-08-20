'use client'

import { createContext, useContext } from 'react'

/**
 * Shared file + mode selection between the inline bundle viewer and its expand
 * overlay (two SkillFileTree instances) — lifted here so expanding opens the
 * same file in the same mode instead of resetting to the root SKILL.md.
 * Lives in its own module so files-section (provider) and skill-file-tree
 * (consumer) don't import each other.
 */
export type ViewerSync = {
  selected: string | null
  setSelected: (path: string) => void
  mode: 'rendered' | 'source'
  setMode: (mode: 'rendered' | 'source') => void
}

export const ViewerSyncContext = createContext<ViewerSync | null>(null)

/** Null when a SkillFileTree renders standalone (no FilesSection) — it then
 *  keeps its own local state, exactly as before. */
export function useViewerSync(): ViewerSync | null {
  return useContext(ViewerSyncContext)
}
