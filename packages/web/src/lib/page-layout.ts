/**
 * Shared outer shell + standard content width (1120px) — used by the nav,
 * footer, skills directory, the Library/studio, the skill/kit detail pages, and
 * every one-col page. Two-column settings use the sidebar shell (680px content)
 * inside this same outer width.
 */
export const PAGE_CONTAINER_CLASS =
  'mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] pt-8 sm:pt-10 pb-12 sm:pb-16'

/**
 * Narrow single-column variant (680px — the same content width settings use) for
 * form-/onboarding-led pages whose narrow reading column is the design (setup,
 * import). Same gutters and vertical rhythm as {@link PAGE_CONTAINER_CLASS} so the
 * page frame matches its wide siblings; only the max-width differs.
 */
export const PAGE_CONTAINER_NARROW_CLASS =
  'mx-auto max-w-[680px] px-[clamp(16px,4vw,32px)] pt-8 sm:pt-10 pb-12 sm:pb-16'

export const PAGE_EYEBROW_CLASS =
  'text-sm font-semibold uppercase tracking-[0.06em] text-(--accent)'

export const PAGE_TITLE_CLASS = 'mt-2 text-title font-semibold leading-[1.12]'

export const PAGE_LEDE_CLASS = 'mt-4 max-w-[58ch] text-lg leading-[1.55] text-(--ink-2)'

/**
 * Canonical content-section heading (the "Kits" / "Skills" row title). One H2
 * treatment so section headers don't drift between text-lg / text-xl / text-2xl
 * across the profile, library, and detail pages.
 */
export const SECTION_TITLE_CLASS = 'text-xl font-semibold tracking-tight text-(--ink)'

/**
 * Canonical section description — the muted paragraph under a section heading.
 * One treatment so the explanatory text under settings/studio section titles
 * doesn't drift. Pairs with {@link SECTION_TITLE_CLASS}; both are composed by
 * the SettingsSection component.
 */
export const SECTION_DESCRIPTION_CLASS = 'mt-1 max-w-[58ch] text-sm leading-relaxed text-(--ink-2)'

/**
 * Canonical sub-section label — the small uppercase heading for a group *inside*
 * a section body ("Synced" / "Pending" / "Kits on this machine"). One treatment
 * so these quiet group labels don't drift between uppercase-xs and sentence-case
 * text-sm across settings. Sits a full step below {@link SECTION_TITLE_CLASS}.
 */
export const SUBSECTION_LABEL_CLASS =
  'text-xs font-medium uppercase tracking-[0.06em] text-(--ink-2)'

/**
 * Discovery-shelf heading (the home/Browse "Featured kits" / "Top skills & kits"
 * row titles). One step larger than {@link SECTION_TITLE_CLASS} so the catalog
 * shelves carry an intermediate scale below the hero/page title instead of
 * collapsing flat into body text. Reserved for the curated discovery surfaces —
 * compact app sections (settings, studio, profile) stay on SECTION_TITLE_CLASS.
 */
export const SHELF_TITLE_CLASS = 'text-2xl font-semibold tracking-tight text-(--ink)'

/**
 * Shared card grids so the same card type wraps identically on every page.
 * SKILL_CARD_GRID: the 2-up browse-style skill grid (home, browse, profile).
 * KIT_CARD_GRID: auto-fitting kit cover tiles (home, browse, profile).
 */
export const SKILL_CARD_GRID = 'grid grid-cols-1 gap-4 lg:grid-cols-2'
// Container-query columns: the count tracks the GRID'S OWN container width (not
// the window), so a narrow column (profile, next to a sidebar) and a wide one
// get the right number of tiles from one rule. Requires an `@container` ancestor.
// Tile width is whatever's left after the column count — no fixed cap.
export const KIT_CARD_GRID =
  'grid grid-cols-1 gap-4 @sm:grid-cols-2 @lg:grid-cols-3'

/**
 * The breakpoint at which a content page splits into a two-column (content +
 * rail) layout — Tailwind's `lg`. One value so feed, browse, profile, settings,
 * and detail pages all reflow at the same window width.
 */
export const TWO_COL_BP = '1024px'
