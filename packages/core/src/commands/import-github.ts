/**
 * `skillet import owner/repo` — the remote GitHub source.
 *
 * Two phases, split so the CLI can put an interactive picker between them:
 *
 *   1. discoverGitHubSkills() — fetch the repo's tree, find every SKILL.md
 *      bundle, parse each one's name/description for the picker.
 *   2. importGitHubSkill()    — download the chosen bundle's files, validate
 *      against the §2.1 caps/path rules, hash, and write it into the local kit.
 *
 * Imports land in the local kit as `source: "local"` — unpublished and
 * self-trusted, i.e. PRIVATE BY DEFAULT. Nothing is pushed to the registry and
 * no signature is minted; publishing stays a separate, explicit `skillet publish`.
 *
 * v1 is public-repo-only and unauthenticated — see {@link GitHubSource}.
 */

import { basename } from "node:path";
import { mkdir } from "node:fs/promises";
import matter from "gray-matter";
import {
  canonicalContentHash,
  validateBundle,
  validateRequires,
  validateTriggers,
  MAX_BUNDLE_BYTES,
  slugify as canonicalSlugify,
  type DecodedBundle,
} from "@skillet/protocol";
import { assertSafeSlug } from "../util/pathsafe.js";
import { ImportCollisionError, type ImportSkillOptions } from "./import.js";
import { readState, writeBundleToSkillStore, upsertSkill, skillContentDir } from "../kit/store.js";
import { recordEvent, detectInitiator } from "../metrics.js";
import type { SkillEntry } from "../kit/types.js";
import {
  GitHubSource,
  type GitHubSourceOptions,
  type TreeBlob,
} from "../github/client.js";
import {
  parseGitHubRepoSpec,
  type GitHubRepoSpec,
} from "../github/spec.js";

const SKILL_ENTRYPOINT = "SKILL.md";

function slugify(name: string): string {
  return canonicalSlugify(name, { maxLength: 64 });
}

/** A SKILL.md bundle discovered in the repo tree, ready to be picked + imported. */
export interface DiscoveredGitHubSkill {
  /** POSIX dir containing the SKILL.md; "" for a skill at the repo root. */
  dir: string;
  name: string;
  description: string;
  /** Kit slug this skill will import as (unique within the discovery set). */
  slug: string;
  /** Blobs that belong to this skill (repo-root-relative paths). */
  files: TreeBlob[];
  /** Sum of file sizes reported by the tree API. */
  totalBytes: number;
}

export interface GitHubDiscovery {
  owner: string;
  repo: string;
  /** The ref actually used (resolved default branch when none was given). */
  ref: string;
  skills: DiscoveredGitHubSkill[];
  /** True when GitHub truncated the tree listing (very large repo). */
  truncated: boolean;
}

export interface DiscoverOptions extends GitHubSourceOptions {
  /** Override the spec's ref (and the repo default branch). */
  ref?: string;
  /** Inject a pre-built source (tests). Takes precedence over fetchImpl. */
  source?: GitHubSource;
}

function dirOf(skillMdPath: string): string {
  if (skillMdPath === SKILL_ENTRYPOINT) return "";
  // ".../SKILL.md" → strip the trailing "/SKILL.md"
  return skillMdPath.slice(0, skillMdPath.length - (SKILL_ENTRYPOINT.length + 1));
}

/** True if `child` is `dir` itself or lives underneath it. "" matches all. */
function isUnder(dir: string, child: string): boolean {
  if (dir === "") return true;
  return child === dir || child.startsWith(dir + "/");
}

/**
 * Assign a blob to the SKILL.md bundle that most closely contains it — the
 * deepest skill dir that is an ancestor. This is what makes nested skills work:
 * `pack/a/SKILL.md` and `pack/a/refs/x.md` belong to the same skill, but a
 * sibling `pack/b/SKILL.md` carves out its own bundle.
 */
function nearestSkillDir(blobPath: string, skillDirsDeepestFirst: string[]): string | null {
  for (const dir of skillDirsDeepestFirst) {
    if (isUnder(dir, blobPath)) return dir;
  }
  return null;
}

/** Ensure every discovered skill maps to a distinct kit slug. */
function disambiguate(slug: string, taken: Set<string>): string {
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n++;
  const out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

/**
 * Phase 1: list the repo tree, find every SKILL.md bundle, and parse each one's
 * frontmatter for the picker. Returns an empty `skills` array (not an error)
 * when the repo simply contains no skills.
 */
export async function discoverGitHubSkills(
  specOrString: string | GitHubRepoSpec,
  opts: DiscoverOptions = {},
): Promise<GitHubDiscovery> {
  const spec =
    typeof specOrString === "string"
      ? parseGitHubRepoSpec(specOrString)
      : specOrString;
  const source =
    opts.source ??
    new GitHubSource(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {});

  const meta = await source.getRepoMeta(spec.owner, spec.repo);
  const ref = opts.ref ?? spec.ref ?? meta.defaultBranch;

  const { blobs, truncated } = await source.listTree(spec.owner, spec.repo, ref);

  // All SKILL.md locations, scoped to the requested subdir if any.
  let skillDirs = blobs
    .filter((b) => b.path === SKILL_ENTRYPOINT || b.path.endsWith("/" + SKILL_ENTRYPOINT))
    .map((b) => dirOf(b.path));
  if (spec.subdir != null) {
    skillDirs = skillDirs.filter((d) => isUnder(spec.subdir as string, d));
  }
  // Deepest first so nearestSkillDir() resolves to the closest ancestor.
  const dirsDeepestFirst = [...new Set(skillDirs)].sort(
    (a, b) => b.length - a.length,
  );

  // Bucket every blob under its nearest skill dir.
  const buckets = new Map<string, TreeBlob[]>();
  for (const dir of dirsDeepestFirst) buckets.set(dir, []);
  for (const blob of blobs) {
    if (spec.subdir != null && !isUnder(spec.subdir, blob.path)) continue;
    const owner = nearestSkillDir(blob.path, dirsDeepestFirst);
    if (owner != null) buckets.get(owner)!.push(blob);
  }

  // Build a stable, shallowest-first listing with parsed metadata.
  const orderedDirs = [...buckets.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const takenSlugs = new Set<string>();
  const skills: DiscoveredGitHubSkill[] = [];
  for (const dir of orderedDirs) {
    const files = buckets.get(dir)!;
    const skillMdPath = dir === "" ? SKILL_ENTRYPOINT : `${dir}/${SKILL_ENTRYPOINT}`;
    let name = dir === "" ? spec.repo : basename(dir);
    let description = "";
    try {
      const bytes = await source.fetchBlob(spec.owner, spec.repo, ref, skillMdPath);
      const fm = matter(Buffer.from(bytes).toString("utf8")).data as Record<string, unknown>;
      if (typeof fm["name"] === "string" && fm["name"].trim()) name = fm["name"].trim();
      if (typeof fm["description"] === "string") description = fm["description"];
    } catch {
      // Couldn't read the entrypoint — keep the dir-derived name; import will
      // surface the real error if the user picks this one.
    }
    const slug = disambiguate(slugify(name), takenSlugs);
    skills.push({
      dir,
      name,
      description,
      slug,
      files,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    });
  }

  return { owner: spec.owner, repo: spec.repo, ref, skills, truncated };
}

export interface ImportGitHubOptions extends GitHubSourceOptions, ImportSkillOptions {
  source?: GitHubSource;
}

/**
 * Phase 2: download a discovered skill's files, validate, and write it into the
 * local kit (private by default). Returns the persisted {@link SkillEntry}.
 */
export async function importGitHubSkill(
  discovery: Pick<GitHubDiscovery, "owner" | "repo" | "ref">,
  skill: DiscoveredGitHubSkill,
  opts: ImportGitHubOptions = {},
): Promise<SkillEntry> {
  const source =
    opts.source ??
    new GitHubSource(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {});

  if (skill.totalBytes > MAX_BUNDLE_BYTES) {
    throw new Error(
      `Skill "${skill.name}" is ${skill.totalBytes} bytes; max bundle size is ${MAX_BUNDLE_BYTES}.`,
    );
  }

  // Download each file, re-rooting its path at the skill dir.
  const bundle: DecodedBundle = new Map();
  for (const file of skill.files) {
    const rel = skill.dir === "" ? file.path : file.path.slice(skill.dir.length + 1);
    if (rel.length === 0) continue;
    const bytes = await source.fetchBlob(discovery.owner, discovery.repo, discovery.ref, file.path);
    bundle.set(rel, bytes);
  }

  if (!bundle.has(SKILL_ENTRYPOINT)) {
    throw new Error(
      `Skill at "${skill.dir || "<root>"}" has no ${SKILL_ENTRYPOINT} after fetch — nothing to import.`,
    );
  }

  // §2.1 caps + path safety (mirrors the local-import path).
  validateBundle(bundle);

  const entrypoint = bundle.get(SKILL_ENTRYPOINT)!;
  const parsed = matter(Buffer.from(entrypoint).toString("utf8"));
  const fm = parsed.data as Record<string, unknown>;
  const rawName =
    typeof fm["name"] === "string" && fm["name"].trim() ? fm["name"].trim() : skill.name;
  const description =
    typeof fm["description"] === "string" ? fm["description"] : skill.description;

  validateRequires(fm["requires"]);
  validateTriggers(fm["triggers"]);

  assertSafeSlug(skill.slug);
  const state = await readState();
  if (state.skills[skill.slug] && !opts.force) {
    throw new ImportCollisionError(skill.slug);
  }

  const hash = canonicalContentHash(bundle);
  const now = new Date().toISOString();
  const subpath = skill.dir ? `#${skill.dir}` : "";
  const origin = `github:${discovery.owner}/${discovery.repo}@${discovery.ref}${subpath}`;

  await mkdir(skillContentDir(skill.slug), { recursive: true });
  await writeBundleToSkillStore(skill.slug, bundle);

  const entry: SkillEntry = {
    slug: skill.slug,
    name: rawName,
    description,
    version: 1,
    hash,
    source: "local",
    origin,
    importedAt: now,
    updatedAt: now,
  };

  await upsertSkill(entry);
  recordEvent("skill.import", detectInitiator(), { slug: skill.slug, origin: "github" });

  return entry;
}
