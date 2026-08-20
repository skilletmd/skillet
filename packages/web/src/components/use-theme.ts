'use client'

import { useEffect, useState } from 'react'

/**
 * Reactively read the app theme. The no-flash head script and ThemeToggle both
 * write `document.documentElement.dataset.theme`; we mirror it into React state
 * and observe attribute changes so color components (dots, covers) can adapt
 * their tone per theme. SSR/first paint assume 'light' (the default), then the
 * effect corrects after mount.
 */
export function useTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return theme
}
