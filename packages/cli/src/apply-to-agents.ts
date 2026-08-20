import {
  materializeSkills,
  loadRegistryBearer,
  type MaterializeSkillsResult,
} from "@skillet/core";
import { resolveSyncAdapters } from "./adapter-tiers.js";
import { REGISTRY_DEFAULT } from "./cli-context.js";

/**
 * Scoped "put these skills into the agents on this machine" — the shared tail
 * of every surface that finishes its own job (home-menu review, `approve`,
 * `import`). Bearer + adapter resolution + quiet scoped materialize; callers
 * keep their own success copy and pass only what differs.
 */
export async function applyToAgents(
  slugs: string[],
  extra: { allowQuarantinedSlugs?: string[]; skipPull?: boolean } = {},
): Promise<MaterializeSkillsResult> {
  const bearer = await loadRegistryBearer();
  const { adapters, baselineNames } = await resolveSyncAdapters(process.cwd());
  const result = await materializeSkills(process.cwd(), adapters, {
    slugs,
    token: bearer.token || undefined,
    registryUrl: REGISTRY_DEFAULT,
    baselineAdapterNames: baselineNames,
    quietSkipLines: true,
    ...extra,
  });
  // Core reports per-skill failures as data, not throws. A caller about to
  // print "applied" must not do so over an integrity or write failure —
  // surface those here, centrally. Quarantine skips stay non-throwing: they
  // are an expected gate outcome with their own messaging.
  const blocking = result.failed.filter((f) => !f.reason.startsWith("quarantined"));
  if (blocking.length > 0) {
    const first = blocking[0]!;
    throw new Error(
      blocking.length === 1
        ? `Could not apply "${first.slug}": ${first.reason}`
        : `Could not apply ${blocking.length} skills (first: "${first.slug}": ${first.reason})`,
    );
  }
  return result;
}
