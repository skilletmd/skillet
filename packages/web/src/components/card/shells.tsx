import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { CARD_TREATMENT, CARD_MOTION, hueShadow, cardHoverVars } from '@/lib/card-shell'

/**
 * A card's fill + border + shadow tinted to its cover hue — the "border related
 * to the background color" look, carried through to the drop shadow. color-mix
 * over the theme vars keeps fill/border correct in both light and dark: a
 * translucent hue wash sits on --card-pop, the border blends the hue with --line.
 *
 * The shadow keeps the hue but is held dark (low lightness) and desaturated so it
 * still reads as a shadow, not a colored glow — a vivid shadow lights the card up
 * instead of grounding it. Emitted as two custom props (--card-shadow rest,
 * --card-shadow-hover raised) so the shell can drive the sm→md lift transition.
 * `hue` null (e.g. a person tile) → neutral, no tint.
 */
export function coverTint(hue?: number | null): CSSProperties | undefined {
  if (hue == null) return undefined
  const accent = `hsl(${hue} 60% 52%)`
  return {
    backgroundColor: `color-mix(in oklab, ${accent} 7%, var(--card-pop))`,
    borderColor: `color-mix(in oklab, ${accent} 26%, var(--line))`,
    '--card-shadow': hueShadow(hue, 'rest'),
    '--card-shadow-hover': hueShadow(hue, 'raised'),
  } as CSSProperties
}

/**
 * The catalog-card system has two axes: SIZE (lg/md/sm) and KIND (kit/skill/
 * person). These three shells own the SIZE axis — the layout/look, kind-agnostic.
 * The kind components ({@link KitCard} etc.) own the KIND axis: they map their
 * data into these shells' slots. Change a tier's look here once and every kind
 * follows.
 *
 *   lg — CardLg : the featured square (cover-art tile, overlaid title)
 *   md — CardMd : the horizontal browse card (mark + text column + action)
 *   sm — CardSm : the compact rail row (mark + title + one fact)
 *   xs — CardXs : the named pill (mark + title only) — minimum identity unit
 */

export type CardSize = 'lg' | 'md' | 'sm' | 'xs'

/* ------------------------------------------------------------------ xs ---- */

/**
 * The smallest tier: a named pill — a 22px cover/avatar + the title, nothing
 * else. The minimum identity unit, for collapsed lists (feed bursts, "see all",
 * related rows). `shape` echoes the kind's mark: `square` (rounded-square) for
 * skill/kit, `round` (full pill + circular avatar) for a person.
 */
export function CardXs({
  href,
  title,
  mark,
  shape = 'square',
}: {
  href: string
  title: string
  /** The kind's cover/avatar, filling the small mark slot. */
  mark: ReactNode
  shape?: 'square' | 'round'
}) {
  return (
    // No `title` — the name is already shown, and a hover preview (when present)
    // would otherwise collide with the native tooltip.
    <Link href={href} className={`card-xs${shape === 'square' ? ' card-xs--square' : ''}`}>
      <span className={shape === 'square' ? 'card-xs-mark' : 'card-xs-avatar'}>{mark}</span>
      <span className="card-xs-label">{title}</span>
    </Link>
  )
}

/* ------------------------------------------------------------------ lg ---- */

/**
 * Featured tile: one self-contained card — an inset cover on a hue-tinted ground,
 * then the title, an optional blurb, and the byline, all inside a single border
 * whose fill/edge derive from the cover hue (see {@link coverTint}). The `cover`
 * slot is the kind's identity — a kit's folder stack, a skill's mesh, a person's
 * avatar. Pass `hue` (the cover's dominant hue) to tint; omit for a neutral card.
 */
export function CardLg({
  href,
  cover,
  title,
  description,
  subtitle,
  hue,
  badge,
  menu,
}: {
  href: string
  /** The kind's cover art, filling the inset cover box (stack / mesh / avatar). */
  cover: ReactNode
  title: string
  /** One- or two-line blurb under the title (kit/skill). */
  description?: ReactNode
  /** The byline row (e.g. avatar · @owner · Used by N). May carry its own anchors. */
  subtitle?: ReactNode
  /** The cover's dominant hue — tints the card fill + border. Omit → neutral. */
  hue?: number | null
  /** Corner indicator over the cover (visibility icon / role pill). */
  badge?: ReactNode
  /** Corner action coin (Add / Edit), rendered OUTSIDE the card link. */
  menu?: ReactNode
}) {
  const tint = coverTint(hue)
  return (
    // The lift lives on the wrapper so the card AND the corner coin move as one
    // rigid unit — lifting the article and the coin separately desyncs them.
    // Press is scoped like CARD_MOTION: a press on the corner coin or a byline
    // anchor swallows its own feedback instead of sinking the whole card.
    <div className="group/card relative h-full transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-safe:will-change-transform motion-safe:hover:-translate-y-0.5 motion-safe:[&:active:not(:has(button:active)):not(:has(a:active:not(.card-main-link)))]:scale-[0.99] motion-safe:active:duration-75">
      <article
        style={tint}
        className={`relative flex h-full flex-col overflow-hidden rounded-2xl border transition-[box-shadow] duration-200 ${
          tint
            ? 'group-hover/card:shadow-(--card-shadow-hover)'
            : 'border-(--line) bg-(--card-pop) group-hover/card:shadow-(--shadow-sm)'
        }`}
      >
        {/* The cover is flush to the top/left/right edges; the card's overflow-hidden
            clips its corners to the card radius. The tinted ground shows only in the
            text well below.

            Wider on a phone: in the swipe rail a card is 78% of the column, so a
            4:3 cover stood nearly as tall as the screen and pushed the name and
            byline — the part that says what the card IS — below the fold. 16:9
            keeps the art readable and the card a card. */}
        <div className="relative aspect-[16/9] shrink-0 overflow-hidden sm:aspect-[4/3]">
          {cover}
          {badge}
        </div>
        <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
          {/* Stretched-link title: the whole card is clickable, yet the byline can
              still carry its own anchors (they sit above via z-index). */}
          <Link
            href={href}
            className="card-main-link block after:absolute after:inset-0 after:content-['']"
          >
            {/* A card title is a subheading of the shelf it sits in, so it is an
                h3, not a span. Gives the page a real h1 → h2 → h3 outline for
                screen readers and for the crawlers that read structure to
                understand a page. Tailwind's preflight resets heading font-size,
                weight, and margin, so the rendered result is byte-identical. */}
            <h3
              className={`line-clamp-2 block text-balance font-semibold leading-[1.1] tracking-tight text-(--ink) ${
                title.length > 22 ? 'text-lg' : 'text-xl'
              }`}
            >
              {title}
            </h3>
          </Link>
          {description && (
            <p className="mt-1.5 line-clamp-2 text-pretty text-sm leading-[1.5] text-(--ink-2)">
              {description}
            </p>
          )}
          {subtitle && (
            <div className="mt-auto pt-3 text-xs leading-snug text-(--ink-2)">{subtitle}</div>
          )}
        </div>
      </article>
      {menu ? <div className="absolute right-3 top-3 z-20">{menu}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ md ---- */

/**
 * Horizontal browse card — a small cover/avatar on the left, then a text column
 * whose title shares the top line with an optional `action`. `children` is the
 * body (blurb, categories), `footer` the quiet meta line pinned to the bottom,
 * and `caption` an optional full-width line below the card (social proof).
 */
export function CardMd({
  href,
  mark,
  eyebrow,
  title,
  subtitle,
  action,
  children,
  footer,
  footerBordered = false,
  caption,
  hue,
  growChildren = false,
  flat = false,
}: {
  href: string
  mark: ReactNode
  /** Small status kicker above the title (e.g. a private marker). */
  eyebrow?: ReactNode
  title: ReactNode
  /** Meta line under the title, beside the mark (e.g. category · count). */
  subtitle?: ReactNode
  action?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** Set a hairline above the footer meta line — opt-in (grid cards keep the
   *  no-divider look; the person hover card uses it to seat the stats). */
  footerBordered?: boolean
  /** Static surface — no press/lift (for the hover-card popover). */
  flat?: boolean
  caption?: ReactNode
  /** The cover's dominant hue. On the list card the tint is HOVER-ONLY (the
   *  border + soft shadow warm to the hue on hover); at rest the card stays a
   *  neutral hairline so a wall of them doesn't read as noise. Omit → neutral. */
  hue?: number | null
  /** Let the description slot grow past one line instead of clamping to a fixed
   *  height. For content that legitimately wraps (person category chips), where
   *  a fixed height clips the second row onto the footer. Keeps the one-line
   *  FLOOR so empty cards still align. Grids equalize row height via stretch. */
  growChildren?: boolean
}) {
  const tint = hue == null ? undefined : cardHoverVars(hue)
  const treatment = flat
    ? // Static surface — no press/lift. For the person hover card, which is a
      // popover, not a grid tile you click like a button.
      'border border-(--line) bg-(--card-pop)'
    : tint
      ? `border border-(--line) bg-(--card-pop) ${CARD_MOTION} hover:border-(--card-hover-border) hover:shadow-(--card-shadow)`
      : CARD_TREATMENT
  return (
    // @container: narrow cards collapse their action controls to icon-only
    // (see skill-kit-control) instead of strangling the title.
    <div className="@container relative flex h-full flex-col has-[[aria-expanded=true]]:z-50">
      <article
        style={tint}
        className={`group relative flex flex-1 flex-col rounded-2xl ${treatment} p-4 focus-within:border-(--accent)`}
      >
        {/* Header: an inline mark beside a one-line title (GitHub/Linear card
            anatomy) — the mark is an identifier, not cover art, so it stays
            icon-sized and the header stays one row tall. Sized to match the
            top-ten chart rows (h-11) so covers read identically across
            surfaces. */}
        <div className="flex items-center gap-3">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg">{mark}</div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                {eyebrow && <div className="mb-0.5">{eyebrow}</div>}
                <Link
                  href={href}
                  className="card-main-link block min-w-0 after:absolute after:inset-0 after:content-['']"
                >
                  <h3
                    className="block truncate text-base font-semibold leading-[1.2] tracking-tight text-(--ink)"
                    title={typeof title === 'string' ? title : undefined}
                  >
                    {title}
                  </h3>
                </Link>
              </div>
              {action && (
                <div className="relative z-20 shrink-0 has-[[aria-expanded=true]]:z-50">
                  {action}
                </div>
              )}
            </div>
            {subtitle && <div>{subtitle}</div>}
          </div>
        </div>
        {/* The description slot is ALWAYS reserved (fixed height) so every card is
            the same height and the footer never rides up into the title/subtitle —
            collapsing it made short/empty cards uneven and let the divider touch the
            header. A 1-line blurb is vertically centered (balanced, not stuck at top);
            an empty one is just consistent whitespace. mb keeps the gap to the footer
            divider when mt-auto collapses. */}
        <div
          className={`mb-3 mt-3 flex items-center ${growChildren ? 'min-h-[2.625rem]' : 'h-[2.625rem]'}`}
        >
          {children}
        </div>
        {/* One quiet meta row, not an architectural zone: no divider band —
            the register change (xs, ink-2) is the separation. */}
        {footer && (
          <div
            className={`mt-auto flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-(--ink-2)${
              footerBordered ? ' border-t border-(--line) pt-3' : ''
            }`}
          >
            {footer}
          </div>
        )}
      </article>
      {caption && (
        <div className="mt-3 flex h-[18px] items-center gap-2 pl-5 pr-1 text-xs text-(--ink-2)">
          {caption}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ sm ---- */

/**
 * Compact rail row used in sidebars: a 36px mark/avatar, a title with a quiet
 * subtitle, and an optional trailing fact. Renders an `<li>`, so use it inside a
 * `<ul>`.
 */
export function CardSm({
  href,
  mark,
  title,
  subtitle,
  trailing,
}: {
  href: string
  mark: ReactNode
  title: string
  subtitle?: string
  trailing?: string
}) {
  return (
    <li>
      <Link
        href={href}
        // Borderless sidebar row (matches KitRow): content aligns to the column
        // edge like the section labels; the hover highlight bleeds outward via
        // -mx-3 so the rail stays quiet next to the white cards in the main column.
        className="group -mx-3 flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-(--accent-bg)"
      >
        <span className="relative h-9 w-9 shrink-0">{mark}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-(--ink) group-hover:text-(--accent)">
            {title}
          </span>
          {subtitle && (
            <span className="block truncate text-xs text-(--ink-2)">{subtitle}</span>
          )}
        </span>
        {trailing && <span className="shrink-0 text-xs text-(--ink-2)">{trailing}</span>}
      </Link>
    </li>
  )
}
