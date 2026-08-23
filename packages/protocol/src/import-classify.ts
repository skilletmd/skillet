// Repo-import classification — the shared, I/O-free rules that decide how a
// GitHub repo becomes skills. Both the web importer (packages/web) and the
// registry sync engine (packages/registry) call these so the two paths agree on
// what to exclude, what counts as coupled, and how a repo classifies. The fetch
// mechanics differ per path; the *decisions* live here, once.
//
// See docs/plans/repo-import-classification.md.

export type ImportMode = 'single' | 'kit' | 'unified';

// Segments we never discover skills under:
//  - build/output/dependency dirs (node_modules, dist, …) hold generated copies
//  - `in-progress`/`deprecated` are the conventional "not ready" and "retired"
//    holding pens. Authors park unfinished or removed skills there (e.g.
//    mattpocock/skills/in-progress/*), and mirroring them would seed drafts and
//    dead skills as if they were published. Excluding by convention keeps every
//    source's WIP out of the registry without a per-source config knob.
const EXCLUDED_DISCOVERY_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'vendor',
  'in-progress',
  'deprecated',
  // A repo's own test fixtures are not skills. EveryInc/compound-engineering-plugin
  // ships five under tests/fixtures/ ("skill-one", "default-skill", …) to exercise
  // its loader, and they were published under @every as if real; garrytan/gstack
  // has the same shape under test/fixtures/. Matching whole SEGMENTS is what keeps
  // this safe: flutter/agent-plugins' genuine `dart-add-unit-test` lives at
  // skills/dart-add-unit-test, whose segments are `skills` and the skill name, so
  // a skill ABOUT testing is untouched. `spec` is deliberately absent — a skill
  // legitimately named `spec` is plausible in a way `__tests__` is not.
  'test',
  'tests',
  '__tests__',
  'fixture',
  'fixtures',
  '__fixtures__',
  'e2e',
]);

/**
 * True for a path we exclude from discovery and from a unified bundle. Any
 * dot-prefixed segment (`.claude`, `.gemini`, `.codex-plugin`, `.github`, …) is
 * a tool-specific generated mirror or VCS/CI dir; the canonical skills live in
 * plain directories. Importing the mirrors would publish duplicates. See
 * EXCLUDED_DISCOVERY_SEGMENTS above for the non-dot dirs we also skip.
 */
export function isExcludedDiscoveryPath(path: string): boolean {
  return path
    .split('/')
    .some((seg) => seg.startsWith('.') || EXCLUDED_DISCOVERY_SEGMENTS.has(seg.toLowerCase()));
}

/**
 * A skill is "coupled" when its SKILL.md references a path outside its own
 * folder (a `../` segment) — it depends on a sibling skill or a shared dir, so
 * it only resolves when imported together with the rest of the repo.
 *
 * The negative lookbehind excludes an ellipsis (`.../`) — a prose/example
 * placeholder like `/tmp/.../<run-id>/`, whose trailing `../` is not a parent
 * reference. Without it, a single illustrative ellipsis anywhere in the markdown
 * mis-flags a self-contained skill as coupled and tips the whole repo to
 * `unified` import (blob), which is exactly what everyinc/compound-engineering's
 * ce-code-review did — its only `../` was `/tmp/.../ce-code-review/<run-id>/`.
 */
export function isCoupledSkillMarkdown(markdown: string): boolean {
  return /(?<!\.)\.\.\//.test(markdown);
}

/** A real `skills/x` dir is more canonical than a `plugins/<tool>/skills/x` mirror. */
export function isMoreCanonicalSkillDir(a: string, b: string): boolean {
  const aPlugin = a.includes('plugins/');
  const bPlugin = b.includes('plugins/');
  if (aPlugin !== bPlugin) return !aPlugin;
  return a.length < b.length || (a.length === b.length && a < b);
}

export interface ClassifiableSkill {
  dir: string;
  coupled: boolean;
}

export interface ImportClassification {
  mode: ImportMode;
  reason: string;
}

/**
 * Recommend how to import a discovered repo from its skills' dir + coupled flag.
 *
 * - `single`: one skill — just publish it.
 * - `unified`: many skills, at least one coupled (references `../`), so they only
 *   work together — import the whole repo as ONE skill so the shared paths
 *   resolve (no rewriting, no dependency graph).
 * - `kit`: many self-contained skills — publish each and bundle them in a kit.
 */
export function classifyImport(skills: ClassifiableSkill[]): ImportClassification {
  const n = skills.length;
  if (n <= 1) {
    return { mode: 'single', reason: n === 1 ? 'One skill in this repo.' : 'No skills found.' };
  }
  const coupled = skills.filter((s) => s.coupled).length;
  if (coupled > 0) {
    return {
      mode: 'unified',
      reason: `${coupled} of ${n} skills reference shared files (‘../’), so they only work together.`,
    };
  }
  return { mode: 'kit', reason: `${n} independent skills.` };
}

/**
 * Drop mirror copies: items whose content key (e.g. byte-identical SKILL.md) is
 * the same are the same skill re-emitted for another tool (e.g.
 * `plugins/<tool>/skills/x` mirroring `skills/x`). Keep the canonical one per
 * key; items with a null key (unreadable content) are always kept. Preserves
 * input order minus the dropped duplicates.
 */
export function dedupeMirrorsBy<T>(
  items: T[],
  dirOf: (item: T) => string,
  keyOf: (item: T) => string | null,
): T[] {
  const byKey = new Map<string, T>();
  const kept: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key) {
      kept.push(item);
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      kept.push(item);
    } else if (isMoreCanonicalSkillDir(dirOf(item), dirOf(existing))) {
      byKey.set(key, item);
      kept[kept.indexOf(existing)] = item;
    }
  }
  return kept;
}
