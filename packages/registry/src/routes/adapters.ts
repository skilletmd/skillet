// GET /api/v1/adapters/manifest — signed declarative adapter feed (PROTOCOL §10).
//
// Wire shape:
//   { adapters: AdapterEntry[], content_hash: string, signature: Signature | null }
//
// content_hash = sha256: of canonical JSON (adapters sorted by key, fields alphabetical).
// signature    = Ed25519 envelope over utf8(content_hash) using the Skillet release key.
// signature is null when SKILLET_ADAPTER_RELEASE_KEY is unset (dev / CI mode).
//
// Client responsibilities (enforced by @skillet/core verifyAdapterManifest):
//   - Verify signature against the hardcoded release public key.
//   - Derive content_hash from the received adapters array and compare.
//   - Validate each root against the per-runtime allowlist; reject path-escape.
//   - Degrade-never-delete on any validation failure.

import type { FastifyInstance } from 'fastify';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

export type AdapterKind = 'global' | 'project';
export type AdapterLayout = 'skill-md' | 'mdc' | 'rules-file';

export interface AdapterEntry {
  detect: string;
  key: string;
  kind: AdapterKind;
  layout: AdapterLayout;
  root: string;
  version: string;
}

// Canonical adapter table — must match AdapterLayout in manifest.ts and MATERIALIZATION_ROOT_ALLOWLIST.
// Fields are in alphabetical order so JSON.stringify produces stable canonical bytes.
const ADAPTER_ENTRIES: AdapterEntry[] = [
  {
    detect: '~/.claude',
    key: 'claude-code',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.claude/skills',
    version: '1.0.0',
  },
  {
    detect: '~/.agents or ~/.codex (legacy back-compat)',
    key: 'codex',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.agents/skills',
    version: '1.0.0',
  },
  {
    detect: '/Applications/Cursor.app or ~/.cursor',
    key: 'cursor',
    kind: 'project',
    layout: 'mdc',
    root: '.cursor/rules',
    version: '1.0.0',
  },
  {
    detect: '~/.config/devin or /Applications/Devin.app',
    key: 'devin',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.config/devin/skills',
    version: '1.0.0',
  },
  {
    detect: '~/.hermes',
    key: 'hermes',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.hermes/skills',
    version: '1.0.0',
  },
  {
    detect: '~/.openclaw',
    key: 'openclaw',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.openclaw/skills',
    version: '1.0.0',
  },
  {
    detect: '.windsurf/rules or AGENTS.md in project tree',
    key: 'windsurf',
    kind: 'project',
    layout: 'rules-file',
    root: '.windsurf/rules',
    version: '1.0.0',
  },
];

// Pre-sorted by key; object key order is alphabetical for stable JSON.
const CANONICAL_ADAPTERS: AdapterEntry[] = [...ADAPTER_ENTRIES].sort((a, b) =>
  a.key.localeCompare(b.key),
);

/**
 * Produce the canonical JSON bytes used to compute content_hash.
 * Fields are alphabetical (detect, key, kind, layout, root, version);
 * entries are sorted by key. Both server and client MUST use this exact
 * algorithm — any deviation breaks signature verification.
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

export function adapterContentHash(adapters: AdapterEntry[]): string {
  const json = canonicalAdapterJson(adapters);
  const hex = createHash('sha256').update(json, 'utf8').digest('hex');
  return `sha256:${hex}`;
}

export interface AdapterRoutesOptions {
  /**
   * Hex-encoded PKCS#8 DER of the Skillet adapter-release Ed25519 private key.
   * When provided (or when SKILLET_ADAPTER_RELEASE_KEY env var is set), the
   * manifest response includes a valid signature envelope. When absent, the
   * signature field is null — clients in strict mode MUST reject unsigned feeds.
   */
  adapterSigningKeyHex?: string;
}

export function registerAdapterRoutes(
  app: FastifyInstance,
  opts: AdapterRoutesOptions = {},
): void {
  app.get('/adapters/manifest', async (_req, reply) => {
    const hash = adapterContentHash(CANONICAL_ADAPTERS);

    const keyHex = opts.adapterSigningKeyHex ?? process.env['SKILLET_ADAPTER_RELEASE_KEY'];
    const production =
      process.env.NODE_ENV === 'production' &&
      process.env['SKILLET_ALLOW_UNSIGNED_ADAPTER_MANIFEST'] !== '1';

    if (production && (!keyHex || keyHex.length === 0)) {
      return reply.status(503).send({
        error: 'adapter_manifest_unavailable',
        message: 'Adapter manifest signing key is not configured',
      });
    }

    let signature: { alg: string; key_id: string; sig: string } | null = null;

    if (keyHex && keyHex.length > 0) {
      try {
        const pkcs8Der = Buffer.from(keyHex, 'hex');
        const privateKey = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
        const publicKey = createPublicKey(privateKey);
        const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
        const keyId = Buffer.from(jwk.x, 'base64url').toString('hex');
        const sigBytes = sign(null, Buffer.from(hash, 'utf8'), privateKey);
        signature = { alg: 'ed25519', key_id: keyId, sig: sigBytes.toString('base64') };
      } catch (err) {
        if (production) {
          app.log.error({ err }, 'adapter manifest: release key load failed');
          return reply.status(503).send({
            error: 'adapter_manifest_unavailable',
            message: 'Adapter manifest signing key is misconfigured',
          });
        }
        app.log.error({ err }, 'adapter manifest: release key load failed, serving unsigned');
      }
    }

    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.status(200).send({
      adapters: CANONICAL_ADAPTERS,
      content_hash: hash,
      signature,
    });
  });
}
