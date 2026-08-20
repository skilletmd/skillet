/**
 * Render a category's glyph by key. The glyph geometry is single-source in the
 * shared cover engine (`@skillet/protocol/covers` → `CATEGORY_GLYPHS`), so web and
 * the desktop tray draw the exact same marks and can never drift. This component is
 * just the `<svg>` wrapper: 16×16 viewBox, `em`-sized, `currentColor` stroke — so a
 * category icon inherits the surrounding text's size/color and can be tinted with
 * the category swatch by setting `color`. Each fragment carries its own per-element
 * fill/stroke (filled dots, the media play triangle), which the wrapper preserves.
 *
 * Pass a lighter `strokeWidth` (~1.25) when drawing it large, e.g. on a cover, so
 * the stroke stays optically consistent with the small sidebar size.
 */
import { CATEGORY_GLYPHS } from '@skillet/protocol/covers'
import type { CategoryKey } from '@/lib/categories'

export function CategoryIcon({
  cat,
  className = '',
  strokeWidth = 1.5,
}: {
  cat: CategoryKey
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: CATEGORY_GLYPHS[cat] }}
    />
  )
}
