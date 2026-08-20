// Session-attested publish for interactive surfaces (web, desktop).
// Verified session proves account control; Ed25519 signatures stay on the CLI path.

export const PUBLISH_AUTH_SESSION = 'session' as const;
export const SIG_ALG_SESSION = 'session' as const;

export type PublishAuthMode = typeof PUBLISH_AUTH_SESSION | 'signature';

export function isSessionPublishAuth(value: unknown): value is typeof PUBLISH_AUTH_SESSION {
  return value === PUBLISH_AUTH_SESSION;
}

/** Wire envelope returned for session-attested versions (no Ed25519 sig bytes). */
export function sessionSignatureEnvelope(primaryKeyId: string | null): {
  alg: typeof SIG_ALG_SESSION;
  key_id: string;
  sig: string;
} {
  return {
    alg: SIG_ALG_SESSION,
    key_id: primaryKeyId ?? '0'.repeat(64),
    sig: '',
  };
}

interface VersionSignatureRow {
  signature_alg: string | null;
  signature_key_id: string | null;
  signature_b64: string | null;
  /** Signature scheme version persisted at publish (migration 035). */
  sig_version: number | null;
  /** Trust-root primary key id; used to infer sig_version when NULL. */
  author_key_id?: string | null;
}

/**
 * Resolve the signature scheme version for a served version row. Post-backfill
 * every signed row has a concrete `sig_version`, but defensively fall back to
 * inferring v2 when an author key is bound (`author_key_id`) and v1 otherwise,
 * so served envelopes are never wrong or omitted.
 */
function resolveSigVersion(row: VersionSignatureRow): number {
  if (row.sig_version === 1 || row.sig_version === 2) return row.sig_version;
  return row.author_key_id ? 2 : 1;
}

/** Map a skill_versions row to the API signature envelope (or null if unsigned). */
export function wireSignatureFromVersionRow(
  row: VersionSignatureRow,
): { alg: string; key_id: string; sig: string; sig_version: number } | null {
  if (!row.signature_alg || !row.signature_key_id) return null;
  if (row.signature_alg === SIG_ALG_SESSION) {
    return {
      alg: SIG_ALG_SESSION,
      key_id: row.signature_key_id,
      sig: row.signature_b64 ?? '',
      sig_version: resolveSigVersion(row),
    };
  }
  if (!row.signature_b64) return null;
  return {
    alg: row.signature_alg,
    key_id: row.signature_key_id,
    sig: row.signature_b64,
    sig_version: resolveSigVersion(row),
  };
}
