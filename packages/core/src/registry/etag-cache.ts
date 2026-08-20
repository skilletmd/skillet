import { readFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from '../util/atomic.js';

export interface EtagCache {
  version: 1;
  /** ref → quoted ETag the per-skill manifest endpoint last returned. */
  entries: Record<string, string>;
  /** Union manifest ETags keyed by registryUrl|deviceId|bearerKind. */
  union?: Record<string, string>;
}

/** Stable cache key for GET /sync/manifest (per registry + device scope + bearer class). */
export function unionManifestEtagKey(
  registryUrl: string,
  deviceId?: string,
  bearerKind?: string,
): string {
  const base = registryUrl.replace(/\/+$/, '');
  return `${base}|${deviceId ?? ''}|${bearerKind ?? 'unknown'}`;
}

export function bearerKindFromToken(token: string): string {
  if (token.startsWith('skillet_d_')) return 'device';
  if (token.startsWith('skillet_k_')) return 'kit';
  if (token.startsWith('skillet_s_')) return 'session';
  return 'unknown';
}

export function defaultEtagCachePath(): string {
  const skilletDir = process.env['SKILLET_DIR'] ?? join(homedir(), '.skillet');
  return join(skilletDir, 'etag-cache.json');
}

export async function readEtagCache(path: string): Promise<EtagCache> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as EtagCache;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === 1 &&
      typeof parsed.entries === 'object'
    ) {
      return {
        version: 1,
        entries: parsed.entries,
        union: parsed.union && typeof parsed.union === 'object' ? parsed.union : {},
      };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Corrupt cache is harmless — we just re-fetch full manifests until the
      // next successful write replaces it.
    }
  }
  return { version: 1, entries: {}, union: {} };
}

export async function writeEtagCache(path: string, cache: EtagCache): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await atomicWrite(path, JSON.stringify(cache, null, 2) + '\n', { backup: false });
}
