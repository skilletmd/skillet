/**
 * The kit map's folder rules (plan: the Folder rules table; KTD2).
 *
 * Every folder the map scan reads gets one row, and the row decides what a
 * skill found there is: its source, what Remove may do to it, and whether it
 * backs up. This module is the name logic behind the table, with no
 * filesystem access; `./scan.ts` walks the folders and asks it what it found.
 * Which sources Remove acts on and a merge is written from is the protocol's
 * (`isRemovableSource`, `isMergeableSource` in `@skillet/protocol/kit-map`),
 * which `./apply.ts` and `./merge-run.ts` follow; Save backs up `local` only.
 *
 *   Folder                                         Source            Remove does                Backed up
 *   <skills>/<name>/                               local             trash                      yes
 *   <skills>/_local--<slug>/                       skillet-imported  leaves the kit store       no
 *   <skills>/<owner>--<slug>/, <skills>/@owner/<slug>/
 *                                                  skillet-added     existing kit removal       no
 *   <skills>/<you>--<slug>/                        skillet-own       names the skill's page     no
 *   ~/.claude/skills/synced/<org>/<name>/          synced            names the organization     no
 *   <skills>/<app>/.../<name>/ (no SKILL.md above) app               names the folder           no
 *   a Claude Code or Codex plugin's skills         plugin            names the plugin           no
 *   dot-folders anywhere, Skillet's router skill   not shown
 *
 * `<skills>` is any tool's skills folder. Skillet materializes its layouts
 * into every tool, so those rows apply everywhere; `synced/` is Claude Code's
 * own organization sync, so it only means that inside Claude Code's folder.
 */
import type { KitMapSource } from "@skillet/protocol/kit-map";
import { fromSlugDir } from "@skillet/protocol/skill-id";

/** Who a skill on the map belongs to: the protocol's sources, as the folder rules assign them. */
export type MapSource = KitMapSource;

/**
 * When identical copies of one skill sit in folders with different sources,
 * the entry takes the first of these that any copy has: an owner outside the
 * person (a plugin, an organization, an app) first, then Skillet, then a loose
 * copy. A plugin skill copied into a skills folder is still the plugin's.
 */
export const MAP_SOURCE_PRECEDENCE: readonly MapSource[] = Object.freeze([
  "plugin",
  "synced",
  "app",
  "skillet-own",
  "skillet-added",
  "skillet-imported",
  "local",
]);

export function dominantSource(sources: Iterable<MapSource>): MapSource {
  let best = MAP_SOURCE_PRECEDENCE.length - 1;
  for (const source of sources) {
    best = Math.min(best, MAP_SOURCE_PRECEDENCE.indexOf(source));
  }
  return MAP_SOURCE_PRECEDENCE[best]!;
}

/** Whose skills folder a root is. Only Claude Code's has `synced/`. */
export type MapRootKind = "claude" | "universal" | "codex" | "other";

/** The tools that load `~/.agents/skills`, whichever of them are detected. */
export const UNIVERSAL_SKILLS_READERS: readonly string[] = Object.freeze([
  "codex",
  "opencode",
  "cursor",
]);

/**
 * How many folders below an app or `synced/` folder the scan looks for skills
 * (`synced/<org>/<name>` and `<app>/skills/<name>` are two).
 */
export const CONTAINER_SEARCH_DEPTH = 3;

function isRouterSkillName(name: string): boolean {
  const parsed = fromSlugDir(name);
  return parsed !== null && parsed.owner === "skillet" && parsed.slug === "route";
}

/** Dot-folders anywhere (`.trash`, `.git`, `.system`) and Skillet's router skill are never shown. */
export function isSkippedName(name: string): boolean {
  return name.startsWith(".") || isRouterSkillName(name);
}

// What `bundleSlugDir` accepts as an owner, after its optional `@`.
const MAKER_RE = /^[a-z0-9-]{1,40}$/;

function cleanHandle(handle: string): string {
  const trimmed = handle.trim().toLowerCase();
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

export type SkilletSource = "skillet-added" | "skillet-own";

/** A Skillet-layout skill is the person's own when its maker is their handle. */
export function skilletSourceFor(maker: string, handle: string | null): SkilletSource {
  return handle !== null && cleanHandle(handle) === cleanHandle(maker)
    ? "skillet-own"
    : "skillet-added";
}

export interface SkillFolderRule {
  source: "local" | "skillet-imported" | SkilletSource;
  /** The skill's slug: the folder name, less Skillet's prefix. */
  slug: string;
  /** The maker's handle in Skillet's `owner--slug` layout, else null. */
  maker: string | null;
}

/** A folder directly inside a tool's skills folder that holds a SKILL.md. */
export function ruleForSkillFolder(name: string, handle: string | null): SkillFolderRule {
  const parsed = fromSlugDir(name);
  if (parsed !== null) {
    if (parsed.owner === null) {
      return { source: "skillet-imported", slug: parsed.slug, maker: null };
    }
    if (MAKER_RE.test(parsed.owner)) {
      return { source: skilletSourceFor(parsed.owner, handle), slug: parsed.slug, maker: parsed.owner };
    }
  }
  return { source: "local", slug: name, maker: null };
}

export type ContainerRule =
  | { kind: "synced" }
  | { kind: "maker"; maker: string }
  | { kind: "app"; app: string };

/** A folder directly inside a tool's skills folder with no SKILL.md of its own. */
export function ruleForContainer(rootKind: MapRootKind, name: string): ContainerRule {
  if (rootKind === "claude" && name === "synced") return { kind: "synced" };
  if (name.startsWith("@") && MAKER_RE.test(name.slice(1))) {
    return { kind: "maker", maker: name.slice(1) };
  }
  return { kind: "app", app: name };
}

export interface MapPluginOwner {
  kind: "plugin";
  name: string;
  marketplace: string | null;
  /** On or off in the tool's settings; null when the settings don't say. */
  enabled: boolean | null;
}

export interface MapOrganizationOwner {
  kind: "organization";
  name: string;
}

export interface MapAppOwner {
  kind: "app";
  name: string;
  /** The folder the app put its skills in, which Remove names. */
  folder: string;
}

export type MapOwner = MapPluginOwner | MapOrganizationOwner | MapAppOwner;

export type MapUnreadableReason =
  /** In ~/Documents, ~/Desktop or ~/Downloads, and reading it would bring up a macOS prompt. */
  | "protected-folder"
  | "permission-denied"
  /** A link whose target is gone. */
  | "broken-link"
  /** A Claude Code plugin installed for one project, which the scan doesn't open. */
  | "project-plugin"
  /** A plugin the tool lists whose files aren't on disk. */
  | "plugin-missing"
  /** A settings or plugin file the scan couldn't make sense of. */
  | "unparseable"
  | "unreadable";

/** One place the scan couldn't check (R15). */
export interface MapUnreadable {
  path: string;
  reason: MapUnreadableReason;
  /** The tools that load what's there. */
  tools: string[];
  /** For plugin rows: the plugin's `<name>@<marketplace>`. */
  plugin?: string;
  /** A link's target, a plugin's scope, or the error code. */
  detail?: string;
}
