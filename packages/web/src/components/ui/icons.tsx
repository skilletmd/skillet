/**
 * Shared inline icons. Sized in `em` and drawn with `currentColor`, so they
 * inherit the surrounding text's size and color — drop one in place of a glyph
 * (never an HTML-entity arrow) and it just works.
 */

/** Right-pointing arrow for "see all" / "next" / forward affordances. */
export function ArrowRight({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3.25 8h9.5M9 4.25 12.75 8 9 11.75" />
    </svg>
  )
}

/** Left-pointing arrow for "previous" / back affordances. */
export function ArrowLeft({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12.75 8h-9.5M7 4.25 3.25 8 7 11.75" />
    </svg>
  )
}

/** Base for the stroke-glyph icons below — keeps stroke/viewBox/sizing uniform. */
function StrokeIcon({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

/** Right chevron for nav rows / forward affordances. */
export function ChevronRight({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </StrokeIcon>
  )
}

/** Down chevron for disclosure toggles. */
export function ChevronDown({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M3.5 6 8 10.5 12.5 6" />
    </StrokeIcon>
  )
}

/** Close / dismiss. */
export function Close({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </StrokeIcon>
  )
}

/** Plus / add. */
export function Plus({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </StrokeIcon>
  )
}

/** Checkmark. */
export function Check({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M13 4.5 6.5 11 3 7.5" />
    </StrokeIcon>
  )
}

/** Verified pip — a filled success disc with a bold light check, for badging an
 *  icon tile's corner (e.g. an agent detected on a connected device). Ring it with
 *  the surrounding bg via a shadow so it lifts off the tile. Size via className. */
export function VerifiedBadge({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-(--success) text-(--surface) ${className}`}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-[62%] w-[62%]"
      >
        <path d="M13 4.5 6.5 11 3 7.5" />
      </svg>
    </span>
  )
}

/** Sliders / adjustments — the "Settings" menu glyph. Kept distinct from the
 *  sun (Light theme) so the two never read as the same mark. */
export function Sliders({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M2.5 5.5h11M2.5 10.5h11" />
      <circle cx="10.5" cy="5.5" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="10.5" r="1.9" fill="currentColor" stroke="none" />
    </StrokeIcon>
  )
}

/** Sun — the "Light" theme choice. */
export function Sun({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
    </StrokeIcon>
  )
}

/** Moon — the "Dark" theme choice. */
export function Moon({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M12.7 9.8A5 5 0 1 1 6.2 3.3 4 4 0 0 0 12.7 9.8Z" />
    </StrokeIcon>
  )
}

/** Apple mark — a device connected via the Mac app. Filled to read at glyph size. */
export function Apple({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M10.9 8.4c0-1.4 1.1-2 1.2-2.1-.6-.9-1.6-1.1-2-1.1-.8-.1-1.6.5-2 .5s-1-.5-1.7-.5c-.9 0-1.7.5-2.2 1.3-.9 1.6-.2 4 .7 5.3.4.6 1 1.3 1.6 1.3.7 0 .9-.4 1.7-.4s1 .4 1.7.4c.7 0 1.1-.6 1.5-1.2.3-.4.5-.9.6-1.4-1.6-.6-1.4-2-1.4-1.9z" />
      <path d="M8.9 4.3c.4-.5.6-1.1.5-1.7-.5.1-1.1.4-1.5.8-.3.4-.6 1-.5 1.6.6.1 1.1-.3 1.5-.7z" />
    </svg>
  )
}

/** Windows mark — a device connected via the Windows app. */
export function Windows({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M2.5 3.6 7.2 3v4.4H2.5zM8 2.9 13.5 2.2v5.2H8zM2.5 8.6H7.2V13L2.5 12.4zM8 8.6H13.5V13.8L8 13.1z" />
    </svg>
  )
}

/** Terminal prompt — a device connected via the CLI. */
export function Terminal({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
      <path d="M4.5 6.75 6.5 8.5 4.5 10.25M8.25 10.25h3" />
    </StrokeIcon>
  )
}

/** Pencil — rename / edit affordance. */
export function Pencil({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M10.5 3.5 12.5 5.5 6 12l-2.75.75L4 10z" />
    </StrokeIcon>
  )
}

/** Laptop — a portable machine (also the generic-device fallback). */
export function Device({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <rect x="3" y="3" width="10" height="7" rx="1" />
      <path d="M1.5 12.5h13" />
    </StrokeIcon>
  )
}

/** Desktop monitor — a stationary machine (iMac, tower, workstation). */
export function Desktop({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <rect x="2.5" y="3" width="11" height="7.5" rx="1" />
      <path d="M6.25 13h3.5M8 10.5V13" />
    </StrokeIcon>
  )
}

/** Power plug — a connector (the MCP link row). */
export function Plug({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M5.5 2v3.5M10.5 2v3.5" />
      <path d="M4 5.5h8v2a4 4 0 0 1-4 4 4 4 0 0 1-4-4v-2Z" />
      <path d="M8 11.5V14" />
    </StrokeIcon>
  )
}

export function Bookmark({ className = '' }: { className?: string }) {
  return (
    <StrokeIcon className={className}>
      <path d="M4 2.75h8v10.5L8 10.5l-4 2.75V2.75Z" />
    </StrokeIcon>
  )
}

