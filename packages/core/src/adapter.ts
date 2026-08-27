import type { DecodedBundle } from '@skillet/protocol';

/**
 * Where this adapter writes:
 * - "global": a single absolute root per host (e.g. `~/.claude/skills`).
 * - "project": a path *inside the current project cwd* (e.g. `.cursor/rules`).
 *
 * Project adapters resolve their absolute root via `projectRoot(cwd)` and
 * are validated against `PROJECT_TARGET_ALLOWLIST` instead of the global
 * `MATERIALIZATION_ROOT_ALLOWLIST`.
 *
 * Omitting `kind` is treated as `"global"` for backward compatibility with
 * the v1 SKILL.md-native adapters (Claude Code, Codex, Hermes, OpenClaw,
 * Cursor, Windsurf).
 */
export type AdapterKind = 'global' | 'project';

export interface Adapter {
  /** Stable runtime key, e.g. "claude-code". */
  name: string;
  /**
   * @default "global"
   *
   * "global" — single host-wide directory listed in
   * `MATERIALIZATION_ROOT_ALLOWLIST`. Examples: Claude Code, Codex,
   * Hermes, OpenClaw.
   *
   * "project" — per-project directory under the current working tree.
   * Example: Cursor (`.cursor/rules`). Project adapters MUST also
   * implement `projectRoot(cwd)`.
   */
  kind?: AdapterKind;
  /**
   * For `kind === "global"`: the allowlisted absolute root the runtime
   * materializes into (e.g. `~/.claude/skills`).
   *
   * For `kind === "project"`: a stable POSIX-relative path under the
   * project cwd (e.g. `.cursor/rules`) — used as the allowlist key and
   * for display. The absolute path comes from `projectRoot(cwd)`.
   */
  targetDir: string;
  /** True if this runtime is installed on the host (or, for a project
   * adapter, discoverable from the host environment). */
  detect(): Promise<boolean>;
  /**
   * Required for `kind === "project"`: resolve the absolute root for the
   * given project working directory.
   *
   * Implementations should return `join(cwd, this.targetDir)` (or
   * equivalent) so the relative POSIX path in `targetDir` stays the
   * single source of truth.
   */
  projectRoot?(cwd: string): string;
  /**
   * Optional: when sync cwd is outside a project tree (e.g. `~/.skillet` for
   * the desktop sidecar), resolve the project cwd to use for materialize.
   * Return null/undefined to fall back to sync cwd.
   */
  resolveMaterializeCwd?(syncCwd: string): Promise<string | null | undefined>;
  /**
   * Optional bundle translator. When present, the adapter translates an
   * incoming SKILL.md bundle into its runtime-native files *before*
   * anything is written to disk.
   *
   * Returns a new `DecodedBundle` whose keys are POSIX-relative paths
   * under the adapter's per-skill write root. When omitted, the bytes
   * are written verbatim.
   *
   * Hashing, signature verification, and approval all run against the
   * *original* bundle bytes; `transform` is purely a write-side
   * representation change.
   */
  transform?(
    slug: string,
    bundle: DecodedBundle,
    opts?: MaterializeOptions,
  ): DecodedBundle | Promise<DecodedBundle>;
  /**
   * Write the full bundle tree under the adapter's per-skill root.
   *
   * Returns the absolute paths of every file written. The first entry is
   * the skill's `SKILL.md` (or, for `transform`-using adapters, the
   * representative native entrypoint) so callers that only need an
   * entrypoint can `[0]`-index; the rest preserve bundle order (sorted
   * lexicographically by bundle path).
   */
  materialize(slug: string, bundle: DecodedBundle, opts?: MaterializeOptions): Promise<string[]>;
  /**
   * Absolute path of the skill's `SKILL.md` (or representative entrypoint
   * for `transform`-using adapters) for the given slug under this
   * adapter. Used by sync to read what's currently on disk before
   * computing the graded diff (§6.2).
   */
  targetPath(slug: string, opts?: TargetPathOptions): string;
  /**
   * Absolute path of the skill's root directory. The entire bundle (or
   * its transformed projection) lives underneath this.
   */
  targetSkillDir(slug: string, opts?: TargetPathOptions): string;
  /**
   * Optional: detect existing skills on disk that the runtime would load
   * before the Skillet-synced copy under `targetDir`.
   *
   * A runtime with multiple skill search paths (e.g. OpenClaw's six-level
   * precedence) may silently shadow a Skillet sync if a higher-precedence dir
   * holds a same-slug skill. Adapters that scope shadowing per workspace
   * use `opts.workspaceDir`; others ignore it.
   *
   * Returning an empty array means no shadow was detected. Implementations
   * MUST NOT throw on I/O errors — a missing search path is not a shadow.
   */
  findShadows?(slug: string, opts?: ShadowFindOptions): Promise<ShadowFinding[]>;
}

export interface MaterializeOptions {
  /** Owner handle (without leading `@`); empty/undefined → unowned namespace. */
  owner?: string | null;
  /** Required for `kind === "project"` adapters; ignored by global adapters. */
  cwd?: string;
  /** Override the default `<owner>--<slug>` materialized directory name. */
  dirName?: string;
  /** Kit entry description when SKILL.md frontmatter is missing or edited away. */
  description?: string;
}

export interface TargetPathOptions {
  owner?: string | null;
  /** Required for `kind === "project"` adapters; ignored by global adapters. */
  cwd?: string;
  /** Override the default `<owner>--<slug>` materialized directory name. */
  dirName?: string;
}

/**
 * Apply an adapter's `transform` hook (if any) and return the bundle that
 * should be written to disk. Returns the input bundle unchanged when the
 * adapter does not declare a transform.
 *
 * Adapter implementations should call this from `materialize()` so callers
 * never have to know whether a given adapter rewrites bytes.
 */
export async function applyAdapterTransform(
  adapter: Pick<Adapter, 'transform'>,
  slug: string,
  bundle: DecodedBundle,
  opts?: MaterializeOptions,
): Promise<DecodedBundle> {
  if (!adapter.transform) return bundle;
  return await adapter.transform(slug, bundle, opts);
}

export interface ShadowFindOptions {
  /** Owner handle (without leading `@`); empty/undefined → unowned namespace. */
  owner?: string | null;
  /** Override the default `<owner>--<slug>` materialized directory name. */
  dirName?: string;
  /**
   * Project root the runtime treats as the current workspace. Adapters with
   * workspace-scoped search paths (e.g. OpenClaw) check inside this dir.
   * Adapters that only consult HOME-level paths can ignore it.
   */
  workspaceDir?: string;
}

export interface ShadowFinding {
  /** Absolute path of the higher-precedence skill that shadows the Skillet copy. */
  path: string;
  /**
   * Short human-readable label for the shadowing location, e.g.
   * `<workspace>/skills` or `~/.agents/skills`. Used by the CLI to render
   * a clear warning without leaking absolute home paths into stdout.
   */
  location: string;
}

/**
 * Thrown from `Adapter.materialize` when the adapter is DETECTED but not yet
 * ready to receive skills — e.g. the harness config root does not exist because
 * the app has never been launched. This is a benign SKIP, not a materialize
 * failure: sync surfaces it as a warning and leaves the skill pending so the
 * next run retries once the agent is set up. Callers that gate exit codes on
 * materialize failures (import's `applyToAgents`, the sync summary) must not
 * treat it as one.
 */
export class AdapterSkipError extends Error {
  readonly adapterSkip = true;
  constructor(message: string) {
    super(message);
    this.name = 'AdapterSkipError';
  }
}
