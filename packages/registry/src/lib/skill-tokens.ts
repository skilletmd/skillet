// Context-weight metering: approximate token count for a skill's SKILL.md.
//
// Weight is a property of skill *content*, so it is computed per skill version
// and recomputed only when SKILL.md changes. We split the count into the
// "ambient" tax (name + trigger description, kept hot for every materialized
// skill) and the "body" (the rest of SKILL.md, paid only when the skill fires).
//
// The number is a cross-vendor approximation, not an exact per-vendor count:
// the same SKILL.md tokenizes differently in Claude, Codex, and Gemini, so we
// pick one local tokenizer and render the result with a tilde. `token_method`
// is stored alongside the counts so a later swap is a clean re-tokenize.
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { extractFrontmatterYaml, descriptionSpanInSkillMd } from '../skill-frontmatter.js';

/** Identifier for the tokenizer that produced a stored count. */
export const TOKEN_METHOD = 'gpt-tokenizer-o200k';

export interface SkillTokenCounts {
  /** Tokens of (name + trigger description) — the standing hot tax. */
  ambient: number;
  /** Tokens of SKILL.md after the frontmatter block — paid on trigger. */
  body: number;
  /** Headline = ambient + body. */
  count: number;
  /** Tokenizer identity (see {@link TOKEN_METHOD}). */
  method: string;
}

// Mirrors the frontmatter extractors in skill-frontmatter.ts (column-0 keys,
// quoted or bare). Kept local so token compute has no dependency on the
// route-private description extractor.
const NAME_RE = /^name:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/m;

function firstGroup(match: RegExpMatchArray | null): string {
  if (!match) return '';
  return (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

/**
 * Extract the full frontmatter `description:` value, including block-scalar
 * (`>`, `|`) and indented multi-line continuations. A single-line regex drops
 * the continuation lines, which then vanish from the body too (they live inside
 * the stripped frontmatter) — undercounting ambient for the long multi-line
 * descriptions common in mirrored skills. Reuses the shared span resolver.
 */
function extractDescriptionText(text: string): string {
  const span = descriptionSpanInSkillMd(text);
  if (!span) return '';
  const lines = text.split('\n');
  const spanLines = lines.slice(span.start, span.end + 1);
  if (spanLines.length === 0) return '';
  // Drop the `description:` key and any block-scalar indicator from line 0.
  spanLines[0] = spanLines[0].replace(/^description:\s*[>|]?[+-]?\d*\s*/, '');
  return spanLines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** Strip the leading frontmatter fence, returning the SKILL.md body. */
function stripFrontmatter(text: string): string {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? text.slice(match[0].length) : text;
}

function countTokens(text: string): number {
  return text ? encode(text).length : 0;
}

/**
 * Compute the approximate token weight of a SKILL.md.
 *
 * `ambient` counts the name plus the trigger description (the frontmatter the
 * runtime keeps hot for every materialized skill). `body` counts everything
 * after the frontmatter block. `count` is their sum (the headline).
 *
 * SKILL.md only — bundled `references/`/`scripts/` text is out of v1 scope
 * (that becomes `token_bundle` in v1.1).
 */
export function computeSkillTokens(skillMd: string): SkillTokenCounts {
  const normalized = skillMd.replace(/^\uFEFF/, "");
  const yaml = extractFrontmatterYaml(normalized);
  const name = yaml ? firstGroup(yaml.match(NAME_RE)) : '';
  const description = yaml ? extractDescriptionText(normalized) : '';
  const ambientText = [name, description].filter(Boolean).join('\n');

  const ambient = countTokens(ambientText);
  const body = countTokens(stripFrontmatter(normalized));
  return { ambient, body, count: ambient + body, method: TOKEN_METHOD };
}
