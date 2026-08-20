// Shared helpers for the per-category detectors.

import type { Finding, Severity, Category } from '../types.js';

const MAX_SNIPPET = 120;

export interface MatchSpec {
  category: Category;
  detector: string;
  confidence: Severity;
  /** Regex with `g` flag — global so we walk every match. */
  pattern: RegExp;
  /** Optional per-match acceptor. Return false to drop a match. */
  accept?: (match: RegExpExecArray, file: string, contents: string) => boolean;
}

// Markers that a matched phrase is being DESCRIBED, TAUGHT, or DEFENDED AGAINST
// rather than used as an instruction. A skill that quotes "ignore previous
// instructions" while teaching injection defense, documents that tokens are
// "encrypted in the keychain", or shows a `DROP TABLE` example in a SQL
// best-practices doc is not itself malicious. Deliberately conservative — it
// only fires the exemption when one of these words sits near the match.
const DEFENSIVE_MARKERS =
  /\b(?:untrusted|treat (?:it|them|this) as|as data|do not (?:follow|execute|run|obey)|never (?:follow|execute|run|obey)|example|e\.g\.|for instance|best practice|encrypted in|stored (?:securely|encrypted)|if (?:a|the) (?:page|site|document|user|tool|response) (?:says|contains|returns)|defen[cs]e|mitigat|prompt injection|guard against|be (?:wary|careful) of|watch (?:out )?for|such as `)/i;

/**
 * True when the matched phrase at `index` sits in a describing/teaching/
 * defensive context — a line window around the match carries a defensive marker.
 * Prose threat detectors consult this to skip a documentation/education mention.
 */
export function hasDefensiveContext(contents: string, index: number): boolean {
  const start = contents.lastIndexOf('\n', Math.max(0, index - 240));
  const end = contents.indexOf('\n', index + 240);
  const window = contents.slice(start === -1 ? 0 : start, end === -1 ? contents.length : end);
  return DEFENSIVE_MARKERS.test(window);
}

/**
 * Shared `accept` predicate: keep a match only when it is NOT in a
 * describing/teaching/defensive window. Five threat detectors need the identical
 * closure (injection, prompt-leak, destructive, privilege-escalation,
 * output-injection); export it once so the acceptor contract has a single home.
 */
export function notDefensive(m: RegExpExecArray, _file: string, contents: string): boolean {
  return !hasDefensiveContext(contents, m.index);
}

// Output-injection lexicon — the ONE source for "instruction that inserts
// skill-authored content into the agent's output". Both the threat detector
// (threat/output-injection.ts, the promotional subset that also requires a
// funnel URL) and the capability detector (capability/prose-detectors.ts, the
// intent-free `injects-output-content` disclosure) build their regexes from
// these fragments, so the two lanes cannot drift — a drift that previously let
// third-person "appends…" earn the chip but skip the flag. `INJECT_VERB` carries
// the s/es/ing/ed suffix so "append/appends/appending/appended" all match.
export const INJECT_VERB_SRC =
  '(?:append|add|include|insert|attach|prepend|display|show)(?:s|es|ing|ed)?';
// Trailing `\b` so a noun matches only as a whole word — "credit" must not match
// inside "creditscore", nor "banner" inside "bannered".
export const INJECTABLE_NOUN_SRC =
  '(?:footers?|banners?|watermarks?|signatures?|credits?|attributions?|promo(?:tions?|tional)?|cta)\\b';
export const OUTPUT_POSITION_SRC =
  'as\\s+the\\s+(?:very\\s+)?(?:last|final)\\s+(?:output|line|thing|message)';

// Code-shape patterns (Python/JS/shell API calls, dangerous flags) are gated to
// script files so the same string appearing as a grep example or documentation
// fence inside a `.md` instruction file does not trip an advisory. Markdown is
// the prose surface — prose-intent detectors run there; code-shape detectors do
// not. The script-extension taxonomy lives in the central file-classes primitive.
export { isScriptFile } from '../file-classes.js';

// Dependency-manifest files where unpinned-version shapes are meaningful.
const MANIFEST_RE = /(?:^|\/)(?:package\.json|requirements(?:[-.][\w.]+)?\.txt|Pipfile|pyproject\.toml|Gemfile|Cargo\.toml|go\.mod|composer\.json)$/i;

const CONTAINER_RE =
  /(?:^|\/)(?:Dockerfile(?:\.[\w.-]+)?|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml|Makefile|GNUmakefile)$/i;

/** True for dependency-manifest files. */
export function isManifestFile(file: string): boolean {
  return MANIFEST_RE.test(file);
}

/** True for container build / recipe files shipped in bundles. */
export function isContainerRecipeFile(file: string): boolean {
  return CONTAINER_RE.test(file);
}

/** Precompute 0-based byte offsets where each line starts (line 1 → offset 0). */
export function buildLineStarts(contents: string): Uint32Array {
  const starts: number[] = [0];
  for (let i = 0; i < contents.length; i++) {
    if (contents.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return new Uint32Array(starts);
}

/** 1-indexed line number for `offset` using a precomputed newline index. */
export function lineNumberAt(lineStarts: Uint32Array, offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const lineStartsCache = new Map<string, Uint32Array>();
const LINE_STARTS_CACHE_MAX = 32;

function lineStartsFor(contents: string): Uint32Array {
  let cached = lineStartsCache.get(contents);
  if (!cached) {
    cached = buildLineStarts(contents);
    lineStartsCache.set(contents, cached);
    if (lineStartsCache.size > LINE_STARTS_CACHE_MAX) {
      const oldest = lineStartsCache.keys().next().value;
      if (oldest !== undefined) lineStartsCache.delete(oldest);
    }
  }
  return cached;
}

/** 1-indexed line lookup for an offset in `contents`. */
export function lineNumber(contents: string, offset: number): number {
  return lineNumberAt(lineStartsFor(contents), offset);
}

export function snippetAround(contents: string, offset: number, length: number): string {
  const start = Math.max(0, offset - 20);
  const end = Math.min(contents.length, offset + length + 20);
  const raw = contents.slice(start, end).replace(/\s+/g, ' ').trim();
  return raw.length > MAX_SNIPPET ? raw.slice(0, MAX_SNIPPET) + '…' : raw;
}

export function runPattern(file: string, contents: string, spec: MatchSpec): Finding[] {
  const findings: Finding[] = [];
  const lineStarts = buildLineStarts(contents);
  // Defensive copy of the regex so re-entrancy can't corrupt lastIndex.
  const re = new RegExp(spec.pattern.source, spec.pattern.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(contents)) !== null) {
    if (spec.accept && !spec.accept(m, file, contents)) {
      if (m.index === re.lastIndex) re.lastIndex++;
      continue;
    }
    const offset = m.index;
    const matched = m[0];
    const lineStart = lineNumberAt(lineStarts, offset);
    const lineEnd = lineNumberAt(lineStarts, offset + matched.length);
    findings.push({
      category: spec.category,
      confidence: spec.confidence,
      file,
      lineStart,
      lineEnd,
      snippet: snippetAround(contents, offset, matched.length),
      why: `${spec.category}:${spec.detector}`,
    });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return findings;
}
