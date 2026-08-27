import matter from "gray-matter";
import { canonicalContentHash, validateBundle, type DecodedBundle } from "@skillet/protocol";
import { readBundleFromDir } from "../bundle/read.js";
import {
  readState,
  skillContentDir,
  upsertSkill,
  writeBundleToSkillStore,
} from "../kit/store.js";
import { BUNDLED_CREATE_SLUG, BUNDLED_ROUTE_SLUG } from "./route.js";
import type { SkillEntry } from "../kit/types.js";

export type EnsureBundledRouteResult = "installed" | "updated" | "unchanged";

export { BUNDLED_CREATE_SLUG, BUNDLED_ROUTE_SLUG };

/** Load a bundled skill from disk, falling back to an inlined SKILL.md.
 *
 *  The pkg-compiled desktop sidecar has no `bundled-skills` on disk — pkg never
 *  snapshots `dist/bundled-skills` — so the disk read throws there. The CLI
 *  inlines the SKILL.md at bundle time and passes it as the fallback, so the
 *  route skill still materializes for desktop-only users. */
async function loadBundledSkill(
  bundledDir: string,
  inlineSkillMd: string | undefined,
): Promise<DecodedBundle> {
  try {
    return await readBundleFromDir(bundledDir);
  } catch (err) {
    if (!inlineSkillMd) throw err;
    const bundle: DecodedBundle = new Map();
    bundle.set("SKILL.md", Buffer.from(inlineSkillMd, "utf8"));
    validateBundle(bundle);
    return bundle;
  }
}

/** Install (or refresh) one CLI-bundled meta-skill in the local kit.
 *
 *  Shared by `@skillet/route` and `@skillet/create`: both ship inside the CLI,
 *  both must exist with nothing synced, and both re-materialize whenever their
 *  shipped content changes. */
export async function ensureBundledSkill(
  slug: string,
  bundledDir: string,
  inlineSkillMd?: string,
): Promise<EnsureBundledRouteResult> {
  const bundle = await loadBundledSkill(bundledDir, inlineSkillMd);
  const hash = canonicalContentHash(bundle);
  const state = await readState();
  const existing = state.skills[slug];
  if (existing?.hash === hash) {
    try {
      await readBundleFromDir(skillContentDir(slug));
      return "unchanged";
    } catch {
      // Hash matches state but files missing — reinstall below.
    }
  }

  const entrypointBytes = bundle.get("SKILL.md");
  if (!entrypointBytes) {
    throw new Error(`Bundled skill ${slug} is missing SKILL.md`);
  }
  const parsed = matter(Buffer.from(entrypointBytes).toString("utf8"));
  const fm = parsed.data as Record<string, unknown>;
  const name = typeof fm["name"] === "string" ? fm["name"] : "skillet";
  const description =
    typeof fm["description"] === "string" ? fm["description"] : "";

  await writeBundleToSkillStore(slug, bundle);

  const now = new Date().toISOString();
  const entry: SkillEntry = {
    slug,
    name,
    description,
    version: existing?.version ?? 1,
    hash,
    source: "local",
    owner: "skillet",
    importedAt: existing?.importedAt ?? now,
    updatedAt: now,
  };

  await upsertSkill(entry);
  return existing ? "updated" : "installed";
}

/** Back-compat wrapper: install the bundled `@skillet/route` router. */
export async function ensureBundledRouteSkill(
  bundledDir: string,
  inlineSkillMd?: string,
): Promise<EnsureBundledRouteResult> {
  return ensureBundledSkill(BUNDLED_ROUTE_SLUG, bundledDir, inlineSkillMd);
}

/** Install the bundled `@skillet/create` playbook that `/skillet create` loads. */
export async function ensureBundledCreateSkill(
  bundledDir: string,
  inlineSkillMd?: string,
): Promise<EnsureBundledRouteResult> {
  return ensureBundledSkill(BUNDLED_CREATE_SLUG, bundledDir, inlineSkillMd);
}
