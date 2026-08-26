import { Suspense, type ReactNode } from 'react'
import { BrowseChrome } from './browse-chrome'
import { BrowseStrip } from './browse-strip'

// MOBILE-ONLY: a compact nav strip — Featured · All · Code ▾ · Creative ▾
// · Grow ▾ — collapsing the 15 flat categories into their 3 sections (each a
// dropdown). Replaces the cramped mobile dropdowns. Desktop keeps the left rail
// (this is hidden below lg via the wrapper).

// The chrome (sidebar, header, type tabs, sort) lives here so it stays mounted
// across category/type navigations — only the page's grid re-streams, instead of
// the whole page re-rendering on every category click. The chrome reads the
// pathname (request data), so it sits behind Suspense — the grid is its own
// prerenderable fallback — matching the consumer layout's pattern.
export default function BrowseLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="lg:hidden">
        <BrowseStrip />
      </div>
      <Suspense fallback={children}>
        <BrowseChrome>{children}</BrowseChrome>
      </Suspense>
    </>
  )
}
