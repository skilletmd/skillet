/** Sanitize the brand handle we're claiming: lowercase, trimmed, conservative charset. */
export function safeClaimHandle(raw: string | null | undefined): string | null {
  const h = (raw ?? '').trim().toLowerCase()
  if (!h || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(h)) return null
  return h
}
