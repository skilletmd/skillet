'use client'

import { useEffect, useState } from 'react'
import { Sun, Moon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { THEME_STORAGE_KEY } from '@/lib/events'
import { circularReveal } from '@/lib/view-transition'

type Theme = 'light' | 'dark'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function storedTheme(): Theme | null {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : null
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

/**
 * Light / Dark switcher — a single ghost icon button that toggles between the two.
 * There's no explicit "System" choice: on first visit the theme initializes from
 * the OS preference (and keeps following it until the user pins one), matching the
 * no-flash init script in the document head. The button shows the active theme's
 * icon; clicking it wipes the other theme in from the click point.
 */
export function ThemeToggle() {
  // Default until the resolved theme is read on the client (the head script has
  // already set the actual theme, so there's no flash).
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    setTheme(storedTheme() ?? systemTheme())

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      // Follow the OS only while the user hasn't pinned a theme.
      if (!storedTheme()) {
        const next = systemTheme()
        setTheme(next)
        apply(next)
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
    circularReveal(() => apply(next), e.clientX, e.clientY)
  }

  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light' : 'Dark'}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        'text-(--ink-2) hover:bg-(--accent-bg) hover:text-(--ink)',
      )}
    >
      {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  )
}
