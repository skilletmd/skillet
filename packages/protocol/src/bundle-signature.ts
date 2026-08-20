/**
 * NF-004 / U4 — domain-separated bundle signature payload (v2).
 *
 * v1 signs utf8(content_hash) only. v2 signs a canonical struct binding
 * author_key_id + ref + version + content_hash so signatures cannot replay
 * across names or identities.
 */
import { canonicalJson } from './delegation.js';

export const BUNDLE_SIG_TYP = 'skillet-bundle-v1' as const;

export interface BundleSignaturePayload {
  typ: typeof BUNDLE_SIG_TYP;
  author_key_id: string;
  ref: string;
  version: number;
  content_hash: string;
}

const VALID_KEY_ID_RE = /^[0-9a-f]{64}$/;
const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const REF_RE = /^@[a-z0-9-]{1,64}\/[a-z0-9-]{1,64}$/;

export function bundleSignatureBytes(payload: BundleSignaturePayload): Buffer {
  if (payload.typ !== BUNDLE_SIG_TYP) {
    throw new Error(`bundleSignatureBytes: unsupported typ ${JSON.stringify(payload.typ)}`);
  }
  if (!VALID_KEY_ID_RE.test(payload.author_key_id)) {
    throw new Error(`bundleSignatureBytes: invalid author_key_id ${JSON.stringify(payload.author_key_id)}`);
  }
  if (!REF_RE.test(payload.ref)) {
    throw new Error(`bundleSignatureBytes: ref must match @author/slug, got ${JSON.stringify(payload.ref)}`);
  }
  if (!Number.isInteger(payload.version) || payload.version < 1) {
    throw new Error(`bundleSignatureBytes: version must be a positive integer, got ${payload.version}`);
  }
  if (!CONTENT_HASH_RE.test(payload.content_hash)) {
    throw new Error(
      `bundleSignatureBytes: content_hash must match /^sha256:[0-9a-f]{64}$/, got ${JSON.stringify(payload.content_hash)}`,
    );
  }
  return Buffer.from(canonicalJson(payload), 'utf8');
}

export function isBundleSignatureV2(envelope: { sig_version?: unknown } | null | undefined): boolean {
  return envelope?.sig_version === 2;
}
