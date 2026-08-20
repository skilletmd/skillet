import { resolve, relative, normalize, join, sep, dirname, basename } from "node:path";
import { realpathSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import type { Adapter } from "../adapter.js";

// ── TCC path policy (macOS protected folders) ───────────────────────────────

/**
 * The user folders macOS gates behind a TCC consent prompt. Any launch-path
 * CONTENT read (readdir/open) against a root that RESOLVES into one of these
 * triggers the "would like to access your Documents folder" dialog at app
 * launch — so such roots are "parked": metadata probes are fine, content
 * reads are not.
 */
export const TCC_PROTECTED_FOLDER_NAMES = ["Documents", "Desktop", "Downloads"] as const;

/**
 * Canonicalize a path via realpath, falling back to the deepest RESOLVABLE
 * ancestor for paths that don't (fully) exist: `realpath(existing ancestor)`
 * + the untraversed suffix. ENOENT must never read as "not protected" — a
 * nonexistent dir under ~/Documents is still under ~/Documents. EPERM/EACCES
 * walk up the same way (U3): a permission-denied dir blocks realpath's own
 * traversal, so canonicalizing through the deepest ancestor we CAN resolve
 * keeps an alias of a denied protected dir reading as protected instead of
 * falling back to its raw (symlink) spelling and slipping past the policy.
 *
 * Exported for the TCC unlock-marker store (util/tcc-access.ts), which keys
 * markers by this same canonical form so aliased paths share one marker.
 */
export function realpathDeepestExisting(p: string): string {
  let current = resolve(p);
  let suffix: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return suffix.length === 0 ? real : join(real, ...suffix);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (
        code !== "ENOENT" &&
        code !== "ENOTDIR" &&
        code !== "EPERM" &&
        code !== "EACCES"
      ) {
        return resolve(p);
      }
      const parent = dirname(current);
      if (parent === current) return resolve(p);
      suffix = [basename(current), ...suffix];
      current = parent;
    }
  }
}

/**
 * TCC-safe path policy: does `candidate`, fully resolved, land inside one of
 * the macOS-protected user folders (~/Documents, ~/Desktop, ~/Downloads)?
 *
 * BOTH sides are canonicalized — the candidate AND the three protected-folder
 * anchors — because macOS spells temp/home paths through symlinks (/var →
 * /private/var): comparing an unresolved anchor against a resolved candidate
 * (or vice versa) false-negatives and the sidecar trips the TCC prompt.
 *
 * Nonexistent paths resolve through their deepest existing ancestor (ENOENT is
 * NOT "safe"). Malformed candidates (empty, null byte) return false — they
 * can't name a protected file.
 *
 * TCC is a macOS mechanism, so the policy is INERT off darwin (a Linux CI box
 * or Windows machine has Documents/Desktop/Downloads folders with no consent
 * gate — parking them would wedge sync for no reason). Hermetic tests exercise
 * the policy anywhere by setting SKILLET_TCC_POLICY=force, which enables it
 * regardless of platform.
 */
export function isTccProtectedPath(candidate: string): boolean {
  if (!tccPolicyActive()) return false;
  if (!candidate || candidate.includes("\x00")) return false;
  const resolved = realpathDeepestExisting(candidate);
  return protectedAnchors().some((anchor) => isPathWithin(resolved, anchor));
}

/** macOS-only policy, with the SKILLET_TCC_POLICY=force test escape hatch. */
function tccPolicyActive(): boolean {
  return platform() === "darwin" || process.env["SKILLET_TCC_POLICY"] === "force";
}

/**
 * The protected-folder ANCHOR (realpath'd ~/Documents, ~/Desktop, or
 * ~/Downloads) that contains an already-RESOLVED path, or null when the path
 * lies outside all three. macOS scopes a TCC consent grant to the whole
 * protected folder per app, so grant bookkeeping (util/tcc-access.ts) keys on
 * this anchor rather than on the probed root.
 */
export function tccProtectedAnchorFor(resolved: string): string | null {
  return protectedAnchors().find((anchor) => isPathWithin(resolved, anchor)) ?? null;
}

/** Containment on already-resolved paths: `p` is `root` or below it. */
export function isPathWithin(p: string, root: string): boolean {
  return p === root || p.startsWith(root + sep);
}

// The anchor realpaths are invariant per home dir; the policy runs per skill x
// per adapter on every sync, so recompute only when homedir() changes (tests
// swap HOME per case).
let _anchorHome: string | undefined;
let _anchors: readonly string[] = [];
function protectedAnchors(): readonly string[] {
  const home = homedir();
  if (_anchorHome !== home) {
    _anchorHome = home;
    _anchors = TCC_PROTECTED_FOLDER_NAMES.map((name) =>
      realpathDeepestExisting(join(home, name)),
    );
  }
  return _anchors;
}

// Module-local env-driven roots — populated at module load by HERMES_ENV_ROOT,
// never exported. validateMaterializationPath and validateAdapterRoot check
// this in addition to MATERIALIZATION_ROOT_ALLOWLIST.
const _runtimeRoots = new Set<string>();

/**
 * Resolve an env-driven config root to a validated `<dir>/skills` path,
 * or null if the var is unset/empty. Called once at module load.
 *
 * Guards (all required):
 * 1. realpathSync with ENOENT fallback — defeats symlink attacks.
 * 2. Segment-level ".." rejection — not a substring check.
 * 3. Throws on bad value; never silently falls back to a default — a
 *    misconfigured root must be loud, not a silent write to a directory
 *    the harness will never read.
 * 4. Suffix "/skills" is hardcoded; only the prefix is env-driven.
 */
function resolveEnvSkillsRoot(envVar: string): string | null {
  const raw = process.env[envVar];
  if (!raw || raw.length === 0) return null;

  if (raw.includes("\x00")) {
    throw new Error(`${envVar} rejected: null byte in value`);
  }

  // NFC-normalize like Claude Code's own resolver does, so both sides agree
  // on the same bytes for accented paths. Harmless for Hermes.
  const normalized = normalize(raw.normalize("NFC"));

  // Segment-level traversal check — substring ".includes('..')" is too broad
  // and rejects legitimate paths like "/Users/company..name/hermes".
  const segments = normalized.split(sep);
  if (segments.some((s) => s === "..")) {
    throw new Error(`${envVar} rejected: path traversal in value "${raw}"`);
  }

  const resolved = resolve(normalized);

  // realpathSync to catch symlink-to-/etc attacks. ENOENT is safe (fresh
  // install): if the path doesn't exist there's no symlink to follow.
  let canonicalized: string;
  try {
    canonicalized = realpathSync(resolved);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      canonicalized = resolved;
    } else {
      throw e;
    }
  }

  return join(canonicalized, "skills");
}

/**
 * Validated env-override for Hermes. Non-null when HERMES_HOME is set and
 * passes all safety checks; null when unset/empty. Computed once at module
 * load — never re-read from process.env at runtime.
 *
 * When non-null, the resolved path is added to the module-local _runtimeRoots
 * Set so validateMaterializationPath and validateAdapterRoot accept it.
 */
export const HERMES_ENV_ROOT: string | null = (() => {
  const root = resolveEnvSkillsRoot("HERMES_HOME");
  if (root !== null) _runtimeRoots.add(resolve(root));
  return root;
})();

/**
 * Validated env-override for Claude Code. Claude Code 2.1.206's own config
 * resolver is `process.env.CLAUDE_CONFIG_DIR ?? ~/.claude` (binary-verified)
 * and personal skills live under `<root>/skills` — so when the var is set,
 * `~/.claude/skills` is a directory Claude Code never reads. Unset/empty
 * falls back to the default (matching the binary's `??`); set-but-invalid
 * throws (same contract as HERMES_HOME).
 */
export const CLAUDE_ENV_ROOT: string | null = (() => {
  const root = resolveEnvSkillsRoot("CLAUDE_CONFIG_DIR");
  if (root !== null) _runtimeRoots.add(resolve(root));
  return root;
})();

/**
 * The Hermes home directory absent any profile: HERMES_HOME when set (its
 * validated parent), else the platform default. Hermes's own Windows fallback
 * when LOCALAPPDATA is unset is `~/AppData/Local/hermes` (hermes_constants),
 * NOT the POSIX dot-dir — matched here so both sides resolve the same tree.
 */
export const HERMES_DEFAULT_HOME: string = (() => {
  if (HERMES_ENV_ROOT !== null) return dirname(HERMES_ENV_ROOT);
  if (platform() === "win32") {
    const localAppData = safeSystemEnvDir("LOCALAPPDATA");
    return localAppData
      ? join(localAppData, "hermes")
      : join(homedir(), "AppData", "Local", "hermes");
  }
  return join(homedir(), ".hermes");
})();

// Profile names are a single conservative path segment — anything else
// (separators, traversal, dotfiles, whitespace) falls back to the default
// tree rather than widening the write boundary from file content.
const HERMES_PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Hermes per-profile skills root, from the sticky `active_profile` file.
 * Hermes keeps a non-default profile's skills at
 * `<home>/profiles/<name>/skills` and scans ONLY the active tree, so a
 * default-tree materialization is invisible to a profile user.
 *
 * LAZY + UNGATED (U2/U3): the `active_profile` read is a filesystem CONTENT
 * read, so it must not run at module load (the sidecar imports core at app
 * launch) — that exact module-load readFileSync was a source of the macOS
 * "access your Documents folder" prompt at launch. The TCC gate is applied by
 * the CALLER — `hermesProfileRoot()` in util/tcc-access.ts — so it can
 * consult the invocation-aware policy (user-initiated and granted-background
 * runs may read a protected-resolving home; unattended runs may not);
 * pathsafe cannot import tcc-access without an import cycle. Never call this
 * directly on the launch path — go through the gated accessor.
 *
 * Compute-once on first ALLOWED call (same load-once contract as HERMES_HOME:
 * a mid-session profile switch takes effect next process). Because the gate
 * lives in the caller, the memo only ever caches a real read outcome — a
 * parked run never reaches this function, so a later allowed run in the same
 * process still resolves the profile. Null when no profile is active, the
 * name is `default`, or the name fails validation.
 *
 * Static import with lazy invocation only — no dynamic import() (the packaged
 * sidecar throws silently on those).
 */
let _hermesProfileRoot: string | null | undefined;
export function computeHermesProfileRootUngated(): string | null {
  if (_hermesProfileRoot !== undefined) return _hermesProfileRoot;
  _hermesProfileRoot = readHermesActiveProfileRoot();
  return _hermesProfileRoot;
}

function readHermesActiveProfileRoot(): string | null {
  let name: string;
  try {
    name = readFileSync(join(HERMES_DEFAULT_HOME, "active_profile"), "utf8").trim();
  } catch {
    return null;
  }
  if (!name || name === "default" || name.includes("\x00")) return null;
  if (name === "." || name === ".." || !HERMES_PROFILE_RE.test(name)) return null;
  const root = join(HERMES_DEFAULT_HOME, "profiles", name, "skills");
  _runtimeRoots.add(resolve(root));
  return root;
}

/**
 * Sanitize a SYSTEM-set env dir (LOCALAPPDATA/APPDATA) for allowlist use:
 * same guards as resolveEnvSkillsRoot but skip-quietly on a bad value
 * instead of throwing — these vars are set by the OS, not by the user for
 * Skillet, so a hostile/broken value should drop the entry (materialization
 * then fails the allowlist loudly) rather than brick every CLI run at load.
 */
function safeSystemEnvDir(envVar: string): string | null {
  const raw = process.env[envVar];
  if (!raw || raw.length === 0) return null;
  if (raw.includes("\x00")) return null;
  const normalized = normalize(raw);
  if (normalized.split(sep).some((s) => s === "..")) return null;
  const resolved = resolve(normalized);
  try {
    return realpathSync(resolved);
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? resolved : null;
  }
}

// Compile-time constant — NOT user-configurable.
//
// Codex moved its skills directory from ~/.codex/skills to ~/.agents/skills in
// June 2026; we materialize only into the supported path. On native Windows,
// Hermes resolves to %LOCALAPPDATA%\hermes\skills and Devin CLI to
// %APPDATA%\devin\skills — included so the allowlist matches each adapter's
// runtime-resolved root on that platform. `~/.codeium/windsurf/skills` is
// Devin Desktop's (né Windsurf) global Agent Skills dir, stable across the
// June 2026 rebrand per the desktop FAQ.
function buildAllowlist(): readonly string[] {
  const home = homedir();
  const entries: string[] = [
    join(home, ".claude", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".openclaw", "skills"),
    join(home, ".hermes", "skills"),
    join(home, ".config", "devin", "skills"),
    join(home, ".codeium", "windsurf", "skills"),
  ];

  if (platform() === "win32") {
    const localAppData = safeSystemEnvDir("LOCALAPPDATA");
    if (localAppData) entries.push(join(localAppData, "hermes", "skills"));
    const appData = safeSystemEnvDir("APPDATA");
    if (appData) entries.push(join(appData, "devin", "skills"));
  }

  return Object.freeze(entries);
}

export const MATERIALIZATION_ROOT_ALLOWLIST: readonly string[] = buildAllowlist();

/**
 * Per-runtime allowlist for `kind === "project"` adapters. Each entry is a
 * POSIX-relative path under the project cwd; an adapter's `targetDir` MUST
 * match exactly. This is the project equivalent of
 * `MATERIALIZATION_ROOT_ALLOWLIST` and prevents a project adapter from
 * declaring `targetDir: ".."` or an absolute path.
 *
 * Compile-time constant — NOT user-configurable.
 */
export const PROJECT_TARGET_ALLOWLIST: readonly string[] = Object.freeze([
  ".cursor/rules",
  ".agents/skills",
  ".windsurf/rules",
]);

export function assertSafe(root: string, targetPath: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(root, targetPath);
  const rel = relative(resolvedRoot, resolvedTarget);

  if (rel.startsWith("..") || resolve(targetPath) === targetPath) {
    throw new Error(`Path escape rejected: "${targetPath}" escapes root "${root}"`);
  }
}

const SAFE_SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function assertSafeSlug(slug: string): void {
  if (slug.includes("\0")) {
    throw new Error(`Null byte rejected in slug: "${slug}"`);
  }
  if (!SAFE_SLUG_RE.test(slug)) {
    throw new Error(`Unsafe skill slug rejected: "${slug}"`);
  }
  const norm = normalize(slug);
  if (norm === "." || norm === ".." || norm.includes("..")) {
    throw new Error(`Unsafe skill slug rejected: "${slug}"`);
  }
}

export function validateMaterializationPath(declaredRoot: string, targetPath: string): void {
  if (declaredRoot.includes("\x00") || targetPath.includes("\x00")) {
    throw new Error(`Path rejected: null byte in path`);
  }

  if (targetPath.length === 0) {
    throw new Error(`Path rejected: empty target path`);
  }

  const resolvedRoot = resolve(declaredRoot);
  // Env-driven roots (e.g. HERMES_HOME) are stored post-realpathSync. Callers
  // may pass the pre-canonical (symlink) path, so check both forms.
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(resolvedRoot);
  } catch {
    canonicalRoot = resolvedRoot;
  }
  const isAllowed =
    MATERIALIZATION_ROOT_ALLOWLIST.some((allowed) => resolve(allowed) === resolvedRoot) ||
    _runtimeRoots.has(resolvedRoot) ||
    _runtimeRoots.has(canonicalRoot);
  if (!isAllowed) {
    throw new Error(`Root rejected: "${declaredRoot}" is not in the per-runtime allowlist`);
  }

  const resolvedTarget = resolve(resolvedRoot, targetPath);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith("..")) {
    throw new Error(`Path escape rejected: "${targetPath}" escapes root "${declaredRoot}"`);
  }
}

/**
 * Path-escape check only — does NOT enforce the runtime allowlist.
 *
 * Use this from helpers like `writeBundleToDir` where the caller has already
 * validated the root (either via `validateAdapterRoot` at adapter creation,
 * or `validateMaterializationPath` for the slug directory). Re-running the
 * allowlist check from inside core would break adapter tests that materialize
 * into temp dirs.
 */
export function assertNoPathEscape(root: string, targetPath: string): void {
  if (root.includes("\x00") || targetPath.includes("\x00")) {
    throw new Error(`Path rejected: null byte in path`);
  }
  if (targetPath.length === 0) {
    throw new Error(`Path rejected: empty target path`);
  }
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(resolvedRoot, targetPath);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith("..") || resolvedTarget === resolvedRoot) {
    throw new Error(`Path escape rejected: "${targetPath}" escapes root "${root}"`);
  }
}

/**
 * Validate that a project-scoped adapter's declared `targetDir` is in the
 * project-target allowlist AND that `projectRoot(cwd)` stays inside `cwd`.
 *
 * Project adapters are NOT covered by `MATERIALIZATION_ROOT_ALLOWLIST` —
 * their absolute root varies per project — so they need their own gate.
 */
export function validateProjectAdapterRoot(adapter: Adapter, cwd: string): void {
  if (adapter.kind !== "project") {
    throw new Error(`Adapter "${adapter.name}" is not project-scoped`);
  }
  if (!cwd || cwd.length === 0) {
    throw new Error(`Adapter "${adapter.name}" requires a non-empty cwd`);
  }
  if (cwd.includes("\x00") || adapter.targetDir.includes("\x00")) {
    throw new Error(`Path rejected: null byte in path`);
  }
  if (adapter.targetDir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(adapter.targetDir)) {
    throw new Error(
      `Adapter "${adapter.name}" project targetDir "${adapter.targetDir}" must be a relative POSIX path`,
    );
  }
  if (!PROJECT_TARGET_ALLOWLIST.includes(adapter.targetDir)) {
    throw new Error(
      `Adapter "${adapter.name}" project targetDir "${adapter.targetDir}" is not in the project-target allowlist`,
    );
  }
  if (!adapter.projectRoot) {
    throw new Error(
      `Adapter "${adapter.name}" is project-scoped but does not implement projectRoot(cwd)`,
    );
  }
  const resolvedCwd = resolve(cwd);
  const resolvedRoot = resolve(adapter.projectRoot(cwd));
  const rel = relative(resolvedCwd, resolvedRoot);
  if (rel.startsWith("..") || resolvedRoot === resolvedCwd) {
    throw new Error(
      `Adapter "${adapter.name}" projectRoot(cwd) "${resolvedRoot}" escapes cwd "${resolvedCwd}"`,
    );
  }
}

export function validateAdapterRoot(adapter: Adapter, opts: { cwd?: string } = {}): void {
  if (adapter.kind === "project") {
    if (!opts.cwd) {
      throw new Error(
        `Adapter "${adapter.name}" is project-scoped; cwd is required for validateAdapterRoot`,
      );
    }
    validateProjectAdapterRoot(adapter, opts.cwd);
    return;
  }
  const resolvedTarget = resolve(adapter.targetDir);
  let canonicalTarget: string;
  try {
    canonicalTarget = realpathSync(resolvedTarget);
  } catch {
    canonicalTarget = resolvedTarget;
  }
  const isAllowed =
    MATERIALIZATION_ROOT_ALLOWLIST.some((allowed) => resolve(allowed) === resolvedTarget) ||
    _runtimeRoots.has(resolvedTarget) ||
    _runtimeRoots.has(canonicalTarget);
  if (!isAllowed) {
    throw new Error(
      `Adapter "${adapter.name}" targetDir "${adapter.targetDir}" is not in the per-runtime allowlist`,
    );
  }
}

/**
 * Resolve the absolute write root for an adapter, regardless of kind.
 *
 * - Global adapters return their static `targetDir`.
 * - Project adapters require `opts.cwd` and dispatch to `projectRoot(cwd)`.
 */
export function resolveAdapterRoot(
  adapter: Adapter,
  opts: { cwd?: string } = {},
): string {
  if (adapter.kind === "project") {
    if (!opts.cwd) {
      throw new Error(
        `Adapter "${adapter.name}" is project-scoped; cwd is required`,
      );
    }
    if (!adapter.projectRoot) {
      throw new Error(
        `Adapter "${adapter.name}" is project-scoped but does not implement projectRoot(cwd)`,
      );
    }
    return adapter.projectRoot(opts.cwd);
  }
  return adapter.targetDir;
}
