/**
 * The copy affordance and its copied state.
 *
 * Extracted from install-picker.tsx when the profile's suggested invocations
 * needed the same pair. Identical geometry: two places that answer "did that
 * copy?" should not answer it with two different marks.
 *
 * Both are `aria-hidden` — they are pure affordance. The button carries the
 * accessible name, and the copied state is announced by a `role="status"`
 * sibling rather than by the glyph.
 */

export function CopyGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

export function CopiedGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d="M3 8.5L6.5 12L13 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
