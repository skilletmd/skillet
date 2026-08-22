// Detector-inventory builder (U1 of the /lab scanner-vocabulary audit).
//
// The scanner's user-facing COPY lives in the web package (`scan-taxonomy.ts`);
// the DETECTORS that produce the categories + `why` tags that copy describes
// live here in the registry. Web can't import registry internals, so this
// builder distills the detectors' declared vocabulary into a small, committed
// JSON manifest (`packages/web/src/lib/scan-detector-inventory.json`) that the
// web `/lab/scanner` page imports to cross-reference copy ↔ detector.
//
// WHY parse source instead of importing detector metadata: each threat detector
// declares its `category` + per-pattern `detector:` ids inside a LOCAL
// `PATTERNS` const (not exported), and `risky-call` derives its `why` tags
// dynamically at scan time (`risky-call:${site.detector}`) with no static
// declaration at all. Reading the source literals (a) needs no churn across ~14
// detector files, (b) auto-discovers a newly added detector file, and (c) lets
// a detector with no static `detector:` ids fall out honestly as `partial`
// rather than silently under-reporting. The committed manifest + its staleness
// check (the CLI's `--check` mode) keep the parse pinned and reviewable.
//
// `buildDetectorInventory` is PURE — it takes already-read file contents, so it
// unit-tests against fixtures. `buildInventoryFromDir` does the fs read and is
// shared by the generator CLI and the staleness test so both see one parse.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One threat detector source file: its name + raw contents (for parsing). */
export interface DetectorSource {
  /** File name, e.g. `injection.ts` — for diagnostics only, not parsed. */
  name: string;
  contents: string;
}

/** The distilled detector vocabulary the web manifest carries. Every array is
 *  sorted so the generated JSON is deterministic (stable diffs, real staleness). */
export interface DetectorInventory {
  /** category -> the detector ids it declares + the `why` tags they produce
   *  (`<category>:<detector-id>`). A category with zero static detector ids has
   *  empty arrays here and appears in `partialDetectors`. */
  threatCategories: Record<string, { detectors: string[]; whyTags: string[] }>;
  /** The capability vocabulary (CAPABILITY_ORDER), sorted. */
  capabilities: string[];
  /** Categories whose `why` tags are computed dynamically (no static `detector:`
   *  declaration to read) — the inventory is honest that it can't enumerate them. */
  partialDetectors: string[];
}

// A `category: '...'` or `detector: '...'` literal, captured in SOURCE ORDER so a
// `detector:` pairs with its nearest-preceding `category:` (the declaration order
// inside every PATTERNS entry). Matching the quoted value keeps prose comments —
// which don't quote these tokens — from registering as declarations.
const DECL_RE = /(?:category:\s*'([^']+)'|detector:\s*'([^']+)')/g;

/**
 * Build the inventory from threat detector source contents + the capability
 * vocabulary. Pure: no IO, deterministic for a given input.
 *
 * For each file, walk its `category:` / `detector:` literals in source order;
 * each detector id is attributed to the most recently seen category. A category
 * that is declared but never pairs with a detector id is recorded with empty
 * arrays and flagged in `partialDetectors`.
 */
/** Categories whose `why` tags are partly derived at scan time (not from static
 *  `detector:` literals), so they are always `partial` regardless of how many
 *  static ids a detector file contributes. */
const DYNAMIC_WHY_CATEGORIES = new Set(['risky-call']);

export function buildDetectorInventory(
  files: ReadonlyArray<DetectorSource>,
  capabilities: ReadonlyArray<string>,
): DetectorInventory {
  // category -> set of detector ids (deduped across files, though each category
  // lives in one file today).
  const byCategory = new Map<string, Set<string>>();
  const ensure = (cat: string) => {
    let set = byCategory.get(cat);
    if (!set) {
      set = new Set();
      byCategory.set(cat, set);
    }
    return set;
  };

  for (const file of files) {
    let currentCategory: string | null = null;
    DECL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DECL_RE.exec(file.contents)) !== null) {
      const [, category, detector] = m;
      if (category !== undefined) {
        currentCategory = category;
        ensure(category); // declared even if it never pairs with a detector id
      } else if (detector !== undefined && currentCategory) {
        ensure(currentCategory).add(detector);
      }
    }
  }

  const threatCategories: DetectorInventory['threatCategories'] = {};
  const partialDetectors: string[] = [];
  for (const cat of [...byCategory.keys()].sort()) {
    const detectors = [...byCategory.get(cat)!].sort();
    threatCategories[cat] = {
      detectors,
      whyTags: detectors.map((d) => `${cat}:${d}`),
    };
    // Partial = the inventory can't enumerate the category's full `why` space:
    // either it has no static `detector:` ids, OR it also derives ids at scan
    // time (risky-call's AST call detectors emit `risky-call:${site.detector}`,
    // uninventoried even once latex.ts contributes static risky-call ids).
    if (detectors.length === 0 || DYNAMIC_WHY_CATEGORIES.has(cat)) partialDetectors.push(cat);
  }

  return {
    threatCategories,
    capabilities: [...capabilities].sort(),
    partialDetectors: partialDetectors.sort(),
  };
}

/** Read every threat detector source in `detectorsDir` (excluding the shared
 *  `util.ts` helper, which declares no categories). */
export async function readDetectorSources(detectorsDir: string): Promise<DetectorSource[]> {
  const entries = await readdir(detectorsDir);
  const files = entries
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'util.ts')
    .sort();
  const sources: DetectorSource[] = [];
  for (const name of files) {
    const contents = await readFile(join(detectorsDir, name), 'utf8');
    sources.push({ name, contents });
  }
  return sources;
}

/**
 * Build the inventory straight from the repo: read the detector sources from
 * `detectorsDir` and pair them with the capability vocabulary. Shared by the
 * generator CLI and the staleness test so both compute one identical parse.
 */
export async function buildInventoryFromDir(
  detectorsDir: string,
  capabilities: ReadonlyArray<string>,
): Promise<DetectorInventory> {
  const sources = await readDetectorSources(detectorsDir);
  return buildDetectorInventory(sources, capabilities);
}

/** Canonical JSON form of the manifest: 2-space indent + trailing newline, so
 *  the committed file matches what an editor / formatter leaves and the
 *  staleness check compares byte-for-byte. */
export function serializeInventory(inventory: DetectorInventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}
