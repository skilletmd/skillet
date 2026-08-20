'use client'

/**
 * Provides category colors adapted to the active theme. In dark mode the deep end
 * of each swatch is lifted so dots, chips, and cover marks stay legible against
 * near-black (see swatchForTheme). Centralizing this here means ONE theme observer
 * for the whole tree instead of one per dot.
 */

import { createContext, useContext, useMemo } from 'react'
import { CATEGORY_BY_KEY, swatchForTheme, type Category, type CategoryKey } from '@/lib/categories'
import { useTheme } from '@/components/use-theme'

const Ctx = createContext<Record<CategoryKey, Category> | null>(null)

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme()
  const byKey = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(CATEGORY_BY_KEY).map(([k, c]) => [k, swatchForTheme(c, theme)]),
      ) as Record<CategoryKey, Category>,
    [theme],
  )
  return <Ctx.Provider value={byKey}>{children}</Ctx.Provider>
}

/** Theme-adapted category colors. Null when no provider is mounted (server-only
 *  render paths), so callers fall back to the static CATEGORY_BY_KEY. */
export function usePaletteByKey(): Record<CategoryKey, Category> | null {
  return useContext(Ctx)
}
