'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SearchBox } from '@/components/search/search-box'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'

const MOBILE_BREAKPOINT = 768

/** Full search UI — loaded on first open or ⌘K so the header shell stays lean. */
export function UniversalSearchLoaded() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const desktopInputRef = useRef<HTMLInputElement | null>(null)

  // This component mounts only once the user activates search (click or ⌘K on the
  // lean shell), so claim focus on mount — otherwise the activating click lands on
  // the now-unmounted shell and the user has to click a second time to type. On
  // mobile there's no inline input, so open the sheet for the same one-tap reason.
  //
  // useLayoutEffect (not useEffect) so the focus — and the open/badge state it
  // triggers via the input's onFocus — settles *before* the browser paints. With a
  // post-paint effect there's one frame where the real input is mounted but
  // unfocused and still showing the ⌘K badge, which reads as a flicker as it swaps
  // to the focused, dropdown-open state. ssr:false (dynamic import) means this only
  // runs client-side, so there's no SSR layout-effect warning.
  useLayoutEffect(() => {
    if (window.innerWidth < MOBILE_BREAKPOINT) {
      setSheetOpen(true)
    } else {
      desktopInputRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      const isSlash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey
      if (!isCmdK && !isSlash) return

      const active = document.activeElement
      const inField =
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
      if (isSlash && inField) return

      event.preventDefault()
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        setSheetOpen(true)
      } else {
        desktopInputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <div className="universal-search universal-search--desktop">
        <SearchBox variant="inline" inputRef={desktopInputRef} />
      </div>

      <button
        type="button"
        className="universal-search-trigger universal-search--mobile"
        aria-label="Search"
        onClick={() => setSheetOpen(true)}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M13.5 13.5L18 18"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent variant="sheet" className="search-sheet" aria-label="Search">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="search-sheet-header">
            <SearchBox
              variant="sheet"
              autoFocus
              onNavigate={() => setSheetOpen(false)}
              onEscapeWhenEmpty={() => setSheetOpen(false)}
            />
            <DialogClose type="button" className="search-sheet-close" aria-label="Close search">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M5 5L15 15M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
