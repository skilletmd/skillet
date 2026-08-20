// `triggers:` manifest schema — declarative activation cues.
//
// Natural-language hints for when a runtime should surface or invoke a skill.
// Declarative-only — never an executable hook. Adapters map this field to
// native trigger surfaces where available; otherwise it folds into the
// description surface at materialize time.

/** Per-skill cap on declared triggers — bounds manifest size. */
export const MAX_TRIGGERS = 32;

/** Max length of a single trigger string. */
export const MAX_TRIGGER_CHARS = 280;

export interface TriggersValidationResult {
  triggers: string[];
  /** Non-fatal notes (e.g. duplicate cues). */
  warnings: string[];
}

export class TriggersError extends Error {
  readonly code = 'invalid_triggers';
  constructor(message: string) {
    super(message);
    this.name = 'TriggersError';
  }
}

/**
 * Parse + validate the `triggers` value pulled from SKILL.md frontmatter.
 *
 * @throws TriggersError on any fatal rule.
 */
export function validateTriggers(raw: unknown): TriggersValidationResult {
  const warnings: string[] = [];
  if (raw === undefined || raw === null) {
    return { triggers: [], warnings };
  }
  if (!Array.isArray(raw)) {
    throw new TriggersError('`triggers` must be an array of strings');
  }
  if (raw.length > MAX_TRIGGERS) {
    throw new TriggersError(
      `\`triggers\` has ${raw.length} entries; max is ${MAX_TRIGGERS}`,
    );
  }

  const triggers: string[] = [];
  const seen = new Set<string>();

  raw.forEach((item, i) => {
    const where = `triggers[${i}]`;
    if (typeof item !== 'string') {
      throw new TriggersError(`${where} must be a string`);
    }
    const value = item.trim();
    if (value.length === 0) {
      throw new TriggersError(`${where} must be a non-empty string`);
    }
    if (value.length > MAX_TRIGGER_CHARS) {
      throw new TriggersError(
        `${where} exceeds ${MAX_TRIGGER_CHARS} chars`,
      );
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`${where}: duplicate trigger ignored`);
      return;
    }
    seen.add(key);
    triggers.push(value);
  });

  return { triggers, warnings };
}
