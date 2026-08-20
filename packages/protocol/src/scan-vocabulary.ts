// One authoritative scanner vocabulary — the single source of truth both the
// web (copy) and the registry (ordering) draw from.
//
// Entries are keyed by the ids the detectors ALREADY emit: the nine capability
// ids ("what can this skill do?") and the fifteen threat-category ids ("is this
// a threat?"). This file changes NO detector emission and NO wire format — the
// keys ARE the strings emitted today. It only attaches user-facing copy and an
// optional permission tag to those ids.
//
// Two surfaces:
//   - PERMISSIONS — one entry per capability id (kind 'permission'). Installer
//     voice: what the skill CAN do. Ported from the web's CAPABILITY_LABELS /
//     CAPABILITY_DESCRIBE.
//   - FLAGS — one entry per threat-category id (kind 'flag'). label + describe +
//     fix, plus an optional `permission` tag folding an action finding into the
//     capability it duplicates (e.g. `destructive` → `deletes-files`).
//
// Copy is plain-English and on-brand: label is a short name, describe is one
// calm installer-facing sentence, fix is one author-facing sentence. Add an id
// once here and every trust surface stays in lockstep.

/**
 * The eight installer-facing capability (permission) ids — the closed union the
 * detectors emit and the trust UI orders. Exported so a `permission` tag and
 * `PERMISSION_ORDER` are typo-proof ids, not bare strings.
 */
export type CapabilityId =
  | 'runs-shell'
  | 'network'
  | 'writes-files'
  | 'deletes-files'
  | 'reads-secrets'
  | 'install-hooks'
  | 'connects-mcp-server'
  | 'executes-generated'
  | 'injects-output-content';

/** One vocabulary entry — copy + optional permission tag for a scanner id. */
export interface ScanVocabularyEntry {
  /** The id the detectors emit (capability id or threat-category id). */
  id: string;
  /** Which lane this id belongs to: a capability or a threat flag. */
  kind: 'permission' | 'flag';
  /** Plain-English name shown on every surface. */
  label: string;
  /** Installer-facing: what the pattern / capability is. */
  describe: string;
  /** Author-facing: how to fix it or what to confirm. Flags only. */
  fix?: string;
  /**
   * For a flag: the capability id this action finding duplicates, so the trust
   * panel folds it into that capability instead of showing a second,
   * near-identical chip. Absent for flags with no capability home (they stay
   * standalone). Always absent on permission entries.
   */
  permission?: CapabilityId;
  /**
   * For a flag: whether the pattern describes something the skill *does*
   * (`action` — run a command, send data out, delete files) or a property of
   * the files themselves (`content` — injection text, obfuscation, a maybe-
   * secret). This routes a SUB-SERIOUS (low/medium) finding's presentation: an
   * action folds into "What this skill can do" (a permission row, or its own
   * calm row); content goes to the quiet "also noticed" note. High-confidence
   * findings ignore `shape` — they always surface in the Safety card. Required
   * on every flag (asserted in the test); always absent on permission entries.
   */
  shape?: 'action' | 'content';
}

// ---------------------------------------------------------------------------
// Permissions — one per capability id, in canonical chip order.
// ---------------------------------------------------------------------------

/**
 * The single canonical chip order, most-impactful-first. This is the canonical
 * home for the order the registry's `CAPABILITY_ORDER` and the web mirror;
 * those import it from here. Keep it the declaration order of the capability
 * union.
 */
export const PERMISSION_ORDER: readonly CapabilityId[] = [
  'runs-shell',
  'network',
  'writes-files',
  'deletes-files',
  'reads-secrets',
  'install-hooks',
  'connects-mcp-server',
  'executes-generated',
  'injects-output-content',
];

/** Capability vocabulary, keyed by capability id. Ported from the web's
 *  CAPABILITY_LABELS / CAPABILITY_DESCRIBE — installer voice, no fix. */
export const PERMISSIONS: Record<string, ScanVocabularyEntry> = {
  'runs-shell': {
    id: 'runs-shell',
    kind: 'permission',
    label: 'Run commands',
    describe: 'Runs shell commands on your machine.',
  },
  network: {
    id: 'network',
    kind: 'permission',
    label: 'Use the internet',
    describe: 'Connects to the internet to fetch data or call other services.',
  },
  'writes-files': {
    id: 'writes-files',
    kind: 'permission',
    label: 'Write files',
    describe: 'Creates or changes files on disk.',
  },
  'deletes-files': {
    id: 'deletes-files',
    kind: 'permission',
    label: 'Delete files',
    describe: 'Removes or overwrites files.',
  },
  'reads-secrets': {
    id: 'reads-secrets',
    kind: 'permission',
    label: 'Read env variables',
    describe: 'Reads environment variables, which may hold tokens or keys.',
  },
  'install-hooks': {
    id: 'install-hooks',
    kind: 'permission',
    label: 'Install packages',
    describe: 'Installs third-party packages, which can run their own setup scripts.',
  },
  'connects-mcp-server': {
    id: 'connects-mcp-server',
    kind: 'permission',
    label: 'Connect an MCP server',
    describe: 'Wires up a Model Context Protocol server, whose tools then run with the agent’s access.',
  },
  'executes-generated': {
    id: 'executes-generated',
    kind: 'permission',
    label: 'Run generated code',
    describe: 'Runs code that it generates at runtime.',
  },
  'injects-output-content': {
    id: 'injects-output-content',
    kind: 'permission',
    label: 'Add to your output',
    describe: 'Inserts its own content — like footers, credits, or links — into what the agent produces for you.',
  },
};

// ---------------------------------------------------------------------------
// Flags — one per threat-category id.
//
// Copy for injection, exfil, destructive, obfuscation, secret,
// privilege-escalation, and excessive-agency is ported from the web CATALOG
// (the entry each category resolves to through `findingCategory`). The rest —
// prompt-leak, supply-chain, output-handling, memory-poisoning, tool-misuse,
// rogue-agent, and risky-call — are authored fresh in the same
// installer voice, because they either fell back to GENERIC or collapsed onto a
// shared CATALOG entry that did not describe them precisely.
//
// `permission` folds a flag into the capability chip it duplicates:
// `risky-call` → `runs-shell` and `destructive` → `deletes-files` (both ported
// from the web's `findingCapability`), and `output-injection` →
// `injects-output-content` (the flag is the promotional subset of the
// capability). No threat category is network-shaped under this logic (exfil is
// deliberately left standalone), so nothing folds into `network`. Everything
// else is a standalone warning with no permission tag.
//
// `shape` is set on EVERY flag and routes a sub-serious form's presentation:
// `action` (the skill does something) → "What this skill can do"; `content`
// (a property of the files) → the quiet "also noticed" note. Action: exfil,
// destructive, risky-call, supply-chain, tool-misuse, output-handling,
// output-injection, privilege-escalation, excessive-agency, rogue-agent.
// Content: injection, prompt-leak, obfuscation, secret, memory-poisoning.
// ---------------------------------------------------------------------------

/** Threat-category vocabulary, keyed by category id. */
export const FLAGS: Record<string, ScanVocabularyEntry> = {
  // --- Ported from the web CATALOG ---
  injection: {
    id: 'injection',
    kind: 'flag',
    label: 'Prompt injection',
    describe: 'Text that could try to hijack an agent’s instructions.',
    fix: 'Reword it so it reads as instructions to the user, not the agent.',
    shape: 'content',
  },
  exfil: {
    id: 'exfil',
    kind: 'flag',
    label: 'Send data out',
    describe: 'Moves data to an outside destination. Confirm that’s expected.',
    fix: 'Confirm what leaves and where it goes. Don’t pipe a download straight into a shell.',
    shape: 'action',
  },
  destructive: {
    id: 'destructive',
    kind: 'flag',
    label: 'Delete or overwrite files',
    describe: 'Removes or overwrites files. Destructive if the path is wrong.',
    fix: 'Point it at a specific path, never the root.',
    permission: 'deletes-files',
    shape: 'action',
  },
  obfuscation: {
    id: 'obfuscation',
    kind: 'flag',
    label: 'Hard-to-read code',
    describe: 'Encoded or scrambled content you can’t read at a glance.',
    fix: 'Keep it if it’s real data. Otherwise spell it out so it’s readable.',
    shape: 'content',
  },
  secret: {
    id: 'secret',
    kind: 'flag',
    label: 'Possible secret',
    describe: 'A value that looks like a password or key — it could be a real credential.',
    fix: 'Swap it for an environment variable or a placeholder.',
    shape: 'content',
  },
  'privilege-escalation': {
    id: 'privilege-escalation',
    kind: 'flag',
    label: 'Ask for more access',
    describe: 'Requests elevated permissions. Confirm the skill needs them.',
    fix: 'Drop the elevated permission if the skill doesn’t need it.',
    shape: 'action',
  },
  'excessive-agency': {
    id: 'excessive-agency',
    kind: 'flag',
    label: 'Act without asking',
    describe:
      'Takes actions on its own, like auto-approving or looping. Fine for trusted automation, worth a glance.',
    fix: 'Add a confirmation step before it acts on its own.',
    shape: 'action',
  },

  // --- Authored fresh ---
  'prompt-leak': {
    id: 'prompt-leak',
    kind: 'flag',
    label: 'Reveal the system prompt',
    describe: 'Tries to reveal an agent’s hidden system instructions.',
    fix: 'Remove the request for the hidden prompt, or say plainly why the skill needs it.',
    shape: 'content',
  },
  'supply-chain': {
    id: 'supply-chain',
    kind: 'flag',
    label: 'Fetch and run code',
    describe: 'Downloads code or a package at runtime and runs it, so what executes can change later.',
    fix: 'Pin the source to a known version and review what it runs before shipping.',
    shape: 'action',
  },
  'output-handling': {
    id: 'output-handling',
    kind: 'flag',
    label: 'Act on model output',
    describe: 'Feeds the model’s own output into a shell, query, or page without checking it first.',
    fix: 'Validate or escape model output before you run, query, or render it.',
    shape: 'action',
  },
  'output-injection': {
    id: 'output-injection',
    kind: 'flag',
    label: 'Inject promotional content',
    describe: 'Instructs the agent to slip promotional links or branding into your deliverables.',
    fix: 'Remove the injected promotion, or make it opt-in and clearly disclosed.',
    permission: 'injects-output-content',
    shape: 'action',
  },
  'memory-poisoning': {
    id: 'memory-poisoning',
    kind: 'flag',
    label: 'Rewrite agent memory',
    describe: 'Writes instructions into the agent’s memory that persist across sessions.',
    fix: 'Drop the persistent write, or confirm the skill genuinely needs durable memory.',
    shape: 'content',
  },
  'tool-misuse': {
    id: 'tool-misuse',
    kind: 'flag',
    label: 'Disable a safety check',
    describe: 'Turns off a guardrail like auth, TLS verification, or a confirmation prompt.',
    fix: 'Leave the safety flag on, or explain why this command must skip it.',
    shape: 'action',
  },
  'rogue-agent': {
    id: 'rogue-agent',
    kind: 'flag',
    label: 'Persist or self-modify',
    describe: 'Sets itself to run later or rewrites its own code to keep running.',
    fix: 'Remove the persistence hook unless staying resident is the skill’s stated job.',
    shape: 'action',
  },
  'risky-call': {
    id: 'risky-call',
    kind: 'flag',
    label: 'Run a shell command',
    describe: 'Calls exec, eval, or a subprocess to run a command directly.',
    fix: 'Build the command from trusted input only, and quote or validate anything dynamic.',
    permission: 'runs-shell',
    shape: 'action',
  },
};

/** Every vocabulary entry, keyed by id (permissions and flags merged). */
export const SCAN_VOCABULARY: Record<string, ScanVocabularyEntry> = {
  ...PERMISSIONS,
  ...FLAGS,
};

/** Look up a vocabulary entry by emitted id. Undefined for unknown ids. */
export function vocabularyEntry(id: string): ScanVocabularyEntry | undefined {
  return SCAN_VOCABULARY[id];
}
