/**
 * Pull each relevant author's revoked device-key set on sync.
 * Negative info is public — subscribers need it to refuse freshly delegated versions.
 */
import { parseSkillRef } from './identifier.js';
import type { KitState } from '../kit/types.js';
import { RegistryClient } from './client.js';

function authorHandleFromEntry(slug: string, owner: string | null | undefined): string | null {
  try {
    const raw = owner ?? parseSkillRef(slug).author;
    return raw.startsWith('@') ? raw.slice(1) : raw;
  } catch {
    return null;
  }
}

export interface RevokedDeviceKeyIdsResult {
  ids: Set<string>;
  /** False when we needed revocation data but every per-author fetch failed. */
  ok: boolean;
}

/**
 * Best-effort union of revoked device key ids for every registry author in state.
 * Returns ok=false when all fetches failed but handles were present.
 */
export async function resolveRevokedDeviceKeyIds(
  state: KitState,
  registryUrl: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<RevokedDeviceKeyIdsResult> {
  const handles = new Set<string>();
  for (const [slug, entry] of Object.entries(state.skills)) {
    if (entry.source !== 'registry') continue;
    const handle = authorHandleFromEntry(slug, entry.owner);
    if (handle) handles.add(handle);
  }
  if (handles.size === 0) return { ids: new Set(), ok: true };

  const client = new RegistryClient({
    baseUrl: registryUrl,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  const merged = new Set<string>();
  let anySucceeded = false;
  for (const handle of handles) {
    try {
      const ids = await client.listAuthorRevokedDeviceKeys(handle);
      anySucceeded = true;
      for (const id of ids) merged.add(id);
    } catch {
      // Registry unreachable or author unknown — skip this handle.
    }
  }
  return { ids: merged, ok: anySucceeded };
}
