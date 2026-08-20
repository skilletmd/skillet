/**
 * Update-trust policy: decide, per incoming update, whether it
 * AUTO-APPLIES (no human diff prompt) or is DIFF-GATED (graded diff + approve).
 *
 * The resolution is a precedence hierarchy — most specific wins:
 *
 *   1. per-skill    (policy.skills[slug])        — overrides everything
 *   2. per-author   (policy.authors[authorKeyId]) — overrides kit + global, for that author
 *   3. per-kit local (policy.kits[sourceKit])     — a local CLI rule for one kit
 *   4. subscriber trust (input.subscriberTrust)   — the web-set per-kit preference
 *   5. global by source class                     — the fallback, TWO independent defaults:
 *        - own-kit  (your team / your own kit)  → default AUTO-APPLY
 *        - external (strangers)                 → default DIFF-GATE
 *
 * Per-kit lets a subscriber say "auto-update this kit, but
 * review that one" without trusting every author in it individually. It is
 * keyed by the kit ref the skill was synced under (`@owner/kitname`, the
 * manifest `source_kit`). Author/skill overrides are finer-grained and still
 * win, so you can auto-trust a kit yet gate one suspect skill inside it.
 *
 * SECURITY BOUNDARY (AC #5 — non-negotiable):
 *   This module decides ONLY whether a human reviews the diff. It NEVER governs
 *   whether the content is verified. Auto-apply removes the approval prompt; it
 *   does NOT skip Ed25519 signature verification or the harm scan. Those gates
 *   run unconditionally in the sync materialize path (see commands/sync.ts:
 *   the quarantine gate and verifyForMaterialize both run regardless of the
 *   trust mode resolved here). A trusted, auto-apply skill receiving a
 *   malicious or unsigned update is still hard-blocked. Trust governs review,
 *   not safety.
 *
 * Persistence: a single JSON file at $XDG_CONFIG_HOME/skillet/trust-policy.json,
 * written atomically (temp + rename). Authors are keyed by their Ed25519 key
 * ID (hex), not by handle — so a key rotation re-falls-through to the default
 * rather than silently inheriting trust granted to the old key.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { atomicWrite } from "../util/atomic.js";

/** Whether an update applies without a human prompt ("auto") or is gated. */
export type TrustMode = "auto" | "gate";

/**
 * Source class for the two independent global defaults:
 *   - "own-kit":  skill came from the user's own kit / a team kit they belong
 *                 to (the authenticated union manifest).
 *   - "external": skill was added from a stranger (`skillet add @them/skill`).
 */
export type SourceClass = "own-kit" | "external";

export interface TrustPolicyFile {
  version: 1;
  /** The two independent global defaults, by source class. */
  globals: Record<SourceClass, TrustMode>;
  /** Per-author overrides, keyed by Ed25519 key ID (hex). */
  authors: Record<string, TrustMode>;
  /** Per-skill overrides, keyed by slug (e.g. "@taylor/festival-ops"). */
  skills: Record<string, TrustMode>;
  /** Per-kit overrides, keyed by kit ref (e.g. "@taylor/writers-kit"). */
  kits: Record<string, TrustMode>;
}

/**
 * The shipped defaults — chosen so the common case needs zero config:
 *   own-kit  → auto-apply (you trust your own team)
 *   external → diff-gate  (review before a stranger's update lands)
 */
export const DEFAULT_POLICY: TrustPolicyFile = {
  version: 1,
  globals: { "own-kit": "auto", external: "gate" },
  authors: {},
  skills: {},
  kits: {},
};

/** Returns the trust-policy file path for the current user. */
export function defaultPolicyPath(): string {
  const cfg = process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
  return join(cfg, "skillet", "trust-policy.json");
}

/** Narrowing guard so a hand-edited/corrupt mode can't slip through. */
function asMode(v: unknown): TrustMode | undefined {
  return v === "auto" || v === "gate" ? v : undefined;
}

/**
 * Reads the policy file, falling back to DEFAULT_POLICY when it does not
 * exist. A present-but-malformed file is repaired field-by-field against the
 * defaults rather than throwing — a corrupt policy must NEVER fail open into
 * blanket auto-apply, so anything unrecognized resolves to the (safer)
 * default. I/O errors other than ENOENT are propagated.
 */
export async function loadPolicy(
  policyPath: string = defaultPolicyPath()
): Promise<TrustPolicyFile> {
  let raw: string;
  try {
    raw = await readFile(policyPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(DEFAULT_POLICY);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt file must not silently widen trust. Fall back to safe defaults.
    return structuredClone(DEFAULT_POLICY);
  }

  const p = (parsed ?? {}) as Partial<TrustPolicyFile>;
  const globals = (p.globals ?? {}) as Partial<Record<SourceClass, unknown>>;
  const out: TrustPolicyFile = {
    version: 1,
    globals: {
      "own-kit": asMode(globals["own-kit"]) ?? DEFAULT_POLICY.globals["own-kit"],
      external: asMode(globals.external) ?? DEFAULT_POLICY.globals.external,
    },
    authors: {},
    skills: {},
    kits: {},
  };
  for (const [k, v] of Object.entries(p.authors ?? {})) {
    const m = asMode(v);
    if (m) out.authors[k] = m;
  }
  for (const [k, v] of Object.entries(p.skills ?? {})) {
    const m = asMode(v);
    if (m) out.skills[k] = m;
  }
  for (const [k, v] of Object.entries(p.kits ?? {})) {
    const m = asMode(v);
    if (m) out.kits[k] = m;
  }
  return out;
}

/** Persists the policy atomically (temp + rename, no backup file). */
export async function savePolicy(
  policy: TrustPolicyFile,
  policyPath: string = defaultPolicyPath()
): Promise<void> {
  await atomicWrite(policyPath, JSON.stringify(policy, null, 2) + "\n", {
    backup: false,
  });
}

export interface PolicyInput {
  /** Skill slug, e.g. "@taylor/festival-ops". */
  slug: string;
  /** Author Ed25519 key ID (hex). Absent for local imports. */
  authorKeyId?: string | null;
  /** Where the skill came from. */
  source: "local" | "registry";
  /**
   * own-kit vs external. Absent for legacy entries written before trust policy;
   * treated as "external" so the safer (gated) default applies on resolution.
   */
  sourceClass?: SourceClass | null;
  /**
   * Kit ref this skill was synced under (`@owner/kitname`, the manifest
   * `source_kit`). Drives the local per-kit override. Absent for
   * locally-imported skills and for skills not sourced from a kit.
   */
  sourceKit?: string | null;
  /**
   * The subscriber's web-set per-kit trust preference, delivered via the sync
   * manifest. Overrides the global default but yields to any local per-skill,
   * per-author, or per-kit override. Null/absent when none was set.
   */
  subscriberTrust?: TrustMode | null;
  /**
   * NF-006: whether the subscriber has TOFU-pinned this author's primary key.
   * When explicitly false, resolution gates even under own-kit auto.
   */
  authorPinned?: boolean | null;
}

/**
 * Resolves the effective trust mode for one incoming update via the precedence
 * hierarchy. Pure — no I/O — so it is trivially unit-testable for every level.
 *
 * Short-circuits that are always auto (never gated), regardless of policy:
 *   - source === "local": the user's own imported file; there is no remote
 *     author to extend trust to.
 *   - authorKeyId === ownKeyId: a self-published update (own signing key).
 *
 * Everything else falls through skill → author → kit → global-by-source-class.
 */
export function resolveTrustMode(
  input: PolicyInput,
  policy: TrustPolicyFile,
  ownKeyId?: string | null
): TrustMode {
  if (input.source === "local") return "auto";
  if (input.authorKeyId && ownKeyId && input.authorKeyId === ownKeyId) {
    return "auto";
  }

  // NF-006: a registry author the subscriber has not pinned yet always gates.
  if (input.authorPinned === false) return "gate";

  // 1. per-skill — most specific, wins over everything below.
  const perSkill = policy.skills[input.slug];
  if (perSkill) return perSkill;

  // 2. per-author — overrides kit + global for this author's skills.
  if (input.authorKeyId) {
    const perAuthor = policy.authors[input.authorKeyId];
    if (perAuthor) return perAuthor;
  }

  // 3. per-kit (local) — a local CLI override for one subscribed kit, so a
  //    subscriber can auto-trust a whole kit (or gate one) without touching
  //    per-author/per-skill rules.
  if (input.sourceKit) {
    const perKit = policy.kits[input.sourceKit];
    if (perKit) return perKit;
  }

  // 4. subscriber trust — the web-set per-kit preference (delivered via the
  //    manifest). It is the same conceptual level as the local per-kit rule, so
  //    an explicit local override above wins, but this beats the global default.
  if (input.subscriberTrust) return input.subscriberTrust;

  // 5. global default, by source class. A missing/unknown source class
  //    resolves to "external" — the safer of the two defaults.
  const cls: SourceClass = input.sourceClass === "own-kit" ? "own-kit" : "external";
  return policy.globals[cls];
}

// ── setters (substrate for the contextual UX surfaces, AC #6) ───────────────
// These are the functional primitives the diff-view toggle, skill page, author
// profile, and the small global-defaults surface call into. They load → mutate
// → save atomically so callers don't have to re-implement read-modify-write.

/** Set one of the two global defaults. */
export async function setGlobalDefault(
  cls: SourceClass,
  mode: TrustMode,
  policyPath: string = defaultPolicyPath()
): Promise<TrustPolicyFile> {
  const policy = await loadPolicy(policyPath);
  policy.globals[cls] = mode;
  await savePolicy(policy, policyPath);
  return policy;
}

/** Pin (or clear) trust for a specific author key. mode=null removes the override. */
export async function setAuthorPolicy(
  authorKeyId: string,
  mode: TrustMode | null,
  policyPath: string = defaultPolicyPath()
): Promise<TrustPolicyFile> {
  const policy = await loadPolicy(policyPath);
  if (mode === null) delete policy.authors[authorKeyId];
  else policy.authors[authorKeyId] = mode;
  await savePolicy(policy, policyPath);
  return policy;
}

/** Pin (or clear) trust for a specific skill. mode=null removes the override. */
export async function setSkillPolicy(
  slug: string,
  mode: TrustMode | null,
  policyPath: string = defaultPolicyPath()
): Promise<TrustPolicyFile> {
  const policy = await loadPolicy(policyPath);
  if (mode === null) delete policy.skills[slug];
  else policy.skills[slug] = mode;
  await savePolicy(policy, policyPath);
  return policy;
}

/** Pin (or clear) trust for a specific kit. mode=null removes the override. */
export async function setKitPolicy(
  kitRef: string,
  mode: TrustMode | null,
  policyPath: string = defaultPolicyPath()
): Promise<TrustPolicyFile> {
  const policy = await loadPolicy(policyPath);
  if (mode === null) delete policy.kits[kitRef];
  else policy.kits[kitRef] = mode;
  await savePolicy(policy, policyPath);
  return policy;
}
