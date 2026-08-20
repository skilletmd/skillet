// Promotional content injected into the agent's output.
//
// The live-incident shape (claude-seo, 11.5K★, 2026-07): SKILL.md instructs the
// agent to append a promo "Community Footer" — skool.com links — to every
// deliverable, and users shipped it to clients unread. The dangerous shape is
// an OUTPUT-INJECTION instruction (append/add this footer/banner, "as the very
// last output", "after completing any deliverable") joined to a
// monetization/community link nearby. The join is what keeps this precise:
// document-formatting instructions ("add a footer with page numbers") carry no
// funnel domain, and a promo link alone (an author's README linking their
// Discord) carries no output-injection instruction. Both patterns are `medium`
// — visible flag, never quarantine — and skip defensive/teaching mentions.
//
// The verb/noun/output-position vocabulary is shared with the capability lane
// (capability/prose-detectors.ts) via detectors/util.ts, so the promotional
// flag stays a strict subset of the intent-free `injects-output-content`
// capability it folds into (via the vocabulary's `permission` tag) and the two
// lanes cannot drift.

import type { Detector, Finding } from '../../types.js';
import {
  runPattern,
  notDefensive,
  INJECT_VERB_SRC,
  INJECTABLE_NOUN_SRC,
  OUTPUT_POSITION_SRC,
} from '../util.js';

// Community/monetization hosts with no plausible role inside a skill's OUTPUT.
// Deliberately NOT a general URL match: docs links, API endpoints, and an
// author's own site in a README are normal; these hosts are where "join my
// community / pay me" funnels live. Bare registrable domains only — the
// subdomain prefix and trailing boundary in PROMO_URL handle join./seller./www.
// forms and stop a host from matching as a prefix of another domain.
const PROMO_HOSTS = [
  'skool\\.com',
  'gumroad\\.com',
  'patreon\\.com',
  'whop\\.com',
  'discord\\.gg',
  'discord\\.com/invite',
  't\\.me',
  'buymeacoffee\\.com',
  'ko-fi\\.com',
  'linktr\\.ee',
  'substack\\.com',
].join('|');

// A promo URL: any subdomain chain (join./seller./www./…) in front of a promo
// host, with a trailing boundary so `skool.com` does not match inside
// `skool.communities-review.org`.
const PROMO_URL = `https?:\\/\\/(?:[a-z0-9-]+\\.)*(?:${PROMO_HOSTS})(?![a-z0-9.-])`;

// Cheap O(n) pre-filter: both patterns REQUIRE a promo host, so a file with none
// can never match. Testing this first lets the common case (no funnel host) and
// the adversarial case (many "add footer" lines, no URL) skip the two lazy
// bounded patterns entirely instead of paying their backtracking cost.
const HAS_PROMO_HOST = new RegExp(`(?:${PROMO_HOSTS})`, 'i');

// The instruction → link window. Spans a heading + a fenced footer template (the
// incident shape) but MUST NOT cross a markdown ATX heading into an unrelated
// section — `[\s\S]{0,600}` freely crossed `## Support` boundaries and joined a
// benign "add a footer with page numbers" instruction to a distant support
// link. The negative lookahead on each step forbids stepping onto a heading line.
const WINDOW = `(?:(?!\\n\\s{0,3}#)[\\s\\S]){0,600}?`;

const PATTERNS = [
  {
    category: 'output-injection' as const,
    detector: 'promo-footer',
    confidence: 'medium' as const,
    // "append/add/include … footer/banner/credit …(soon after, same section)… promo URL"
    pattern: new RegExp(
      `\\b${INJECT_VERB_SRC}\\b[^\\n]{0,160}?${INJECTABLE_NOUN_SRC}${WINDOW}${PROMO_URL}`,
      'gi',
    ),
    accept: notDefensive,
  },
  {
    category: 'output-injection' as const,
    detector: 'promo-in-output-position',
    confidence: 'medium' as const,
    // Output-position phrasing ("as the very last output", "at the end of every
    // response", "after completing any deliverable") followed by a promo URL —
    // catches footer-shaped injection that never says the word "footer".
    pattern: new RegExp(
      `(?:${OUTPUT_POSITION_SRC}|at\\s+the\\s+end\\s+of\\s+(?:every|each|all|any)\\b|after\\s+(?:completing|finishing)\\s+(?:any|every|each)\\b)${WINDOW}${PROMO_URL}`,
      'gi',
    ),
    accept: notDefensive,
  },
];

export const outputInjectionDetector: Detector = (filePath, contents) => {
  // No promo host → neither pattern can match; skip the expensive walk.
  if (!HAS_PROMO_HOST.test(contents)) return [];
  // The two patterns catch different shapes (verb+noun vs output-position), but
  // the canonical incident ("append this footer as the very last output: …")
  // matches BOTH on one line. Keep one finding per starting line so a single
  // injected footer reads as one flag, not a doubled count / two identical rows.
  const out: Finding[] = [];
  const seenLines = new Set<number>();
  for (const p of PATTERNS) {
    for (const f of runPattern(filePath, contents, p)) {
      if (seenLines.has(f.lineStart)) continue;
      seenLines.add(f.lineStart);
      out.push(f);
    }
  }
  return out;
};
