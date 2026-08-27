import type { MaterializeOptions } from "../adapter.js";
import {
  BUNDLED_CREATE_MATERIALIZE_DIR,
  BUNDLED_CREATE_SLUG,
  BUNDLED_ROUTE_MATERIALIZE_DIR,
  BUNDLED_ROUTE_SLUG,
} from "../commands/route.js";

export function bareAdapterSlug(slug: string, owner: string | null): string {
  if (owner && slug.startsWith("@")) {
    const idx = slug.indexOf("/");
    if (idx >= 0) return slug.slice(idx + 1);
  }
  return slug;
}

export interface SkillMaterializeIdentity {
  adapterSlug: string;
  owner: string | null;
  dirName?: string;
}

export function skillMaterializeIdentity(
  slug: string,
  owner: string | null,
): SkillMaterializeIdentity {
  const adapterSlug = bareAdapterSlug(slug, owner);
  if (slug === BUNDLED_ROUTE_SLUG) {
    return {
      adapterSlug,
      owner,
      dirName: BUNDLED_ROUTE_MATERIALIZE_DIR,
    };
  }
  if (slug === BUNDLED_CREATE_SLUG) {
    return {
      adapterSlug,
      owner,
      dirName: BUNDLED_CREATE_MATERIALIZE_DIR,
    };
  }
  return { adapterSlug, owner };
}

export function materializeOptsForIdentity(
  identity: SkillMaterializeIdentity,
  cwd?: string,
  extra?: Pick<MaterializeOptions, "description">,
): MaterializeOptions {
  return {
    owner: identity.owner,
    cwd,
    ...(identity.dirName ? { dirName: identity.dirName } : {}),
    ...(extra?.description ? { description: extra.description } : {}),
  };
}
