// Client-side verification for the §10 adapter manifest feed.
//
// Usage:
//   const manifest = await fetch('/api/v1/adapters/manifest').then(r => r.json());
//   const verified = verifyAdapterManifest(manifest);   // throws on any failure
//   const updated  = mergeAdapterManifest(current, verified); // degrade-never-delete merge
//
// Security invariants:
//   - Signature MUST verify against the hardcoded Skillet release public key.
//   - content_hash MUST match a fresh derivation from the received adapters.
//   - Each adapter root is validated against the per-runtime allowlist.
//   - Path-escape in root is rejected.
//   - mergeAdapterManifest never deletes an existing adapter; invalid entries degrade.

import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join, normalize, sep } from 'node:path';
import { skilletReleasePublicKey } from '../signing/index.js';
import { verifyEnvelope, type Signature } from '../signing/envelope.js';
import { isEd25519Signature } from '../signing/session-attest.js';
import type { AdapterEntry } from '@skillet/protocol/adapter-table';
import {
  MATERIALIZATION_ROOT_ALLOWLIST,
  PROJECT_TARGET_ALLOWLIST,
} from '../util/pathsafe.js';

// Wire types come from @skillet/protocol, which also owns the canonical table
// the registry serves. Re-exported here so existing importers of
// `@skillet/core` keep working.
export type { AdapterKind, AdapterLayout, AdapterEntry } from '@skillet/protocol/adapter-table';

export interface AdapterManifest {
  adapters: AdapterEntry[];
  content_hash: string;
  signature: Signature | null;
}

export interface VerifiedAdapterManifest {
  adapters: AdapterEntry[];
  content_hash: string;
}

// Reject roots with traversal segments or embedded null bytes regardless of kind.
function hasPathEscape(root: string): boolean {
  if (root.includes('\x00')) return true;
  const norm = normalize(root.replace(/\//g, sep));
  return norm.split(sep).some((s) => s === '..');
}

// Expand "~" prefix to the actual homedir. Only the leading "~/" is expanded;
// "~user" is not supported (and would fail the allowlist check anyway).
function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

// Validate a single adapter entry's root against the per-runtime allowlist.
// Returns null if valid, or a human-readable rejection reason.
function validateRoot(entry: AdapterEntry): string | null {
  if (hasPathEscape(entry.root)) {
    return `path-escape rejected in root "${entry.root}"`;
  }

  if (entry.kind === 'project') {
    if (entry.root.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entry.root)) {
      return `project root "${entry.root}" must be a relative POSIX path`;
    }
    if (!PROJECT_TARGET_ALLOWLIST.includes(entry.root)) {
      return `project root "${entry.root}" is not in the project-target allowlist`;
    }
    return null;
  }

  // Global adapter: expand tilde and compare against MATERIALIZATION_ROOT_ALLOWLIST.
  const expanded = expandTilde(entry.root);
  const resolved = resolve(expanded);
  const allowed = MATERIALIZATION_ROOT_ALLOWLIST.some(
    (a) => resolve(a) === resolved,
  );
  if (!allowed) {
    return `global root "${entry.root}" is not in the per-runtime allowlist`;
  }
  return null;
}

/**
 * Produce the canonical JSON bytes used to compute content_hash.
 * MUST match the server-side implementation in packages/registry/src/routes/adapters.ts.
 * Fields are alphabetical; entries are sorted by key; compact (no whitespace).
 */
export function canonicalAdapterJson(adapters: AdapterEntry[]): string {
  const sorted = [...adapters].sort((a, b) => a.key.localeCompare(b.key));
  const normalized = sorted.map((e) => ({
    detect: e.detect,
    key: e.key,
    kind: e.kind,
    layout: e.layout,
    root: e.root,
    version: e.version,
  }));
  return JSON.stringify(normalized);
}

export function deriveAdapterContentHash(adapters: AdapterEntry[]): string {
  const json = canonicalAdapterJson(adapters);
  const hex = createHash('sha256').update(json, 'utf8').digest('hex');
  return `sha256:${hex}`;
}

/**
 * Verify an adapter manifest received from the registry.
 *
 * Throws a descriptive error for every failure mode:
 *   - Missing or null signature (callers may allow in dev mode with `opts.allowUnsigned`)
 *   - Signature fails Ed25519 verification against the Skillet release public key
 *   - content_hash does not match derivation from the adapters array
 *   - Any adapter entry fails root allowlist validation or path-escape check
 *
 * Returns the verified manifest with only entries that passed allowlist validation.
 * Entries that fail are silently dropped (degrade path); the caller should log them.
 */
/** Default verify options: unsigned manifests allowed only in non-production dev. */
export function adapterManifestVerifyOptions(): { allowUnsigned?: boolean } {
  if (process.env.SKILLET_ALLOW_UNSIGNED_MANIFEST === '1') {
    return { allowUnsigned: true };
  }
  if (process.env.NODE_ENV === 'production') {
    return { allowUnsigned: false };
  }
  return { allowUnsigned: true };
}

export function verifyAdapterManifest(
  manifest: unknown,
  opts: { allowUnsigned?: boolean } = adapterManifestVerifyOptions(),
): VerifiedAdapterManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('adapter manifest: response is not an object');
  }
  const m = manifest as Record<string, unknown>;

  if (!Array.isArray(m['adapters'])) {
    throw new Error('adapter manifest: missing adapters array');
  }
  if (typeof m['content_hash'] !== 'string') {
    throw new Error('adapter manifest: missing content_hash string');
  }

  const adapters = m['adapters'] as AdapterEntry[];
  const content_hash = m['content_hash'] as string;
  const signature = m['signature'] as Signature | null;

  // Signature gate.
  if (!signature) {
    if (!opts.allowUnsigned) {
      throw new Error(
        'adapter manifest: signature is null; refusing unsigned manifest (pass allowUnsigned for dev mode)',
      );
    }
  } else if (isEd25519Signature(signature)) {
    const pubKey = skilletReleasePublicKey();
    verifyEnvelope(content_hash, signature, pubKey);
  } else {
    throw new Error(
      `adapter manifest: unsupported signature alg ${JSON.stringify(signature.alg)}`,
    );
  }

  // Integrity: re-derive the hash from the received adapters and compare.
  const derived = deriveAdapterContentHash(adapters);
  if (derived !== content_hash) {
    throw new Error(
      `adapter manifest: content_hash mismatch (received ${content_hash}, derived ${derived})`,
    );
  }

  // Allowlist validation — degrade-path: drop invalid entries, keep valid ones.
  const valid: AdapterEntry[] = [];
  for (const entry of adapters) {
    const rejection = validateRoot(entry);
    if (rejection) {
      // Degrade: skip entry, never throw here. Caller may log this path.
      continue;
    }
    valid.push(entry);
  }

  return { adapters: valid, content_hash };
}

/**
 * Merge a verified manifest into the current adapter set.
 *
 * Rules (degrade-never-delete):
 *   - If a key appears in `verified` it replaces the entry in `current`.
 *   - If a key appears only in `current` it is KEPT (never deleted).
 *   - New keys in `verified` not in `current` are added.
 *
 * This is the soak-safe merge: a misbehaving registry that drops adapters
 * does not remove them from the client's active set. A genuine removal
 * requires a version bump and a soak period the CLI orchestrates.
 */
export function mergeAdapterManifest(
  current: AdapterEntry[],
  verified: VerifiedAdapterManifest,
): AdapterEntry[] {
  const map = new Map<string, AdapterEntry>();
  for (const e of current) map.set(e.key, e);
  for (const e of verified.adapters) map.set(e.key, e);
  return [...map.values()];
}
