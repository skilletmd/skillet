'use client'

import { useCallback, useEffect, useState, type ComponentType } from 'react'

// Self-managed lazy load (not next/dynamic) so we control exactly when the real
// search renders. next/dynamic shows its `loading` fallback for a tick even when
// the chunk is already cached; that intermediate render is one of the flicker
// sources. Here, once `loadSearch()` has resolved we hold the component in module
// state and render it directly on the next commit — no fallback in between.
let cachedComponent: ComponentType | null = null
let pending: Promise<ComponentType> | null = null

function loadSearch(): Promise<ComponentType> {
  if (cachedComponent) return Promise.resolve(cachedComponent)
  if (!pending) {
    pending = import('@/components/search/universal-search-loaded').then((m) => {
      cachedComponent = m.UniversalSearchLoaded
      return cachedComponent
    })
  }
  return pending
}

function SearchShell({
  onActivate,
  onPreload,
}: {
  onActivate?: () => void
  onPreload?: () => void
}) {
  return (
    <>
      {/* Pixel-identical to the loaded inline SearchBox (same wrapper, glyph,
          field, and ⌘K badge) so there's zero shift when the real search swaps in.
          The input is readOnly AND its mousedown default is prevented, so a click
          never moves focus here — the fake never shows a focus border. That swap
          (fake, unfocused → real, focused) is what made the border "highlight then
          go away". The glyph SVG is inlined (not imported from SearchBox) so the
          shell stays out of the search chunk. pointerenter warms the chunk. */}
      <div className="universal-search universal-search--desktop" onPointerEnter={onPreload}>
        <div className="universal-search-box universal-search-box--inline">
          <div className="search-input">
            <svg
              className="search-input-glyph"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M10.5 10.5L14 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="text"
              className="search-input-field"
              placeholder="Search"
              aria-label="Search Skillet"
              readOnly
              // mousedown default-prevented => the click never focuses this fake
              // input (no border flash); we hand off straight to the real one.
              onMouseDown={(e) => {
                e.preventDefault()
                onPreload?.()
                onActivate?.()
              }}
              // Keyboard tab lands here: activate so focus moves on to the real input.
              onFocus={() => {
                onPreload?.()
                onActivate?.()
              }}
            />
            <kbd className="search-shortcut-badge" aria-hidden="true">
              ⌘K
            </kbd>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="universal-search-trigger universal-search--mobile"
        aria-label="Search"
        onPointerEnter={onPreload}
        onClick={onActivate}
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
    </>
  )
}

/**
 * Lazy global search — placeholder until first interaction or ⌘K loads the dialog chunk.
 */
export function UniversalSearch() {
  const [active, setActive] = useState(false)
  const [Loaded, setLoaded] = useState<ComponentType | null>(cachedComponent)

  // Warm the chunk on first intent (hover/focus) and stash the resolved component
  // so a subsequent click renders the real box immediately, with no fallback.
  const preload = useCallback(() => {
    if (cachedComponent) {
      setLoaded(() => cachedComponent)
      return
    }
    void loadSearch().then((C) => setLoaded(() => C))
  }, [])

  const activate = useCallback(() => {
    setActive(true)
    if (!cachedComponent) void loadSearch().then((C) => setLoaded(() => C))
  }, [])

  useEffect(() => {
    if (active) return
    function onKeyDown(event: KeyboardEvent) {
      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      const isSlash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey
      if (!isCmdK && !isSlash) return
      const el = document.activeElement
      const inField =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (isSlash && inField) return
      event.preventDefault()
      activate()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, activate])

  // Render the real search the moment it's both requested and loaded. Until then
  // (and always before first intent) the lean shell stands in — identical pixels,
  // and crucially never focused, so there's no border to flash on the way out.
  if (active && Loaded) {
    return <Loaded />
  }

  return <SearchShell onActivate={activate} onPreload={preload} />
}
