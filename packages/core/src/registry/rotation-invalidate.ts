/**
 * Post-accept invalidation for an author key rotation.
 *
 * Re-pinning alone does not unmask a rotated handle: a rotation re-signs
 * versions without changing content hashes, so the hash-equality `unchanged`
 * short-circuits in registry pull never reach verification, and cached
 * manifest etags 304 the retry. Accepting a rotation therefore also marks the
 * handle's registry-sourced entries `needsKeyReverify` and drops the etags
 * that would short-circuit the refetch; pull clears the flag after a
 * successful re-verify rewrites hash, envelope, and identity together.
 *
 * Lives outside signing/ on purpose — pin modules stay free of kit-state and
 * cache IO; both CLI accept call sites (`skillet pin accept`, the interactive
 * sync re-pin loop) route through here.
 */
import { readState, upsertSkill } from '../kit/store.js';
import {
  defaultEtagCachePath,
  readEtagCache,
  writeEtagCache,
} from './etag-cache.js';
import { acceptAuthorKeyRotation } from '../signing/pin-recovery.js';
import { defaultPinDir, type PinnedAuthorKey } from '../signing/pin.js';

function normalizeHandle(handle: string): string {
  const h = handle.startsWith('@') ? handle.slice(1) : handle;
  return h.toLowerCase();
}

function slugOwnedBy(slug: string, handle: string): boolean {
  return slug.toLowerCase().startsWith(`@${handle}/`);
}

/**
 * Flag the handle's registry-sourced entries for re-verification and drop
 * their manifest etags (plus the union-manifest etag map — union keys are per
 * registry/device/bearer, not per handle, so they cannot be dropped narrower).
 * Idempotent: safe to run on an already-invalidated or already-recovered
 * handle; re-verify is a no-op when entries already match the pin.
 */
export async function invalidateAfterKeyRotation(
  handle: string,
  opts: { etagCachePath?: string } = {},
): Promise<{ flagged: string[] }> {
  const h = normalizeHandle(handle);
  const state = await readState();
  const flagged: string[] = [];
  for (const [slug, entry] of Object.entries(state.skills)) {
    // Only signed registry-sourced entries carry key material to refresh;
    // local imports have no authorKeyId and never verify against a pin.
    if (!slugOwnedBy(slug, h)) continue;
    if (entry.source !== 'registry' || !entry.authorKeyId) continue;
    entry.needsKeyReverify = true;
    await upsertSkill(entry);
    flagged.push(slug);
  }

  const etagPath = opts.etagCachePath ?? defaultEtagCachePath();
  try {
    const cache = await readEtagCache(etagPath);
    let dirty = false;
    for (const key of Object.keys(cache.entries)) {
      if (slugOwnedBy(key, h)) {
        delete cache.entries[key];
        dirty = true;
      }
    }
    if (cache.union && Object.keys(cache.union).length > 0) {
      cache.union = {};
      dirty = true;
    }
    if (dirty) await writeEtagCache(etagPath, cache);
  } catch {
    // Cache invalidation is best-effort: a stale etag only delays the
    // refetch until the manifest changes; the needsKeyReverify flag is the
    // load-bearing part and is already persisted above.
  }

  return { flagged };
}

/**
 * Accept a served key for `handle` (force re-pin) AND run the invalidation
 * that makes the next sync actually re-verify the handle's skills. This is
 * the accept path both CLI call sites use; calling `acceptAuthorKeyRotation`
 * alone re-pins but leaves the masked `unchanged` state in place.
 */
export async function acceptAuthorKeyRotationWithInvalidation(
  handle: string,
  served: { key_id: string; pub: string },
  pinDir: string = defaultPinDir(),
  opts: { firstSeenVersion?: number; etagCachePath?: string } = {},
): Promise<{ pinned: PinnedAuthorKey; flagged: string[] }> {
  const pinned = await acceptAuthorKeyRotation(handle, served, pinDir, {
    firstSeenVersion: opts.firstSeenVersion,
  });
  const { flagged } = await invalidateAfterKeyRotation(handle, {
    etagCachePath: opts.etagCachePath,
  });
  return { pinned, flagged };
}
