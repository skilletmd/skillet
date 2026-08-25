// Does the catalog already have this skill?
//
// The mirror queue could not answer that, so every approval made the next
// decision harder and nothing in the flow knew it. Exact slug matching catches
// a second `code-review` and misses `pr-reviewer`, which is the case that
// matters. Embeddings would catch both and mean adopting a dependency, a
// backfill over 1,365 skills, and an ongoing cost, to inform a queue an admin
// reads. This sits between: token-set similarity, deterministic, no new
// infrastructure.
//
// Two things make the score usable rather than noisy:
//
//   1. Rare shared tokens count for more. Two skills sharing "invoice" are
//      probably the same skill; two sharing "code" are probably not. Inverse
//      document frequency over the catalog itself gets that for free, since we
//      have already loaded the catalog to compare against it.
//   2. Weak words are dropped before scoring. Stopwords, the marketing no-ops
//      the quality rubric already refuses to credit, and the vocabulary every
//      skill uses about itself ("skill", "agent", "helps", "use").
//
// Never a gate: nothing here can reject a candidate or disable a button.
import type { PrismaClient } from '@prisma/client'

/**
 * Below this, two skills are not the same thing.
 *
 * Calibrated 2026-08-25 against all 1,365 public skills, scoring each one's
 * best match in the rest of the catalog. Same-author siblings dominate that
 * distribution and are not the case a mirror candidate presents, so the
 * threshold was read off the 463 CROSS-author best matches, which is what a new
 * author's repo actually looks like:
 *
 *   >= 0.40  37 of 463      >= 0.50  21 of 463
 *   >= 0.45  25 of 463      >= 0.60  17 of 463
 *
 * 0.45 keeps the near-matches this exists for — `every/ce-debug` against
 * `mattpocock/diagnosing-bugs` (0.49) and `obra/using-git-worktrees` against
 * `every/ce-worktree` (0.44) — while flagging ~5% of skills rather than a wall
 * of hits nobody reads. 0.50 drops both of those. The cost is admitted: at 0.45
 * `stripe/upgrade-stripe` matches `expo/expo-upgrade` at 0.46, which is wrong.
 * That is why the ref is stored and rendered as a link, and why nothing here
 * gates a decision (KTD5).
 */
export const OVERLAP_THRESHOLD = 0.45

/**
 * Words that carry no evidence about what a skill DOES. Function words, the
 * marketing vocabulary the quality rubric already refuses to credit, and the
 * words every SKILL.md uses about itself.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'what',
  'which', 'your', 'you', 'their', 'they', 'its', 'are', 'was', 'were', 'been',
  'has', 'have', 'had', 'can', 'will', 'would', 'should', 'must', 'not', 'but',
  'all', 'any', 'each', 'every', 'other', 'than', 'then', 'them', 'these',
  'those', 'over', 'under', 'about', 'after', 'before', 'while', 'also', 'more',
  'most', 'such', 'only', 'own', 'same', 'how', 'why', 'who', 'where',
  'ever', 'never', 'just', 'very', 'really', 'well', 'much', 'many', 'some',
  'out', 'off', 'now', 'here', 'there', 'yet', 'still', 'onto', 'per',
  'across', 'again', 'always', 'both', 'few', 'may', 'might', 'because',
  // Marketing no-ops, same list the rubric scores against.
  'powerful', 'comprehensive', 'seamless', 'advanced', 'ultimate',
  'revolutionary', 'cutting', 'edge', 'best', 'supercharge', 'supercharges',
  // What every skill says about itself.
  'skill', 'skills', 'agent', 'agents', 'claude', 'use', 'uses', 'using',
  'used', 'user', 'help', 'helps', 'helper', 'provide', 'provides', 'run',
  'runs', 'make', 'makes', 'get', 'gets', 'set', 'sets', 'via', 'need',
  'needs', 'want', 'wants', 'work', 'works', 'one', 'two', 'new', 'like',
])

/**
 * Crude suffix folding, so `reviewer` / `reviews` / `reviewing` all reach
 * `review`. Deliberately shallow: a real stemmer would collapse pairs a reader
 * would not accept as the same word, and this only has to make the obvious
 * inflections meet.
 */
function stem(word: string): string {
  for (const suffix of ['ing', 'ers', 'er', 'ies', 'es', 'ed', 's']) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const base = word.slice(0, -suffix.length)
      return suffix === 'ies' ? `${base}y` : base
    }
  }
  return word
}

/** The evidence-bearing words of a skill, as a set. */
export function skillTokens(...parts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const raw of parts) {
    if (!raw) continue
    for (const word of raw.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length < 3) continue
      if (STOPWORDS.has(word)) continue
      const s = stem(word)
      if (s.length < 3 || STOPWORDS.has(s)) continue
      out.add(s)
    }
  }
  return out
}

/**
 * A skill has to say enough about itself to be recognised. Below this, its
 * whole vocabulary can coincide with another's by accident and score 1.0 on a
 * single shared word — which is how "the best, most powerful skill" matched
 * itself across two unrelated repos.
 */
const MIN_INFORMATIVE_TOKENS = 3

export interface CatalogSkill {
  author: string
  slug: string
  description: string | null
}

interface IndexedSkill extends CatalogSkill {
  tokens: Set<string>
  norm: number
}

/** A catalog prepared for comparison: token sets plus their IDF weights. */
export interface OverlapIndex {
  size: number
  idf: Map<string, number>
  skills: IndexedSkill[]
}

export function buildOverlapIndex(catalog: CatalogSkill[]): OverlapIndex {
  const tokenSets = catalog.map((s) => skillTokens(s.slug, s.description))
  const df = new Map<string, number>()
  for (const set of tokenSets) {
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const n = Math.max(1, catalog.length)
  const idf = new Map<string, number>()
  for (const [t, count] of df) idf.set(t, Math.log(1 + n / (1 + count)))
  const fallback = Math.log(1 + n)
  const weight = (t: string) => idf.get(t) ?? fallback
  const skills = catalog.map((s, i) => {
    const tokens = tokenSets[i]!
    let sum = 0
    for (const t of tokens) sum += weight(t) ** 2
    return { ...s, tokens, norm: Math.sqrt(sum) }
  })
  return { size: catalog.length, idf, skills }
}

/**
 * Cosine similarity over IDF-weighted token sets, 0 to 1. An exact duplicate
 * scores 1; two skills whose only shared word is a common one score near 0.
 */
function similarity(index: OverlapIndex, tokens: Set<string>, norm: number, other: IndexedSkill): number {
  if (norm === 0 || other.norm === 0) return 0
  const fallback = Math.log(1 + Math.max(1, index.size))
  let dot = 0
  // Iterate the smaller set; the intersection is the same either way.
  const [small, large] = tokens.size <= other.tokens.size ? [tokens, other.tokens] : [other.tokens, tokens]
  for (const t of small) {
    if (!large.has(t)) continue
    dot += (index.idf.get(t) ?? fallback) ** 2
  }
  return dot / (norm * other.norm)
}

export interface OverlapHit {
  /** "author/slug" of the catalog skill this candidate most resembles. */
  ref: string
  score: number
}

/**
 * The single best catalog match for one candidate skill, or null when the
 * catalog is empty or the candidate has nothing to compare on. One good match
 * answers "do we already have this"; a ranked list does not earn its width.
 */
export function bestOverlap(
  index: OverlapIndex,
  candidate: { slug: string; name?: string | null; description?: string | null },
): OverlapHit | null {
  const tokens = skillTokens(candidate.slug, candidate.name, candidate.description)
  if (tokens.size < MIN_INFORMATIVE_TOKENS || index.skills.length === 0) return null
  const fallback = Math.log(1 + Math.max(1, index.size))
  let norm = 0
  for (const t of tokens) norm += (index.idf.get(t) ?? fallback) ** 2
  norm = Math.sqrt(norm)
  let best: OverlapHit | null = null
  for (const other of index.skills) {
    if (other.tokens.size < MIN_INFORMATIVE_TOKENS) continue
    const score = similarity(index, tokens, norm, other)
    if (score <= 0) continue
    if (!best || score > best.score) best = { ref: `${other.author}/${other.slug}`, score }
  }
  return best
}

/**
 * Public skills only. A private skill is not something the catalog "already
 * has" from a browsing reader's perspective, and an overlap hit an admin
 * cannot click through to check is worse than no hit at all.
 */
export async function loadPublicCatalogPrisma(prisma: PrismaClient): Promise<CatalogSkill[]> {
  const rows = await prisma.skills.findMany({
    where: { visibility: 'public' },
    select: { author_id: true, slug: true, description: true },
  })
  return rows.map((r) => ({ author: r.author_id, slug: r.slug, description: r.description }))
}
