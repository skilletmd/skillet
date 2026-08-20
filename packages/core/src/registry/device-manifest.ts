import type { SyncManifestItem } from '@skillet/protocol';
import { loadRegistryBearer } from '../auth-token.js';
import { readDeviceId } from '../device-token.js';
import { RegistryClient } from './client.js';
import {
  defaultEtagCachePath,
  readEtagCache,
  unionManifestEtagKey,
  writeEtagCache,
} from './etag-cache.js';

export interface DeviceScopedManifestResult {
  /** Present when the registry returned a manifest; `[]` when the device union is empty. */
  items: SyncManifestItem[] | undefined;
  /** True when we got an authoritative 200 from the registry. */
  fetched: boolean;
  /**
   * True when the registry answered at all (200 or 304). A 304 etag hit has no
   * items but is NOT offline; only report offline when this is false.
   */
  reached: boolean;
}

export interface ResolveDeviceScopedManifestOptions {
  registryUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  etagCachePath?: string;
}

/**
 * Fetch the sync manifest this machine should display — same scoping contract as
 * `skillet sync`. Session tokens pass `?device=` when `device.json` has an id;
 * device tokens rely on server-side `principal.device_id` exclusions.
 */
export async function resolveDeviceScopedManifest(
  opts: ResolveDeviceScopedManifestOptions,
): Promise<DeviceScopedManifestResult> {
  const bearer = await loadRegistryBearer(opts.token);
  if (!bearer.token) {
    return { items: undefined, fetched: false, reached: false };
  }

  const deviceId = await readDeviceId();

  const client = new RegistryClient({
    baseUrl: opts.registryUrl,
    token: bearer.token,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });

  const queryOpts =
    bearer.kind === 'session' && deviceId ? { device: deviceId } : {};

  const etagPath = opts.etagCachePath ?? defaultEtagCachePath();
  const cache = await readEtagCache(etagPath);
  if (!cache.union) cache.union = {};
  const unionKey = unionManifestEtagKey(
    opts.registryUrl,
    bearer.kind === 'session' && deviceId ? deviceId : undefined,
    bearer.kind,
  );
  const cachedUnionEtag = cache.union[unionKey] ?? null;

  try {
    const res = await client.getSyncManifest({
      ...queryOpts,
      etag: cachedUnionEtag,
    });
    if (res.notModified || !res.value) {
      return { items: undefined, fetched: false, reached: true };
    }
    if (res.etag) {
      cache.union[unionKey] = res.etag;
      await writeEtagCache(etagPath, cache);
    }
    return { items: res.value.items, fetched: true, reached: true };
  } catch {
    return { items: undefined, fetched: false, reached: false };
  }
}
