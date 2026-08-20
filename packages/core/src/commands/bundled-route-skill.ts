import matter from "gray-matter";
import { canonicalContentHash, validateBundle, type DecodedBundle } from "@skillet/protocol";
import { readBundleFromDir } from "../bundle/read.js";
import {
  readState,
  skillContentDir,
  upsertSkill,
  writeBundleToSkillStore,
} from "../kit/store.js";
import { BUNDLED_ROUTE_SLUG } from "./route.js";
import type { SkillEntry } from "../kit/types.js";

export type EnsureBundledRouteResult = "installed" | "updated" | "unchanged";

export { BUNDLED_ROUTE_SLUG };

/** Load the route bundle from disk, falling back to an inlined SKILL.md.
 *
 *  The pkg-compiled desktop sidecar has no `bundled-skills` on disk — pkg never
 *  snapshots `dist/bundled-skills` — so the disk read throws there. The CLI
 *  inlines the SKILL.md at bundle time and passes it as the fallback, so the
 *  route skill still materializes for desktop-only users. */
async function loadRouteBundle(
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

export async function ensureBundledRouteSkill(
  bundledDir: string,
  inlineSkillMd?: string,
): Promise<EnsureBundledRouteResult> {
  const bundle = await loadRouteBundle(bundledDir, inlineSkillMd);
  const hash = canonicalContentHash(bundle);
  const state = await readState();
  const existing = state.skills[BUNDLED_ROUTE_SLUG];
  if (existing?.hash === hash) {
    try {
      await readBundleFromDir(skillContentDir(BUNDLED_ROUTE_SLUG));
      return "unchanged";
    } catch {
      // Hash matches state but files missing — reinstall below.
    }
  }

  const entrypointBytes = bundle.get("SKILL.md");
  if (!entrypointBytes) {
    throw new Error("Bundled route skill is missing SKILL.md");
  }
  const parsed = matter(Buffer.from(entrypointBytes).toString("utf8"));
  const fm = parsed.data as Record<string, unknown>;
  const name = typeof fm["name"] === "string" ? fm["name"] : "skillet";
  const description =
    typeof fm["description"] === "string" ? fm["description"] : "";

  await writeBundleToSkillStore(BUNDLED_ROUTE_SLUG, bundle);

  const now = new Date().toISOString();
  const entry: SkillEntry = {
    slug: BUNDLED_ROUTE_SLUG,
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
