// Basic eval fixture + static runner.
//
// v1 runs keyword checks against SKILL.md — no LLM calls. A bundled
// `evals/smoke.json` declares prompts and expected instruction coverage;
// passing means the skill text addresses every case. Full certification is v6.

import type { DecodedBundle } from './bundle.js';

/** Canonical minimal eval fixture path inside a skill bundle. */
export const EVAL_SMOKE_PATH = 'evals/smoke.json';

export type EvalStatus = 'passed' | 'failed' | 'none';

export const EVAL_FIXTURE_VERSION = 1;
export const MAX_EVAL_CASES = 8;
export const MAX_EVAL_EXPECT_TERMS = 16;
export const MAX_EVAL_TERM_CHARS = 64;
export const MAX_EVAL_PROMPT_CHARS = 280;
export const MAX_EVAL_ID_CHARS = 64;

export interface EvalCase {
  id: string;
  prompt: string;
  /** Substrings that must appear in SKILL.md (case-insensitive). */
  expect_in_skill: string[];
}

export interface EvalFixture {
  version: number;
  cases: EvalCase[];
}

export interface EvalRunResult {
  status: EvalStatus;
  /** Present when a fixture was found and parsed. */
  fixture?: EvalFixture;
  /** Per-case outcomes when a fixture ran. */
  case_results?: Array<{ id: string; passed: boolean; missing?: string[] }>;
}

export class EvalError extends Error {
  readonly code = 'invalid_eval';
  constructor(message: string) {
    super(message);
    this.name = 'EvalError';
  }
}

export function parseEvalFixture(raw: unknown): EvalFixture {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new EvalError('eval fixture must be an object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== EVAL_FIXTURE_VERSION) {
    throw new EvalError(`eval fixture version must be ${EVAL_FIXTURE_VERSION}`);
  }
  if (!Array.isArray(obj.cases) || obj.cases.length === 0) {
    throw new EvalError('eval fixture must include at least one case');
  }
  if (obj.cases.length > MAX_EVAL_CASES) {
    throw new EvalError(`eval fixture has ${obj.cases.length} cases; max is ${MAX_EVAL_CASES}`);
  }

  const cases: EvalCase[] = obj.cases.map((item, i) => {
    const where = `cases[${i}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new EvalError(`${where} must be an object`);
    }
    const c = item as Record<string, unknown>;
    const id = c.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new EvalError(`${where}.id must be a non-empty string`);
    }
    if (id.length > MAX_EVAL_ID_CHARS) {
      throw new EvalError(`${where}.id exceeds ${MAX_EVAL_ID_CHARS} chars`);
    }
    const prompt = c.prompt;
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new EvalError(`${where}.prompt must be a non-empty string`);
    }
    if (prompt.length > MAX_EVAL_PROMPT_CHARS) {
      throw new EvalError(`${where}.prompt exceeds ${MAX_EVAL_PROMPT_CHARS} chars`);
    }
    if (!Array.isArray(c.expect_in_skill) || c.expect_in_skill.length === 0) {
      throw new EvalError(`${where}.expect_in_skill must be a non-empty string array`);
    }
    if (c.expect_in_skill.length > MAX_EVAL_EXPECT_TERMS) {
      throw new EvalError(
        `${where}.expect_in_skill exceeds ${MAX_EVAL_EXPECT_TERMS} terms`,
      );
    }
    const expect_in_skill = c.expect_in_skill.map((term, j) => {
      if (typeof term !== 'string' || term.trim().length === 0) {
        throw new EvalError(`${where}.expect_in_skill[${j}] must be a non-empty string`);
      }
      if (term.length > MAX_EVAL_TERM_CHARS) {
        throw new EvalError(
          `${where}.expect_in_skill[${j}] exceeds ${MAX_EVAL_TERM_CHARS} chars`,
        );
      }
      return term.trim();
    });
    return { id: id.trim(), prompt: prompt.trim(), expect_in_skill };
  });

  return { version: EVAL_FIXTURE_VERSION, cases };
}

export function readEvalFixtureFromBundle(bundle: DecodedBundle): EvalFixture | null {
  const bytes = bundle.get(EVAL_SMOKE_PATH);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new EvalError('evals/smoke.json is not valid JSON');
  }
  return parseEvalFixture(parsed);
}

/**
 * Run the v1 static basic eval against a decoded bundle.
 * No fixture → status `none`. Fixture present → `passed` or `failed`.
 */
export function runBasicEval(bundle: DecodedBundle): EvalRunResult {
  const fixture = readEvalFixtureFromBundle(bundle);
  if (!fixture) {
    return { status: 'none' };
  }

  const skillMd = bundle.get('SKILL.md');
  if (!skillMd) {
    return {
      status: 'failed',
      fixture,
      case_results: fixture.cases.map((c) => ({
        id: c.id,
        passed: false,
        missing: c.expect_in_skill,
      })),
    };
  }

  const haystack = Buffer.from(skillMd).toString('utf8').toLowerCase();
  const case_results = fixture.cases.map((c) => {
    const missing = c.expect_in_skill.filter(
      (term) => !haystack.includes(term.toLowerCase()),
    );
    return { id: c.id, passed: missing.length === 0, ...(missing.length ? { missing } : {}) };
  });

  const status: EvalStatus = case_results.every((r) => r.passed) ? 'passed' : 'failed';
  return { status, fixture, case_results };
}
