/**
 * Label normalization for the tray's inline device rename.
 *
 * Pure so it unit-tests without a DOM (the pair-code.ts precedent). Mirrors
 * the server's cleaning (trim, 80-char clamp) with one deliberate divergence:
 * empty/whitespace returns null, which the tray treats as CANCEL — the server
 * would null the label and the Settings row is gated on one existing, so an
 * empty save would make the row vanish (plan 2026-07-08-002, KTD5).
 */
export const DEVICE_LABEL_MAX = 80

export function normalizeDeviceLabel(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, DEVICE_LABEL_MAX)
}
