/**
 * Small section label used across object detail pages (skill, kit) — the quiet
 * uppercase heading above each content/sidebar section. One treatment so the two
 * pages line up.
 */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-(--ink-2)">{children}</p>
}
