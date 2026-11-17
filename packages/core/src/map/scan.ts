/**
 * The kit map's scan (plan U3, KTD2; R4 R5 R6 R7 R9 R15).
 *
 * One call returns every skill on this computer: the skills folders of the
 * detected tools, `~/.codex/skills`, and the skills that came inside Claude
 * Code and Codex plugins. Each folder is labeled by who owns it (the folder
 * rules in ./folder-rules.ts), identical copies merge into one entry by
 * content key with every path and tool kept, and every place the scan could
 * not check lands in the unreadable list.
 *
 * Read-only (R5, AE4). The only filesystem calls are lstat, stat, realpath,
 * readdir and readFile, and nothing goes over the network. Folders are found
 * one at a time, in order; then the skills in them are read a few at once,
 * and everything they give lands in the order they were found. A folder that
 * resolves into ~/Documents, ~/Desktop or ~/Downloads is read only when this
 * process already has access (util/tcc-access.ts); otherwise reading it would
 * bring up a macOS prompt before the person has seen anything, so it is named
 * in the unreadable list instead. The scan never probes or records a grant.
 *
 * The content key (KTD15) is `canonicalContentHash` over a bundle of the
 * skill's regular files: the folder is walked without following links, every
 * name that starts with a dot is skipped along with everything inside a
 * dot-folder (`.DS_Store`, `.git`), and so are Skillet's own `*.skillet-backup`
 * files. A link inside the folder is never part of the key, with one
 * exception: when SKILL.md itself is a link, its target's bytes are keyed as
 * SKILL.md, so two such skills can't collide on an empty key.
 */
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import matter from "gray-matter";
import {
  MAX_BUNDLE_BYTES,
  MAX_INSTRUCTION_BYTES,
  SKILL_ENTRYPOINT,
  canonicalContentHash,
  instructionClosureBytes,
  isSkilletBackupPath,
  type DecodedBundle,
} from "@skillet/protocol";
import { classifyJob, type JobId } from "@skillet/protocol/jobs";
import type { Adapter } from "../adapter.js";
import { loadIdentity } from "../identity/index.js";
import { mapInOrder } from "../util/in-order.js";
import { isPathWithin } from "../util/pathsafe.js";
import { describeTccRoot, detectTccInvocation, isTccParkedPath } from "../util/tcc-access.js";
import {
  CONTAINER_SEARCH_DEPTH,
  UNIVERSAL_SKILLS_READERS,
  dominantSource,
  isSkippedName,
  ruleForContainer,
  ruleForSkillFolder,
  skilletSourceFor,
  type MapOwner,
  type MapRootKind,
  type MapSource,
  type MapUnreadable,
  type MapUnreadableReason,
} from "./folder-rules.js";
import {
  errCode,
  isMissingError,
  readClaudePluginSources,
  readCodexPluginSources,
  reasonForError,
  type PluginSkillsSource,
} from "./plugin-sources.js";
import { SAFE_MATTER } from "./safe-matter.js";
import { entryKind } from "./skill-fs.js";

/** Why a skill can't be backed up. */
export type MapBackupBlock = "links-outside" | "over-25-mb" | "instructions-over-1-mb" | "git-folder";
/** Why a skill can't be merged. */
export type MapMergeBlock = "links-outside" | "extra-files";

const BACKUP_BLOCKS: readonly MapBackupBlock[] = [
  "links-outside",
  "over-25-mb",
  "instructions-over-1-mb",
  "git-folder",
];
const MERGE_BLOCKS: readonly MapMergeBlock[] = ["links-outside", "extra-files"];

export interface MapFlags {
  /** Empty when nothing the scan can see stops a backup. Secrets are checked later, by the registry. */
  cantBackUp: MapBackupBlock[];
  /** Empty when the skill is a lone SKILL.md with no links out. */
  cantMerge: MapMergeBlock[];
}

/** One folder a skill was found in. */
export interface MapScanLocation {
  /** The folder as its tools see it; a link when the skill is linked in. */
  path: string;
  tools: string[];
  source: MapSource;
  owner: MapOwner | null;
  /** Where `path` points when it is a link, else null. */
  linkTarget: string | null;
  /** Skillet's own layouts: the maker's handle (null for `_local--`) and the slug. */
  skillet: { maker: string | null; slug: string } | null;
}

export interface MapScanEntry {
  /** `sha256:` canonical content hash over the skill's regular files. */
  key: string;
  name: string;
  description: string;
  /** The strongest owner among the copies (MAP_SOURCE_PRECEDENCE). */
  source: MapSource;
  /** The plugin (with its on/off state), organization or app behind `source`. */
  owner: MapOwner | null;
  tools: string[];
  /** How many copies each tool loads. */
  copies: Record<string, number>;
  /** Every folder it was found in, with the tools that load each. */
  locations: MapScanLocation[];
  /** The job it does, or null for "Not sorted". */
  jobId: JobId | null;
  /** Every reason any copy has. */
  flags: MapFlags;
}

/** A folder the scan read. */
export interface MapScannedFolder {
  path: string;
  tools: string[];
}

export interface MapScanResult {
  entries: MapScanEntry[];
  /** The tools scanned: every detected tool whose skills folder the scan looked for, plus any tool whose folders it read. */
  tools: string[];
  /** Every folder the scan read (R15). */
  folders: MapScannedFolder[];
  /** Every place it couldn't check, and why (R15). */
  unreadable: MapUnreadable[];
  /** When the scan started (ISO 8601). */
  scannedAt: string;
  durationMs: number;
}

export interface MapScanOptions {
  /**
   * Every runtime adapter the caller knows: the CLI's ALL_ADAPTERS plus its
   * baseline readers (opencode). Global adapters that detect give their skills
   * folder; project adapters are only detected, for the tools that load
   * `~/.agents/skills` (Cursor).
   */
  adapters: readonly Adapter[];
  /** Defaults to the current home directory. */
  home?: string;
  /**
   * The person's Skillet handle, which tells their own published skills from
   * other makers'. Undefined reads the local identity file; null means none.
   */
  handle?: string | null;
}

interface SkillsRoot {
  path: string;
  tools: string[];
  kind: MapRootKind;
  /** Came from a detected adapter, so its tools count as scanned even when the folder is missing. */
  detected: boolean;
}

interface OpenedFolder {
  real: string;
  isLink: boolean;
  entries: Dirent[];
  holdsSkill: boolean;
}

interface Candidate {
  path: string;
  folder: OpenedFolder;
  tools: string[];
  source: MapSource;
  owner: MapOwner | null;
  skillet: MapScanLocation["skillet"];
  /** The folder's slug: what the name falls back to and the job classifier reads. */
  slug: string;
  plugin?: string;
}

interface ReadSkill {
  candidate: Candidate;
  key: string;
  name: string;
  description: string;
  body: string;
  cantBackUp: Set<MapBackupBlock>;
  cantMerge: Set<MapMergeBlock>;
}

/** How many skills are read at once. */
const READS_AT_ONCE = 8;

interface ScanState {
  candidates: Candidate[];
  folders: MapScannedFolder[];
  unreadable: MapUnreadable[];
  tools: string[];
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function noteTools(state: ScanState, tools: readonly string[]): void {
  for (const tool of tools) if (!state.tools.includes(tool)) state.tools.push(tool);
}

function unreadableRow(
  path: string,
  reason: MapUnreadableReason,
  tools: readonly string[],
  plugin?: string,
  detail?: string,
): MapUnreadable {
  return {
    path,
    reason,
    tools: [...tools],
    ...(plugin !== undefined ? { plugin } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
}

/**
 * Why `path` can't be read without a macOS prompt, or null when it can. A
 * grant this context already earned admits the read, unless the run is one
 * Skillet never lets read protected folders (no terminal and no flag).
 */
function promptBlock(path: string): MapUnreadableReason | null {
  const described = describeTccRoot(path, detectTccInvocation().context);
  if (!described.protected) return null;
  if (described.grant === "active" && !isTccParkedPath(path)) return null;
  return "protected-folder";
}

function mayBeFolder(entry: Dirent): boolean {
  return entry.isDirectory() || entry.isSymbolicLink();
}

/**
 * Resolve `path` (following a link), check it can be read without a prompt,
 * and list it. Null when it isn't a folder, is gone, or can't be read; the
 * last two are added to the unreadable list, except a plain missing folder.
 */
async function openFolder(
  path: string,
  tools: readonly string[],
  state: ScanState,
  plugin?: string,
): Promise<OpenedFolder | null> {
  const fail = (reason: MapUnreadableReason, detail?: string): null => {
    state.unreadable.push(unreadableRow(path, reason, tools, plugin, detail));
    return null;
  };
  let info;
  try {
    info = await lstat(path);
  } catch (err) {
    return isMissingError(err) ? null : fail(reasonForError(err), errCode(err));
  }
  const isLink = info.isSymbolicLink();
  let real: string;
  try {
    real = await realpath(path);
    if (isLink) info = await stat(real);
  } catch (err) {
    if (isLink) return fail("broken-link");
    return isMissingError(err) ? null : fail(reasonForError(err), errCode(err));
  }
  if (!info.isDirectory()) return null;
  const blocked = promptBlock(real);
  if (blocked) return fail(blocked, isLink ? real : undefined);
  let entries: Dirent[];
  try {
    entries = await readdir(real, { withFileTypes: true });
  } catch (err) {
    return fail(reasonForError(err), errCode(err));
  }
  entries.sort((a, b) => compareNames(a.name, b.name));
  const holdsSkill = entries.some(
    (e) => e.name === SKILL_ENTRYPOINT && (e.isFile() || e.isSymbolicLink()),
  );
  return { real, isLink, entries, holdsSkill };
}

function targetDirOf(adapter: Adapter): string | null {
  try {
    return adapter.targetDir;
  } catch {
    return null;
  }
}

async function detectedNames(adapters: readonly Adapter[]): Promise<Set<string>> {
  const detected = new Set<string>();
  for (const adapter of adapters) {
    try {
      if (await adapter.detect()) detected.add(adapter.name);
    } catch {
      // A detect that throws is a tool that isn't there.
    }
  }
  return detected;
}

/** The skills folders to read, one per real folder, each with every tool that loads it. */
function skillsRoots(
  adapters: readonly Adapter[],
  detected: ReadonlySet<string>,
  home: string,
): SkillsRoot[] {
  const universal = join(home, ".agents", "skills");
  const legacyCodex = join(home, ".codex", "skills");
  const roots: SkillsRoot[] = [];
  const add = (path: string, tool: string, fromDetection: boolean): void => {
    const at = resolve(path);
    let root = roots.find((r) => resolve(r.path) === at);
    if (!root) {
      const kind: MapRootKind =
        at === resolve(universal) ? "universal" : at === resolve(legacyCodex) ? "codex" : "other";
      root = { path, tools: [], kind, detected: false };
      roots.push(root);
    }
    if (!root.tools.includes(tool)) root.tools.push(tool);
    if (tool === "claude-code") root.kind = "claude";
    root.detected ||= fromDetection;
  };
  for (const adapter of adapters) {
    if (!detected.has(adapter.name)) continue;
    if (adapter.kind === "project") {
      // A project adapter's own folder stays out, but Cursor loads ~/.agents/skills too.
      if (UNIVERSAL_SKILLS_READERS.includes(adapter.name)) add(universal, adapter.name, true);
      continue;
    }
    const dir = targetDirOf(adapter);
    if (dir) add(dir, adapter.name, true);
  }
  // Codex still loads its old folder.
  add(legacyCodex, "codex", false);
  return roots;
}

/** Find the skill folders below an app or `synced/` folder, `depth` levels down at most. */
async function searchContainer(
  folder: OpenedFolder,
  path: string,
  parts: readonly string[],
  depth: number,
  tools: readonly string[],
  state: ScanState,
  found: (path: string, skill: OpenedFolder, parts: string[]) => void,
): Promise<void> {
  if (depth <= 0) return;
  for (const entry of folder.entries) {
    if (isSkippedName(entry.name) || !mayBeFolder(entry)) continue;
    const childPath = join(path, entry.name);
    const child = await openFolder(childPath, tools, state);
    if (!child) continue;
    const childParts = [...parts, entry.name];
    if (child.holdsSkill) found(childPath, child, childParts);
    else await searchContainer(child, childPath, childParts, depth - 1, tools, state, found);
  }
}

async function scanRoot(root: SkillsRoot, handle: string | null, state: ScanState): Promise<void> {
  const folder = await openFolder(root.path, root.tools, state);
  if (!folder) return;
  state.folders.push({ path: root.path, tools: [...root.tools] });
  noteTools(state, root.tools);
  const tools = root.tools;

  for (const entry of folder.entries) {
    if (isSkippedName(entry.name) || !mayBeFolder(entry)) continue;
    const path = join(root.path, entry.name);
    const child = await openFolder(path, tools, state);
    if (!child) continue;

    if (child.holdsSkill) {
      const rule = ruleForSkillFolder(entry.name, handle);
      state.candidates.push({
        path,
        folder: child,
        tools,
        source: rule.source,
        owner: null,
        skillet: rule.source === "local" ? null : { maker: rule.maker, slug: rule.slug },
        slug: rule.slug,
      });
      continue;
    }

    const container = ruleForContainer(root.kind, entry.name);
    if (container.kind === "maker") {
      // Skillet's `@owner/<slug>/` layout.
      for (const inner of child.entries) {
        if (isSkippedName(inner.name) || !mayBeFolder(inner)) continue;
        const skillPath = join(path, inner.name);
        const skill = await openFolder(skillPath, tools, state);
        if (!skill?.holdsSkill) continue;
        state.candidates.push({
          path: skillPath,
          folder: skill,
          tools,
          source: skilletSourceFor(container.maker, handle),
          owner: null,
          skillet: { maker: container.maker, slug: inner.name },
          slug: inner.name,
        });
      }
      continue;
    }

    await searchContainer(child, path, [], CONTAINER_SEARCH_DEPTH, tools, state, (skillPath, skill, parts) => {
      const slug = parts[parts.length - 1]!;
      const owner: MapOwner | null =
        container.kind === "synced"
          ? parts.length >= 2
            ? { kind: "organization", name: parts[0]! }
            : null
          : { kind: "app", name: container.app, folder: path };
      state.candidates.push({
        path: skillPath,
        folder: skill,
        tools,
        source: container.kind === "synced" ? "synced" : "app",
        owner,
        skillet: null,
        slug,
      });
    });
  }
}

async function scanPluginSource(source: PluginSkillsSource, state: ScanState): Promise<void> {
  const tools = [source.tool];
  const plugin = source.owner.marketplace
    ? `${source.owner.name}@${source.owner.marketplace}`
    : source.owner.name;
  const folder = await openFolder(source.skillsDir, tools, state, plugin);
  if (!folder) return;
  state.folders.push({ path: source.skillsDir, tools: [...tools] });
  noteTools(state, tools);
  for (const entry of folder.entries) {
    if (isSkippedName(entry.name) || !mayBeFolder(entry)) continue;
    const skillPath = join(source.skillsDir, entry.name);
    const skill = await openFolder(skillPath, tools, state, plugin);
    if (!skill?.holdsSkill) continue;
    state.candidates.push({
      path: skillPath,
      folder: skill,
      tools,
      source: "plugin",
      owner: { ...source.owner },
      skillet: null,
      slug: entry.name,
      plugin,
    });
  }
}

class UnreadableSkill extends Error {
  constructor(
    readonly reason: MapUnreadableReason,
    readonly detail?: string,
  ) {
    super(reason);
  }
}

interface SkillContents {
  files: DecodedBundle;
  totalBytes: number;
  linksOutside: boolean;
  linksInside: boolean;
  hasGit: boolean;
}

async function readLinkedEntrypoint(target: string | null, out: SkillContents): Promise<void> {
  if (target === null) throw new UnreadableSkill("broken-link");
  const blocked = promptBlock(target);
  if (blocked) throw new UnreadableSkill(blocked, target);
  if (!(await stat(target)).isFile()) throw new UnreadableSkill("unreadable", target);
  const bytes = await readFile(target);
  out.files.set(SKILL_ENTRYPOINT, bytes);
  out.totalBytes += bytes.byteLength;
}

/** Walk a skill folder by the key's file rule (see the module comment). */
async function walkSkill(
  root: string,
  dir: string,
  rel: string,
  listed: Dirent[] | null,
  out: SkillContents,
): Promise<void> {
  const entries = listed ?? (await readdir(dir, { withFileTypes: true }));
  for (const entry of entries) {
    const name = entry.name;
    if (name === ".git") {
      out.hasGit = true;
      continue;
    }
    if (name.startsWith(".") || isSkilletBackupPath(name)) continue;
    const abs = join(dir, name);
    const relPath = rel === "" ? name : `${rel}/${name}`;
    const info = await entryKind(entry, abs);
    if (info.isSymbolicLink()) {
      const target = await realpath(abs).catch(() => null);
      if (target !== null && isPathWithin(target, root)) out.linksInside = true;
      else out.linksOutside = true;
      if (relPath === SKILL_ENTRYPOINT) await readLinkedEntrypoint(target, out);
      continue;
    }
    if (info.isDirectory()) {
      await walkSkill(root, abs, relPath, null, out);
      continue;
    }
    if (!info.isFile()) continue;
    const bytes = await readFile(abs);
    out.files.set(relPath, bytes);
    out.totalBytes += bytes.byteLength;
  }
}

function readFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  try {
    const parsed = matter(text, SAFE_MATTER);
    return { data: (parsed.data ?? {}) as Record<string, unknown>, body: parsed.content };
  } catch {
    return { data: {}, body: text };
  }
}

/** One candidate read: the skill, or the row saying why it couldn't be. */
type CandidateRead = { skill: ReadSkill } | { unreadable: MapUnreadable };

async function readCandidate(candidate: Candidate): Promise<CandidateRead> {
  const contents: SkillContents = {
    files: new Map(),
    totalBytes: 0,
    linksOutside: false,
    linksInside: false,
    hasGit: false,
  };
  const fail = (reason: MapUnreadableReason, detail?: string): CandidateRead => ({
    unreadable: unreadableRow(candidate.path, reason, candidate.tools, candidate.plugin, detail),
  });
  try {
    const { folder } = candidate;
    await walkSkill(folder.real, folder.real, "", folder.entries, contents);
  } catch (err) {
    if (err instanceof UnreadableSkill) return fail(err.reason, err.detail);
    return fail(reasonForError(err), errCode(err));
  }
  const entrypoint = contents.files.get(SKILL_ENTRYPOINT);
  // A SKILL.md that is a folder, or a link to one.
  if (!entrypoint) return fail("unreadable");

  const key = canonicalContentHash(contents.files);
  let instructionBytes: number;
  try {
    instructionBytes = instructionClosureBytes(contents.files);
  } catch {
    // A required_reading the bundle can't satisfy: count SKILL.md alone.
    instructionBytes = entrypoint.byteLength;
  }

  const cantBackUp = new Set<MapBackupBlock>();
  if (contents.linksOutside) cantBackUp.add("links-outside");
  if (contents.totalBytes > MAX_BUNDLE_BYTES) cantBackUp.add("over-25-mb");
  if (instructionBytes > MAX_INSTRUCTION_BYTES) cantBackUp.add("instructions-over-1-mb");
  if (contents.hasGit) cantBackUp.add("git-folder");
  const cantMerge = new Set<MapMergeBlock>();
  if (contents.linksOutside) cantMerge.add("links-outside");
  if (contents.files.size > 1 || contents.linksInside) cantMerge.add("extra-files");

  const { data, body } = readFrontmatter(Buffer.from(entrypoint).toString("utf8"));
  const rawName = typeof data["name"] === "string" ? data["name"].trim() : "";
  const description = typeof data["description"] === "string" ? data["description"].trim() : "";
  return {
    skill: {
      candidate,
      key,
      name: rawName.length > 0 ? rawName : candidate.slug,
      description,
      body,
      cantBackUp,
      cantMerge,
    },
  };
}

function buildEntry(copies: ReadSkill[]): MapScanEntry {
  const locations: MapScanLocation[] = copies.map(({ candidate }) => ({
    path: candidate.path,
    tools: [...candidate.tools],
    source: candidate.source,
    owner: candidate.owner,
    linkTarget: candidate.folder.isLink ? candidate.folder.real : null,
    skillet: candidate.skillet,
  }));
  const source = dominantSource(locations.map((l) => l.source));
  const lead = copies.find((c) => c.candidate.source === source)!;

  const tools: string[] = [];
  const counts: Record<string, number> = {};
  for (const location of locations) {
    for (const tool of location.tools) {
      if (!tools.includes(tool)) tools.push(tool);
      counts[tool] = (counts[tool] ?? 0) + 1;
    }
  }

  const cantBackUp = BACKUP_BLOCKS.filter((block) => copies.some((c) => c.cantBackUp.has(block)));
  const cantMerge = MERGE_BLOCKS.filter((block) => copies.some((c) => c.cantMerge.has(block)));
  return {
    key: lead.key,
    name: lead.name,
    description: lead.description,
    source,
    owner: lead.candidate.owner,
    tools,
    copies: counts,
    locations,
    jobId: classifyJob({
      slug: lead.candidate.slug,
      name: lead.name,
      description: lead.description,
      body: lead.body,
    }),
    flags: { cantBackUp, cantMerge },
  };
}

async function localHandle(): Promise<string | null> {
  try {
    const identity = await loadIdentity();
    return typeof identity?.handle === "string" && identity.handle.length > 0 ? identity.handle : null;
  } catch {
    return null;
  }
}

/** Every skill on this computer, read-only (see the module comment). */
export async function scanMap(opts: MapScanOptions): Promise<MapScanResult> {
  const started = Date.now();
  const home = opts.home ?? homedir();
  const handle = opts.handle !== undefined ? opts.handle : await localHandle();
  const state: ScanState = { candidates: [], folders: [], unreadable: [], tools: [] };

  const detected = await detectedNames(opts.adapters);
  const roots = skillsRoots(opts.adapters, detected, home);
  for (const root of roots) if (root.detected) noteTools(state, root.tools);
  for (const root of roots) await scanRoot(root, handle, state);

  // Claude Code keeps plugins beside its skills folder, so follow CLAUDE_CONFIG_DIR with it.
  const claude = opts.adapters.find((a) => a.name === "claude-code" && a.kind !== "project");
  const claudeSkills = claude ? targetDirOf(claude) : null;
  const claudeDir = claudeSkills ? dirname(claudeSkills) : join(home, ".claude");
  for (const plugins of [
    await readClaudePluginSources({ claudeDir, gate: promptBlock }),
    await readCodexPluginSources({ codexDir: join(home, ".codex"), gate: promptBlock }),
  ]) {
    state.unreadable.push(...plugins.unreadable);
    for (const source of plugins.sources) await scanPluginSource(source, state);
  }

  // A few at once, each result taken in the order its folder was found, so
  // entries, their copies and the unreadable rows come out as they would one by one.
  const reads = await mapInOrder(state.candidates, READS_AT_ONCE, readCandidate);
  const byKey = new Map<string, ReadSkill[]>();
  for (const read of reads) {
    if ("unreadable" in read) {
      state.unreadable.push(read.unreadable);
      continue;
    }
    const { skill } = read;
    const copies = byKey.get(skill.key);
    if (copies) copies.push(skill);
    else byKey.set(skill.key, [skill]);
  }
  const entries = [...byKey.values()]
    .map(buildEntry)
    .sort((a, b) => compareNames(a.name.toLowerCase(), b.name.toLowerCase()) || compareNames(a.key, b.key));

  return {
    entries,
    tools: state.tools,
    folders: state.folders,
    unreadable: state.unreadable,
    scannedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
  };
}
