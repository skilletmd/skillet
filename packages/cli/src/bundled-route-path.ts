import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveBundledSkillDir(dirName: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const besideEntry = join(here, "bundled-skills", dirName);
  if (existsSync(besideEntry)) return besideEntry;
  return join(here, "..", "bundled-skills", dirName);
}

/** Absolute path to the bundled `@skillet/route` skill directory shipped with the CLI. */
export function resolveBundledRouteSkillDir(): string {
  return resolveBundledSkillDir("skillet-route");
}

/** Absolute path to the bundled `@skillet/create` playbook shipped with the CLI. */
export function resolveBundledCreateSkillDir(): string {
  return resolveBundledSkillDir("skillet-create");
}
