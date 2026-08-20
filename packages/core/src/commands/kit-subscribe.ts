import { RegistryClient, RegistryError, type RegistryKitView } from '../registry/client.js';
import { parseKitHandle } from '../registry/kit-handle.js';
import { kitSkillRefsFromIds } from './kit-add-materialize.js';

export interface SubscribeKitOptions {
  registryUrl: string;
  /** Session bearer — kit subscribe requires a signed-in user. */
  token: string;
  fetchImpl?: typeof fetch;
}

export interface SubscribeKitResult {
  kitId: string;
  kitName: string;
  owner: string;
  slug: string;
  skillCount: number;
  /** Canonical `@owner/skill` refs in this kit. */
  skillRefs: string[];
  alreadySubscribed: boolean;
}

/**
 * Read-only kit lookup for `add`'s auto-detection. Returns the kit view, or
 * null when no kit lives at this handle (so `add @ref` can fall back to the
 * skill flow). A ref that isn't `@owner/slug` shaped can't name a kit, so it
 * returns null too. Only a 404 is swallowed; other failures propagate.
 */
export async function findKitByHandle(
  ref: string,
  opts: SubscribeKitOptions,
): Promise<RegistryKitView | null> {
  let handle: ReturnType<typeof parseKitHandle>;
  try {
    handle = parseKitHandle(ref);
  } catch {
    return null;
  }
  const client = new RegistryClient({
    baseUrl: opts.registryUrl,
    token: opts.token,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  try {
    return await client.getKitByHandle(handle.owner, handle.slug);
  } catch (err) {
    if (err instanceof RegistryError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Resolve a kit by handle and subscribe the caller's account.
 */
export async function subscribeKitByHandle(
  ref: string,
  opts: SubscribeKitOptions,
): Promise<SubscribeKitResult> {
  const handle = parseKitHandle(ref);
  const client = new RegistryClient({
    baseUrl: opts.registryUrl,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
  });
  const kit = await client.getKitByHandle(handle.owner, handle.slug);
  const alreadySubscribed = kit.subscribed === true;
  if (!alreadySubscribed) {
    await client.subscribeKit(kit.id);
  }
  return {
    kitId: kit.id,
    kitName: kit.name,
    owner: kit.owner,
    slug: kit.slug,
    skillCount: kit.skills?.length ?? 0,
    skillRefs: kitSkillRefsFromIds(kit.skills ?? []),
    alreadySubscribed,
  };
}
