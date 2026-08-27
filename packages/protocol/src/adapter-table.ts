// Canonical adapter table (PROTOCOL §10) — the single source of truth for
// where each runtime keeps its skills.
//
// This lives in @skillet/protocol, the leaf package, so the three parties that
// need it can all reach it without adding a dependency edge:
//
//   - packages/registry serves it as the signed `/api/v1/adapters/manifest`
//   - packages/core carries the client-side verifier for that manifest
//   - packages/adapters/* are checked against it by the parity test in
//     packages/cli/tests/adapter-parity.test.ts
//
// It used to be hand-maintained inside the registry route, a second copy of
// eight paths whose only job was to disagree with the adapters. It did: the
// June 2026 Windsurf → Devin Desktop rebrand moved that runtime from a
// project-scoped rules-file writer to a global skills-folder materializer, and
// the table kept serving the dead `.windsurf/rules` for months. Nothing caught
// it because nothing consumes the manifest yet. Edit this table and the parity
// test, never a copy.
//
// `root` is stored in TILDE form (`~/.claude/skills`), never expanded. The
// registry serves this verbatim, so an absolute path here would bake the
// server's own homedir into a signed artifact that clients then resolve
// against theirs.

/** Where the runtime's skills live: one host-wide dir, or one per project. */
export type AdapterKind = 'global' | 'project';

/**
 * On-disk shape the runtime reads.
 *
 * - `skill-md`   — a `<slug>/SKILL.md` folder, the agentskills.io layout
 * - `mdc`        — Cursor's single `.mdc` rule file with its own frontmatter
 * - `rules-file` — a flattened single `.md` rule, frontmatter stripped
 *
 * No shipped adapter emits `rules-file` any more (Devin Desktop was the last,
 * and moved to `skill-md` in the rebrand). The member stays because this is a
 * wire enum: a client pinned to an older release still has to parse it.
 */
export type AdapterLayout = 'skill-md' | 'mdc' | 'rules-file';

export interface AdapterEntry {
  /** Human-readable hint at what proves the runtime is installed. */
  detect: string;
  /** Stable runtime id. A wire contract with the desktop tray — never rename
   *  it for a rebrand; change the display label instead (`runtimeLabel`). */
  key: string;
  kind: AdapterKind;
  layout: AdapterLayout;
  /**
   * For `kind: 'global'`, a tilde-form absolute path (`~/.claude/skills`).
   * For `kind: 'project'`, a POSIX-relative path under the project cwd.
   * Both are allowlist keys, so the value must match the corresponding entry
   * in core's `MATERIALIZATION_ROOT_ALLOWLIST` / `PROJECT_TARGET_ALLOWLIST`.
   */
  root: string;
  version: string;
}

/**
 * The runtimes Skillet materializes into, in the order the CLI iterates them.
 *
 * `opencode` is deliberately absent. It READS the universal `~/.agents/skills`
 * baseline that the codex entry already writes, so listing it would describe a
 * materialization that never happens and double-count one write. It is
 * surfaced for detection and labeling only (`BASELINE_READER_ADAPTERS` in
 * packages/cli/src/cli-context.ts).
 */
export const ADAPTER_TABLE: readonly AdapterEntry[] = Object.freeze([
  {
    detect: '~/.agents or ~/.codex (legacy back-compat)',
    key: 'codex',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.agents/skills',
    version: '1.0.0',
  },
  {
    detect: '~/.claude',
    key: 'claude-code',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.claude/skills',
    version: '1.0.0',
  },
  {
    detect: '~/.openclaw',
    key: 'openclaw',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.openclaw/skills',
    version: '1.0.0',
  },
  {
    detect: '~/.hermes',
    key: 'hermes',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.hermes/skills',
    version: '1.0.0',
  },
  {
    detect: '/Applications/Cursor.app or ~/.cursor',
    key: 'cursor',
    kind: 'project',
    layout: 'mdc',
    root: '.cursor/rules',
    version: '1.0.0',
  },
  {
    // Devin Desktop, née Windsurf (Cognition rebrand, 2026-06-02). The key
    // stays `windsurf` because the tray reads it; only the label moved.
    detect: '~/.codeium/windsurf or Devin Desktop / Windsurf.app',
    key: 'windsurf',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.codeium/windsurf/skills',
    version: '1.1.0',
  },
  {
    detect: '~/.config/devin or a devin binary on PATH',
    key: 'devin',
    kind: 'global',
    layout: 'skill-md',
    root: '~/.config/devin/skills',
    version: '1.0.0',
  },
]);

/** Look up one runtime's entry by its stable key. */
export function adapterEntry(key: string): AdapterEntry | undefined {
  return ADAPTER_TABLE.find((e) => e.key === key);
}
