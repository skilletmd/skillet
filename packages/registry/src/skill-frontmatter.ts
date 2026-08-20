// Shared SKILL.md frontmatter helpers for registry publish.
import { validateTriggers, TriggersError } from '@skillet/protocol';

export { TriggersError };

/**
 * Extract the YAML frontmatter block from a SKILL.md body, or null if absent.
 */
export function extractFrontmatterYaml(text: string): string | null {
  const normalized = text.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1] ?? null;
}

/**
 * Parse a `triggers:` string list from a frontmatter YAML block.
 * Handles quoted and unquoted list items under a top-level `triggers:` key.
 */
export function parseTriggersListFromYaml(yaml: string): unknown {
  const items: string[] = [];
  let inTriggers = false;

  for (const line of yaml.split('\n')) {
    if (/^triggers:\s*$/.test(line)) {
      inTriggers = true;
      continue;
    }
    if (inTriggers) {
      const itemMatch = line.match(/^\s+-\s+(?:"([^"]*)"|'([^']*)'|(.+))\s*$/);
      if (itemMatch) {
        items.push((itemMatch[1] ?? itemMatch[2] ?? itemMatch[3] ?? '').trim());
        continue;
      }
      if (/^\S/.test(line)) {
        inTriggers = false;
      }
    }
  }

  return items.length > 0 ? items : undefined;
}

/** Inclusive line span (indices into `text.split('\n')`). */
export interface LineSpan {
  start: number;
  end: number;
}

/**
 * Locate the full line span of the frontmatter `description:` entry in a
 * SKILL.md body: the key line plus any block-scalar (`>`, `>-`, `|`, …) or
 * indented plain-scalar continuation lines. Scoped to the frontmatter block
 * (between the opening and closing `---`), so a body line that happens to
 * start with `description:` is never matched. Returns null when there is no
 * frontmatter or no top-level description key.
 */
export function descriptionSpanInSkillMd(text: string): LineSpan | null {
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  if (lines[0]?.replace(/\r$/, '') !== '---') return null;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith('---')) {
      close = i;
      break;
    }
  }
  if (close === -1) return null;
  for (let i = 1; i < close; i++) {
    if (!lines[i].startsWith('description:')) continue;
    let end = i;
    for (let j = i + 1; j < close; j++) {
      if (/^\S/.test(lines[j])) break;
      if (/\S/.test(lines[j])) end = j;
    }
    return { start: i, end };
  }
  return null;
}

/**
 * Parse the top-level `name:` value from a frontmatter YAML block (quoted or
 * bare). Only matches a column-0 `name:` so nested keys are never picked up.
 */
export function parseNameFromYaml(yaml: string): string | null {
  let last: string | null = null;
  for (const line of yaml.split('\n')) {
    const m = line.match(/^name:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/);
    if (m) last = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  }
  return last;
}

/** Read the `name:` frontmatter value from a decoded bundle's SKILL.md, or null. */
export function extractNameFromSkillMd(bundle: Map<string, Uint8Array>): string | null {
  const bytes = bundle.get('SKILL.md');
  if (!bytes) return null;
  const yaml = extractFrontmatterYaml(Buffer.from(bytes).toString('utf8'));
  if (!yaml) return null;
  return parseNameFromYaml(yaml);
}

/**
 * Read and validate `triggers` from a decoded bundle's SKILL.md entrypoint.
 * Returns the normalized trigger list for metadata persistence.
 */
export function extractTriggersFromSkillMd(
  bundle: Map<string, Uint8Array>,
): string[] {
  const bytes = bundle.get('SKILL.md');
  if (!bytes) return [];
  const yaml = extractFrontmatterYaml(Buffer.from(bytes).toString('utf8'));
  if (!yaml) return [];
  const raw = parseTriggersListFromYaml(yaml);
  if (raw === undefined) return [];
  return validateTriggers(raw).triggers;
}

/**
 * Parse a top-level boolean-ish flag from a frontmatter YAML block. Only matches
 * a column-0 `key:` so nested keys are never picked up. Returns true only when
 * the value is `true` (quoted or bare, case-insensitive); anything else — a
 * different value, or an absent key — is false.
 */
export function parseBooleanFlagFromYaml(yaml: string, key: string): boolean {
  for (const line of yaml.split('\n')) {
    const prefix = `${key}:`;
    if (!line.startsWith(prefix)) continue;
    let raw = line.slice(prefix.length).trim();
    if (
      raw.length >= 2 &&
      ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
    ) {
      raw = raw.slice(1, -1);
    }
    return raw.trim().toLowerCase() === 'true';
  }
  return false;
}

/** The two invocation facts a skill page surfaces. */
export interface InvocationFacts {
  /** The agent can fire this skill on its own (model-invoked). */
  modelInvoked: boolean;
  /** The human can run it by name (`user-invocable: true`). */
  hasCommand: boolean;
}

/**
 * Derive the two invocation facts from a decoded bundle's SKILL.md frontmatter.
 *
 *   modelInvoked = a description is present AND `disable-model-invocation` is not true
 *   hasCommand   = `user-invocable: true` OR `disable-model-invocation: true`
 *
 * `disable-model-invocation: true` is the ecosystem's marker for a manual,
 * user-invoked skill (Claude Code semantics: the model can't auto-fire it, so it
 * is reached by name). It therefore implies a command on its own — most real
 * skills.sh skills use it instead of `user-invocable`. `user-invocable: true`
 * (Skillet's slash-command field) also yields a command, and stacks with model
 * invocation for an auto+manual skill.
 *
 * The two facts are orthogonal: a skill can be one, both, or (misconfigured —
 * no description and no command flag) neither. Shared by the publish path and
 * the one-time backfill so both compute the facts identically.
 */
export function deriveInvocationFacts(
  bundle: Map<string, Uint8Array>,
): InvocationFacts {
  const bytes = bundle.get('SKILL.md');
  if (!bytes) return { modelInvoked: false, hasCommand: false };
  const yaml = extractFrontmatterYaml(Buffer.from(bytes).toString('utf8'));
  if (!yaml) return { modelInvoked: false, hasCommand: false };
  // A non-empty `description:` value, mirroring the publish-path extractor.
  const descMatch = yaml.match(/^description:\s*(?:"([^"]*)"|'([^']*)'|(.*?))\s*$/m);
  const hasDescription = !!(descMatch && (descMatch[1] ?? descMatch[2] ?? descMatch[3] ?? '').trim());
  const disableModel = parseBooleanFlagFromYaml(yaml, 'disable-model-invocation');
  const userInvocable = parseBooleanFlagFromYaml(yaml, 'user-invocable');
  return {
    modelInvoked: hasDescription && !disableModel,
    hasCommand: userInvocable || disableModel,
  };
}

/**
 * Resolve the invocation facts a detail endpoint should serve from a version's
 * stored `metadata_json`. When the explicit booleans are present (any version
 * published since the flags landed, or backfilled), they win. When absent — a
 * legacy version not yet backfilled, or malformed metadata — fall back to the
 * default: model-invoked iff the skill has a description, never a command. This
 * keeps the common "Automatic" case correct without re-parsing the bundle.
 */
export function resolveInvocationFacts(
  metadataJson: string | null,
  hasDescription: boolean,
): InvocationFacts {
  const fallback: InvocationFacts = { modelInvoked: hasDescription, hasCommand: false };
  if (!metadataJson) return fallback;
  try {
    const meta = JSON.parse(metadataJson) as { modelInvoked?: unknown; hasCommand?: unknown };
    return {
      modelInvoked:
        typeof meta.modelInvoked === 'boolean' ? meta.modelInvoked : fallback.modelInvoked,
      hasCommand: typeof meta.hasCommand === 'boolean' ? meta.hasCommand : fallback.hasCommand,
    };
  } catch {
    return fallback;
  }
}
