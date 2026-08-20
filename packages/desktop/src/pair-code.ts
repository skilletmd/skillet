/**
 * Pair-code helpers for the desktop tray — kept in sync with @skillet/core/pair-code.
 * We duplicate here because the Tauri frontend does not bundle @skillet/core.
 */

export const PAIR_CODE_RE = /^[A-Z2-9]{8}$/

export function normalizePairCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s_-]+/g, '')
}

function looksLikeFormattedCode(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  if (/\b(NPX|CONNECT|SKILLET)\b/i.test(trimmed)) return false
  const normalized = normalizePairCode(raw)
  if (normalized.length !== 8 || !PAIR_CODE_RE.test(normalized)) return false
  const tokens = trimmed.split(/\s+/)
  if (tokens.length >= 3) return false
  if (tokens.length === 1) return true
  return /^[A-Z2-9]{4}[-\s][A-Z2-9]{4}$/i.test(trimmed) || tokens.length === 2
}

export function extractPairCode(raw: string): string | null {
  const normalized = normalizePairCode(raw)
  if (looksLikeFormattedCode(raw) && PAIR_CODE_RE.test(normalized)) {
    return normalized
  }

  const upper = raw.trim().toUpperCase()
  const connectMatch = upper.match(/\bCONNECT\b\s*([A-Z2-9]{8})\b/)
  if (connectMatch?.[1] && PAIR_CODE_RE.test(connectMatch[1])) {
    return connectMatch[1]
  }

  if (!/\b(NPX|CONNECT|SKILLET)\b/.test(upper)) {
    return null
  }

  const collapsed = upper.replace(/[^A-Z2-9]/g, '')
  const matches = collapsed.match(/[A-Z2-9]{8}/g)
  if (!matches?.length) {
    return null
  }
  const last = matches[matches.length - 1]!
  return PAIR_CODE_RE.test(last) ? last : null
}

/** User-facing validation error for the tray pair-code field. */
export function pairCodeInputError(raw: string): string {
  const trimmed = raw.trim()
  const upper = trimmed.toUpperCase()
  if (trimmed.length > 11 || /\b(NPX|CONNECT)\b/.test(upper)) {
    return 'Paste only the 8-character code from Settings → Devices, not the full command.'
  }
  const normalized = normalizePairCode(raw)
  if (normalized.length === 8 && !PAIR_CODE_RE.test(normalized)) {
    return 'Code uses only letters and numbers (no 0, O, 1, or I).'
  }
  return 'Enter the 8-character code.'
}
