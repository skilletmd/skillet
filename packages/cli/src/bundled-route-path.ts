import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the bundled `@skillet/route` skill directory shipped with the CLI. */
export function resolveBundledRouteSkillDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const besideEntry = join(here, "bundled-skills", "skillet-route");
  if (existsSync(besideEntry)) return besideEntry;
  return join(here, "..", "bundled-skills", "skillet-route");
}
