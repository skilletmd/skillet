'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from '@/components/ui/icons'

/**
 * The homepage ladder's scroller: hairline-divided cards on one horizontal
 * track, with arrows.
 *
 * It exists because the ladder is a five-rung sequence and five equal columns
 * do not fit a 1120px band. At three-up the cards keep the width the copy was
 * written for and the rungs the reader has not reached yet wait one arrow away,
 * which is the same shape as the ladder itself: you see the next step, not all
 * of them at once.
 *
 * The card dividers must land on a rule at BOTH ends or they stop in mid-air,
 * which is the kind of thing you see immediately and cannot name. The top is
 * closed by the section's own full-bleed `border-t`. The bottom is closed the
 * same way, by the full-bleed `border-t` on whatever follows (the site footer,
 * on the homepage) with no padding between. So the track carries `border-x`
 * only: giving it a `border-b` too put an inset hairline directly on top of the
 * footer's full-bleed one. A caller that puts this above something with no top
 * rule has to supply the closing line itself.
 *
 * The arrows straddle the track's left and right edges rather than sitting in a
 * row underneath. Underneath, they needed ~56px of clearance of their own or
 * they read as part of the footer, and that whole band was empty. On the edges
 * they cost no vertical space at all and point along the axis they scroll.
 * `-translate-x-1/2` is what keeps them off the copy: centered on the edge, the
 * inner half covers only the card's own 32px gutter, never its text.
 *
 * They are `hidden sm:flex`. On a phone one card fills the width and the gutter
 * an arrow would straddle is where the body copy starts, so they would sit on
 * top of it. Touch has finger dragging, which is the better affordance anyway.
 *
 * Lives in `home/` rather than `ui/` on purpose. There is one call site; the ui
 * README reserves that directory for primitives that actually repeat. Promote
 * it there the second something else needs a rail.
 *
 * Scrolling is native (`overflow-x: auto` + scroll-snap), which is what makes
 * finger dragging work on a phone: touch panning is the browser's, not
 * something a drag handler has to reimplement, and it arrives with momentum and
 * rubber-banding already correct. That also means NOT setting `touch-action`
 * here. `pan-x` would win the gesture for this rail and a reader who starts a
 * vertical swipe on a card would find the page frozen under their thumb; the
 * default lets the browser lock the axis from the gesture's direction.
 * Trackpad and keyboard come from the same place.
 *
 * The arrows are a convenience for mouse users, so they are `aria-hidden` and
 * excluded from the tab order: they duplicate the scroll region's own keyboard
 * behavior, and announcing "scroll left" twice is worse than not announcing it.
 * No mouse drag-to-scroll: every card holds a link, and a drag handler over
 * clickable content has to guess drag from click on every press.
 */
export function LadderCarousel({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  // Both false until measured, so the arrows never flash on a track that turns
  // out to fit. `scrollable` gates the whole control row: on a wide desktop
  // where every rung is visible there is nothing to scroll to, and a pair of
  // permanently disabled buttons is furniture.
  const [scrollable, setScrollable] = useState(false)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  const measure = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    // Sub-pixel track widths (fractional card widths, a zoomed viewport) leave
    // scrollWidth a hair above clientWidth on a track that visually fits, which
    // would strand an enabled-looking arrow that scrolls nothing. One pixel of
    // slack on each comparison is below what anyone can see and above what
    // rounding produces.
    const max = el.scrollWidth - el.clientWidth
    setScrollable(max > 1)
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft >= max - 1)
  }, [])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    measure()
    // ResizeObserver on the track catches both a viewport resize and a font
    // swap reflowing the cards; a window resize listener misses the second.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  const page = (direction: 1 | -1) => {
    const el = trackRef.current
    if (!el) return
    // Step by whole cards: as many as fully fit, which is the same set the
    // reader just finished. A fractional step (a full clientWidth, or a width
    // minus one card) lands mid-card and leaves scroll-snap to yank it
    // somewhere the press did not ask for.
    const first = el.firstElementChild as HTMLElement | null
    const card = first?.offsetWidth ?? 0
    const step = card > 0 ? Math.max(1, Math.floor(el.clientWidth / card)) * card : el.clientWidth
    el.scrollBy({
      left: step * direction,
      // `smooth` is honored against the user's motion preference by the browser
      // in every engine that ships scroll-behavior, so no manual media query.
      behavior: 'smooth',
    })
  }

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={measure}
        role="group"
        aria-label={label}
        tabIndex={0}
        className="rail-scroll flex snap-x snap-mandatory overflow-x-auto border-x border-(--line) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
      >
        {children}
      </div>

      {scrollable && (
        <>
          <RailArrow
            onClick={() => page(-1)}
            disabled={atStart}
            label="Scroll left"
            className="left-0 -translate-x-1/2"
          >
            <ArrowLeft className="h-4 w-4" />
          </RailArrow>
          <RailArrow
            onClick={() => page(1)}
            disabled={atEnd}
            label="Scroll right"
            className="right-0 translate-x-1/2"
          >
            <ArrowRight className="h-4 w-4" />
          </RailArrow>
        </>
      )}
    </div>
  )
}

function RailArrow({
  onClick,
  disabled,
  label,
  className,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  className: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      tabIndex={-1}
      aria-hidden="true"
      title={label}
      // The fill is `--bg`, the page ground, and it stays fully opaque in every
      // state. This button sits ON the track's border, so anything see-through
      // shows the rule running straight through the middle of it. That is what
      // `disabled:opacity-30` did: it faded the whole element, background
      // included, and the divider reappeared under the disabled arrow.
      //
      // The ring holds full `--line` in every state, the same hairline the cards
      // are drawn with. Fading it made the circle read as half-erased where it
      // crosses the divider, since a dimmed ring and a full-strength rule met at
      // two points. Only the glyph dims; the circle and its fill stay put.
      className={`absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-(--line) bg-(--bg) text-(--ink) transition-colors disabled:pointer-events-none disabled:text-(--ink-2)/45 sm:flex [@media(hover:hover)]:hover:bg-(--accent-bg) ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * One rung. Fixed-width and `shrink-0` so the track scrolls instead of
 * squeezing five cards into one screen: the body copy was written for a
 * ~370px measure and reflows badly under it.
 *
 * The widths are deliberately not clean fractions of the track. `lg:w-1/3` fit
 * three cards edge to edge and the row looked finished, so nobody knew rungs 4
 * and 5 existed. At 30% the fourth card's leading edge is always cut by the
 * track's right border, which is the affordance doing the work: arrows tell you
 * scrolling is possible, a sliced card tells you there is something to scroll
 * to. Same reason for 80vw on a phone and 46% at sm.
 */
export function LadderCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-[80vw] shrink-0 snap-start flex-col items-start border-r border-(--line) px-6 py-8 last:border-r-0 sm:w-[46%] sm:px-8 lg:w-[30%]">
      {children}
    </div>
  )
}
