/**
 * Client-identity normalizers shared by pair-claim (request body) and the
 * auth middleware (x-skillet-machine-id / x-skillet-client-kind headers).
 * One definition so the accepted shapes cannot drift between the two
 * ingestion paths. Malformed values are ignored, never rejected — identity
 * is a convergence hint, not an authentication input.
 */

export function normalizeClientKind(raw: unknown): string | null {
  if (raw === 'cli' || raw === 'desktop') return raw;
  return null;
}

export function normalizeClientPlatform(raw: unknown): string | null {
  if (raw === 'macos' || raw === 'windows') return raw;
  return null;
}

// Client-minted opaque id (HMAC digest or legacy UUID). Bounded +
// charset-checked so arbitrary junk never lands in the column.
const MACHINE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function normalizeMachineId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return MACHINE_ID_RE.test(id) ? id : null;
}

/**
 * A device row is merge/reclaim-eligible only when its token has been quiet
 * this long. Two live installs on one machine (a second SKILLET_DIR, another
 * OS user) must never sign each other out — not through passive traffic and
 * not through the other install pairing (R5). Days not minutes: sync cadence
 * is minutes, dead rows are weeks.
 */
export const STALE_SIBLING_SEC = 48 * 60 * 60;

/** Stored devices.client_kinds JSON → string array (never throws). */
export function parseStoredKinds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === 'string' && k.length > 0)
      : [];
  } catch {
    return [];
  }
}
