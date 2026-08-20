// `requires:` manifest schema — dependency edges + skill→skill deps.
//
// This module is the canonical, signed-bundle schema for a skill's declared
// dependencies. It LOCKS THE FIELD, not the resolver: it parses and validates
// the `requires:` block of SKILL.md frontmatter. It performs NO I/O and NO
// fetching — graph walk, transitive fetch, and trust-gating are the resolver's
// job and land later.
//
// The field lives in SKILL.md frontmatter, so it is inside the canonical
// content hash (§2.2) and the author signature (§4): dependency edges are
// tamper-evident and travel with the artifact from version 1.

/** The four dependency kinds. Exactly one per entry. */
export type RequiresKind = 'skill' | 'agent' | 'tool' | 'command';

/**
 * One declared dependency. Exactly one kind key is set; its value is the
 * target identifier. `version` is only meaningful for `skill` deps.
 */
export interface RequiresEntry {
  kind: RequiresKind;
  /** Target identifier: `@author/slug` for skill, name/id otherwise. */
  target: string;
  /** Version constraint — `skill` deps only. See RequiresVersion forms. */
  version?: string;
  /** false = required (loud gap surfacing); true = optional (quiet note). */
  optional: boolean;
  /** Human note shown verbatim in the gap surface. <= 280 chars. */
  reason?: string;
}

/** Per-skill cap on declared dependencies — bounds resolver fan-out. */
export const MAX_REQUIRES_ENTRIES = 64;

/** Max length of an entry's `reason` note. */
export const MAX_REQUIRES_REASON_CHARS = 280;

const KIND_KEYS: readonly RequiresKind[] = ['skill', 'agent', 'tool', 'command'];

/** Canonical published-skill ref: `@author/slug` (lowercase, hyphen/dot-safe). */
const SKILL_REF_RE = /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/;

/**
 * Version-constraint grammar (skill deps only). Skillet skills are NOT semver:
 * a version is a monotonic integer per skill (§2.3) plus a content hash
 * (§2.2). The vocabulary is defined over THAT model, deliberately not npm
 * semver ranges.
 *
 *   omitted / "*" / "latest"  → latest gated version the recipient approved
 *   "<N>"                      → exact version integer
 *   ">=<N>"                    → floor: that integer or newer
 *   "sha256:<hex>"             → exact content-hash pin (reproducible)
 */
const VERSION_INT_RE = /^\d+$/;
const VERSION_FLOOR_RE = /^>=\d+$/;
const VERSION_HASH_RE = /^sha256:[0-9a-f]{64}$/;

export function isValidRequiresVersion(v: string): boolean {
  return (
    v === '*' ||
    v === 'latest' ||
    VERSION_INT_RE.test(v) ||
    VERSION_FLOOR_RE.test(v) ||
    VERSION_HASH_RE.test(v)
  );
}

export interface RequiresValidationResult {
  entries: RequiresEntry[];
  /** Non-fatal notes (e.g. unknown keys inside an entry). */
  warnings: string[];
}

export class RequiresError extends Error {
  readonly code = 'invalid_requires';
  constructor(message: string) {
    super(message);
    this.name = 'RequiresError';
  }
}

/**
 * Parse + validate the `requires` value pulled from SKILL.md frontmatter.
 *
 * @param raw      The frontmatter `requires` value (any — it comes from YAML).
 * @param selfRef  The manifest's own `@author/slug`, when known, to reject
 *                 self-dependencies. Omit during import when the ref isn't
 *                 minted yet.
 * @throws RequiresError on any fatal rule (see docs §3.3).
 */
export function validateRequires(
  raw: unknown,
  selfRef?: string
): RequiresValidationResult {
  const warnings: string[] = [];
  if (raw === undefined || raw === null) {
    return { entries: [], warnings };
  }
  if (!Array.isArray(raw)) {
    throw new RequiresError('`requires` must be an array');
  }
  if (raw.length > MAX_REQUIRES_ENTRIES) {
    throw new RequiresError(
      `\`requires\` has ${raw.length} entries; max is ${MAX_REQUIRES_ENTRIES}`
    );
  }

  const entries: RequiresEntry[] = [];
  raw.forEach((item, i) => {
    const where = `requires[${i}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new RequiresError(`${where} must be a mapping`);
    }
    const obj = item as Record<string, unknown>;

    const present = KIND_KEYS.filter((k) => k in obj);
    if (present.length === 0) {
      throw new RequiresError(
        `${where} must declare exactly one of ${KIND_KEYS.join('/')}`
      );
    }
    if (present.length > 1) {
      throw new RequiresError(
        `${where} declares multiple kinds (${present.join(', ')}); exactly one allowed`
      );
    }
    const kind = present[0]!;
    const target = obj[kind];
    if (typeof target !== 'string' || target.trim() === '') {
      throw new RequiresError(`${where}.${kind} must be a non-empty string`);
    }

    if ('version' in obj && kind !== 'skill') {
      throw new RequiresError(
        `${where}.version is only valid on a \`skill\` dependency`
      );
    }
    let version: string | undefined;
    if (kind === 'skill') {
      if (!SKILL_REF_RE.test(target)) {
        throw new RequiresError(
          `${where}.skill "${target}" is not a canonical @author/slug ref`
        );
      }
      if (selfRef && target === selfRef) {
        throw new RequiresError(`${where}.skill is a self-dependency (${target})`);
      }
      if ('version' in obj) {
        const v = obj['version'];
        if (typeof v !== 'string' || !isValidRequiresVersion(v)) {
          throw new RequiresError(
            `${where}.version "${String(v)}" is not a valid constraint`
          );
        }
        version = v;
      }
    }

    let optional = false;
    if ('optional' in obj) {
      if (typeof obj['optional'] !== 'boolean') {
        throw new RequiresError(`${where}.optional must be a boolean`);
      }
      optional = obj['optional'];
    }

    let reason: string | undefined;
    if ('reason' in obj) {
      const r = obj['reason'];
      if (typeof r !== 'string') {
        throw new RequiresError(`${where}.reason must be a string`);
      }
      if (r.length > MAX_REQUIRES_REASON_CHARS) {
        throw new RequiresError(
          `${where}.reason exceeds ${MAX_REQUIRES_REASON_CHARS} chars`
        );
      }
      reason = r;
    }

    // Forward-compat: unknown keys are a warning, not a reject, so the schema
    // can grow. Echoing them back surfaces typos to the author.
    const known = new Set<string>([kind, 'version', 'optional', 'reason']);
    for (const key of Object.keys(obj)) {
      if (!known.has(key)) {
        warnings.push(`${where}: unknown key "${key}" ignored`);
      }
    }

    entries.push({ kind, target, version, optional, reason });
  });

  return { entries, warnings };
}
