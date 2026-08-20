import { cn } from '@/lib/cn'

/**
 * The one add/added affordance, shared by kit cards (subscribe) and skill cards
 * (add-to-kit). A rounded-square coin: an outline + when not added, a filled-gold
 * ✓ when added. Same look everywhere so "is this in my world or not" reads
 * identically, even though the click does different things (kit = toggle
 * subscribe; skill = open the kit picker).
 */
export function addCoinClass(added: boolean) {
  // Matches the skill-card "+ Add" control exactly (skill-kit-control.tsx): same
  // border, resting + hover shadow, hover border color, and the same tinted
  // "Added" state (accent-bg + accent text), so the coin and the skill add
  // button are one family.
  return cn(
    'flex h-8 w-8 items-center justify-center rounded-lg border transition-[box-shadow,border-color,background-color] duration-150 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)',
    added
      ? 'border-transparent bg-(--accent-bg) text-(--accent) hover:bg-black/[0.04]'
      : 'border-(--line) bg-(--surface) text-(--ink) shadow-(--shadow-sm) hover:border-(--ink-2) hover:bg-(--accent-bg) hover:shadow-(--shadow-md)',
  )
}

export function AddCoinIcon({ added }: { added: boolean }) {
  return added ? (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3.5 8.5 3 3 6-7.5" />
    </svg>
  ) : (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  )
}

/** The edit glyph for an owner's edit coin — shared by kit and skill cards so the
 *  "edit your own" affordance reads identically across both. */
export function PencilIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 2.5l2 2L6 12l-3 1 1-3 7.5-7.5z" />
    </svg>
  )
}
