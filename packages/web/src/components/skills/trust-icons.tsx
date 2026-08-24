// Line-glyph icons for the trust panel — one per capability and per standalone
// finding, so the "what this skill can do" list scans like a permission sheet
// (Apple Settings / Airbnb amenities) instead of a row of dots.
//
// Same house style as components/ui/icons.tsx, but these render larger (22px)
// than the canonical 16px, so the stroke is thinned to 1.1 — at 22px that lands
// on the house's ~1.5px effective weight (1.1 × 22/16), matching the nav and
// file-editor icons instead of reading heavier. The icon inherits the row's text
// color, so a flagged row turns the icon amber for free. Every glyph is
// decorative (aria-hidden) — the text label carries the meaning.

import type { ReactNode } from 'react'
import type { CapabilityKey } from '@/lib/types'

function Glyph({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

/** Warning triangle — marks the "why flagged" line in the open panel, so the
 *  risk reads as a warning callout (amber icon) instead of a line of red text. */
export function WarningGlyph({ className = '' }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M8 2.75 14.5 13.5H1.5z" />
      <path d="M8 6.75v3.25" />
      <path d="M8 12.25h.01" />
    </Glyph>
  )
}

// --- capability glyphs ------------------------------------------------------

const CAP_GLYPH: Record<CapabilityKey, ReactNode> = {
  // Terminal — run commands.
  'runs-shell': (
    <>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" />
      <path d="M4.75 6.5 6.75 8 4.75 9.5" />
      <path d="M8.5 10h2.75" />
    </>
  ),
  // Globe — use internet.
  network: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11" />
      <path d="M8 2.5c-2.2 1.7-2.2 9.3 0 11" />
      <path d="M8 2.5c2.2 1.7 2.2 9.3 0 11" />
    </>
  ),
  // Document — write files. Axis-aligned body + a clean folded corner, two
  // well-spaced text lines. Crisp at 16px (no sub-pixel rounded corners).
  'writes-files': (
    <>
      <path d="M4.5 2.5H9l2.5 2.5v8.5h-7z" />
      <path d="M9 2.5V5h2.5" />
      <path d="M6.5 8.5h3M6.5 11h3" />
    </>
  ),
  // Trash — delete files.
  'deletes-files': (
    <>
      <path d="M3.5 4.5h9" />
      <path d="M6 4.5V3.5h4v1" />
      <path d="M5 4.5l.55 8.45a.6.6 0 0 0 .6.55h3.7a.6.6 0 0 0 .6-.55L11 4.5" />
      <path d="M6.8 6.8v4.4M9.2 6.8v4.4" />
    </>
  ),
  // Key — read env vars.
  'reads-secrets': (
    <>
      <circle cx="6" cy="6" r="2.6" />
      <path d="M7.85 7.85 12.6 12.6" />
      <path d="M10.4 10l1.5 1.5M9.2 11.2l1.5 1.5" />
    </>
  ),
  // Package — install packages.
  'install-hooks': (
    <>
      <path d="M8 2.4 13 5v6l-5 2.6L3 11V5z" />
      <path d="M3 5l5 2.6L13 5" />
      <path d="M8 7.6V13.2" />
    </>
  ),
  // Plug — connect an MCP server.
  'connects-mcp-server': (
    <>
      <path d="M6 2.5v3M10 2.5v3" />
      <path d="M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0z" />
      <path d="M8 11.5v2" />
    </>
  ),
  // Code brackets — run own code.
  'executes-generated': (
    <>
      <path d="M5.5 5 3 8l2.5 3" />
      <path d="M10.5 5 13 8l-2.5 3" />
      <path d="M9 4 7 12" />
    </>
  ),
  // Speech bubble with a plus — adds its own content to your output.
  'injects-output-content': (
    <>
      <path d="M2.5 3.5h11v7H8l-3 2.5v-2.5H2.5z" />
      <path d="M8 5.2v3.6M6.2 7h3.6" />
    </>
  ),
}

export function CapabilityIcon({
  capability,
  className = '',
}: {
  capability: CapabilityKey
  className?: string
}) {
  return <Glyph className={className}>{CAP_GLYPH[capability]}</Glyph>
}

// --- finding glyphs (standalone amber chips) --------------------------------

// Send out — data exfiltration.
const SendOut = (
  <>
    <path d="M8 10.5V3" />
    <path d="M5 6 8 3l3 3" />
    <path d="M3.5 11v1.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V11" />
  </>
)
// Speech bubble + alert — prompt injection.
const ChatAlert = (
  <>
    <path d="M3.5 3.5h9a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H6.5l-2.5 2v-2h-.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
    <path d="M8 5.4v2M8 8.9v.01" />
  </>
)
// Padlock — possible secret.
const Lock = (
  <>
    <rect x="3.5" y="7" width="9" height="6" rx="1.2" />
    <path d="M5.5 7V5.3a2.5 2.5 0 0 1 5 0V7" />
    <path d="M8 9.3v1.5" />
  </>
)
// Shield + alert — vulnerable dependency.
const ShieldAlert = (
  <>
    <path d="M8 2.4 12.5 4v3.8c0 3.1-2 5.3-4.5 6.1-2.5-.8-4.5-3-4.5-6.1V4z" />
    <path d="M8 5.8v2.6M8 10.4v.01" />
  </>
)
// Disable-a-safety-check (tool-misuse): a shield with a slash — the guardrail, struck through.
const ShieldOff = (
  <>
    <path d="M8 2.4 12.5 4v3.8c0 3.1-2 5.3-4.5 6.1-2.5-.8-4.5-3-4.5-6.1V4z" />
    <path d="M4.2 4.2l7.6 7.6" />
  </>
)
// Persist / self-modify (rogue-agent): a closed refresh loop — it comes back / rewrites itself.
const Loop = (
  <>
    <path d="M12.4 8a4.4 4.4 0 1 1-1.3-3.1" />
    <path d="M12.7 3.4V6H10.1" />
  </>
)
// Eye with slash — hard-to-read code.
const EyeOff = (
  <>
    <path d="M2.5 8s2.4-3.3 5.5-3.3S13.5 8 13.5 8 11.1 11.3 8 11.3 2.5 8 2.5 8z" />
    <circle cx="8" cy="8" r="1.6" />
    <path d="M3 3l10 10" />
  </>
)
// Bolt — acts without asking.
const Bolt = <path d="M8.8 2.5 4.5 8.6h3l-.6 4.9 4.6-6.8h-3z" />
// Open padlock — asks for more access.
const LockOpen = (
  <>
    <rect x="3.5" y="7" width="9" height="6" rx="1.2" />
    <path d="M5.5 7V5.3a2.5 2.5 0 0 1 4.7-1.3" />
    <path d="M8 9.3v1.5" />
  </>
)
// Triangle alert — generic fallback.
const Warn = (
  <>
    <path d="M8 2.8 14 13H2z" />
    <path d="M8 6.5v3M8 11v.01" />
  </>
)

/** Resolve a raw finding category to its glyph (keyword fallback mirrors
 *  `findingCategory`), so a standalone chip carries the same icon family. */
export function FindingIcon({
  category,
  className = '',
}: {
  category: string
  className?: string
}) {
  const c = category.toLowerCase()
  let glyph: ReactNode = Warn
  // output-injection (promo content added to your output) is NOT prompt injection;
  // check it before the generic `inject` branch so it doesn't borrow that glyph.
  if (c.includes('output-inject') || c.includes('promo')) glyph = Warn
  else if (c.includes('inject') || c.includes('prompt') || c.includes('leak')) glyph = ChatAlert
  else if (c.includes('exfil') || c.includes('data-out')) glyph = SendOut
  else if (c.includes('tool-misuse') || c.includes('safety')) glyph = ShieldOff
  else if (c.includes('rogue') || c.includes('persist') || c.includes('self-mod')) glyph = Loop
  else if (
    c.includes('secret') ||
    c.includes('cred') ||
    c.includes('token') ||
    c.includes('password')
  )
    glyph = Lock
  else if (c.includes('cve') || c.includes('depend') || c.includes('supply')) glyph = ShieldAlert
  else if (c.includes('obfusc') || c.includes('encod')) glyph = EyeOff
  else if (
    c.includes('agency') ||
    c.includes('approve') ||
    c.includes('loop') ||
    c.includes('auto')
  )
    glyph = Bolt
  else if (c.includes('privilege') || c.includes('escal')) glyph = LockOpen
  return <Glyph className={className}>{glyph}</Glyph>
}
