import type { SkillEntry } from "@skillet/core";
import { skillContentPath } from "@skillet/core";

export interface ListJsonSkill {
  slug: string;
  name: string;
  description: string;
  owner: string | null;
  version: number;
  versionLabel: string | null;
  source: SkillEntry["source"];
  sourceClass: SkillEntry["sourceClass"] | null;
  sourceKit: string | null;
  category: string | null;
  token_count?: number;
  token_ambient?: number;
  token_method?: string;
  synced: boolean;
  pinned: boolean;
  local: boolean;
  /** Absolute path to this skill's SKILL.md on disk — the desktop shows it
   *  (shortened) and opens it so you can read a skill before uploading. */
  path: string;
  body: string;
}

/** Per-skill mapping for `skillet list --json` (the desktop app's read contract). */
export function toListJsonSkill(
  s: SkillEntry,
  opts: { local: boolean; body: string },
): ListJsonSkill {
  return {
    slug: s.slug,
    name: s.name,
    description: s.description,
    owner: s.owner ?? null,
    version: s.version,
    versionLabel: s.versionLabel ?? null,
    source: s.source,
    sourceClass: s.sourceClass ?? null,
    sourceKit: s.sourceKit ?? null,
    category: s.category ?? null,
    ...(typeof s.tokenCount === "number" ? { token_count: s.tokenCount } : {}),
    ...(typeof s.tokenAmbient === "number" ? { token_ambient: s.tokenAmbient } : {}),
    ...(typeof s.tokenMethod === "string" ? { token_method: s.tokenMethod } : {}),
    synced: typeof s.sourceKit === "string" && s.sourceKit.length > 0,
    pinned: s.pinned === true,
    local: opts.local,
    path: skillContentPath(s.slug),
    body: opts.body,
  };
}
