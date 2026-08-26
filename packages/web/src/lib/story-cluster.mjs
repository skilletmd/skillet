/**
 * Group collected posts into story candidates.
 *
 * Extracted from the drafting script so the linkage rule is testable: it decides
 * what a story is ABOUT, and getting it wrong is expensive in a way that is only
 * visible after the prose is written.
 */

/** One post is a story. A tight cluster only forms when several posts are about
 *  the SAME event, and then it is still one story with several sources. */
export const MIN_CLUSTER = 1
/** Above this a cluster stops being one event. Six posts about six different
 *  releases produced one paragraph that listed all six, which is a list, not a
 *  story. Three is the most that can share a single 280-character body. */
export const MAX_CLUSTER = 3
/** Grouping now means "the same event", not "the same topic", so the bar for
 *  joining is higher than it was when clusters could run to eight. */
export const MIN_SHARED_TERMS = 5

/** Words too common in this corpus to distinguish one story from another. */
const STOPWORDS = new Set(
  `the a an and or but if then than that this these those for with without from into
   your you our we they it its is are was were be been being do does did doing have
   has had can will just now new more most some any all how what when why who which
   about over under out up down off on in at by to of as so no not one two three
   skill skills agent agents claude code codex cursor anthropic openai model models
   like get make use using used run runs running build built building work works
   really very much many people i'm it's don't you're here there also because`
    .split(/\s+/)
    .filter(Boolean),
)

/** Significant terms in a post: entities, skill names, distinctive vocabulary. */
export function terms(post) {
  const out = new Set()
  for (const skill of post.skills ?? []) out.add(`skill:${skill.slug.toLowerCase()}`)
  for (const c of post.collections ?? []) out.add(`owner:${(c.repoOwner ?? c.author).toLowerCase()}`)
  for (const repo of post.repos ?? []) out.add(`repo:${repo.toLowerCase()}`)
  if (post.unknownSkill) out.add(`skill:${post.unknownSkill.toLowerCase()}`)
  for (const raw of post.text.toLowerCase().match(/[a-z][a-z0-9.'-]{3,}/g) ?? []) {
    const word = raw.replace(/[.'-]+$/, '')
    if (word.length >= 5 && !STOPWORDS.has(word)) out.add(word)
  }
  return out
}

function overlap(a, b) {
  let n = 0
  for (const t of a) if (b.has(t)) n += 1
  return n
}

/**
 * Group posts that are about the same thing.
 *
 * Average-link, not single-link. Single-link chains: a post joins if it matches
 * ANY member, so A-B-C-D collects even when A and D share nothing, and a dry run
 * over one real day produced a 23-post "story" spanning scandi CSS, model
 * choice, and a free course. Requiring a post to match a MAJORITY of the cluster
 * keeps a cluster about one subject.
 *
 * Grouping is deliberately reluctant. A cluster is several posts about the same
 * event, not several posts about the same area: when six unrelated releases
 * grouped, the only summary true of all six was a list of six things, which is
 * what a reader skips. Posts that do not group become their own story instead.
 */
export function cluster(posts) {
  const withTerms = posts.map((post) => ({ post, terms: terms(post) }))
  const groups = []
  for (const entry of withTerms) {
    const home = groups.find((g) => {
      if (g.length >= MAX_CLUSTER) return false
      const agree = g.filter((m) => overlap(m.terms, entry.terms) >= MIN_SHARED_TERMS).length
      return agree * 2 >= g.length
    })
    if (home) home.push(entry)
    else groups.push([entry])
  }
  return groups
    .filter((g) => g.length >= MIN_CLUSTER)
    .map((g) => g.map((e) => e.post))
    .sort((a, b) => reach(b) - reach(a))
}

export const reach = (posts) => posts.reduce((n, p) => n + (p.likes ?? 0), 0)

/** Majority rules, so one stray post cannot move a cluster to the other queue.
 *  `isSkill` is set per post by the classification pass in the drafting script;
 *  a pattern match cannot do this job. "This Claude Code skill decompiles APKs"
 *  and "OpenClaw vs Hermes, all three let you set up skills" share almost every
 *  surface feature and belong in different queues. */
const isSkillCluster = (posts) => posts.filter((p) => p.isSkill).length * 2 >= posts.length

/**
 * The day's stories, best first within each queue.
 *
 * Skills and news are ranked SEPARATELY and then merged. In one pool skill
 * posts simply out-like news posts, and a real day produced fourteen skills and
 * zero news: the brief lost half its subject matter to an arithmetic accident.
 * Each queue gets its own slots and its own ordering.
 *
 * The queue is decided here, before generation, because ranking has to happen
 * before anything is written. The writer still picks the final kind on its own;
 * a disagreement costs nothing, since the queue only decides which stories
 * compete with each other for slots.
 *
 * Ranking inside a queue is by the loudest post rather than summed reach, which
 * keeps a genuine three-source event from outranking a bigger single one purely
 * on arithmetic.
 */
export function storyCandidates(posts, { skills = 8, news = 6 } = {}) {
  const byReach = (a, b) => loudest(b) - loudest(a) || reach(b) - reach(a)
  const groups = cluster(posts)
  const skillQueue = groups.filter(isSkillCluster).sort(byReach).slice(0, skills)
  const newsQueue = groups.filter((g) => !isSkillCluster(g)).sort(byReach).slice(0, news)
  // Interleaved rather than concatenated, so a reader scrolling the feed does
  // not hit a block of one type followed by a block of the other.
  const out = []
  for (let i = 0; i < Math.max(skillQueue.length, newsQueue.length); i++) {
    if (skillQueue[i]) out.push(skillQueue[i])
    if (newsQueue[i]) out.push(newsQueue[i])
  }
  return out
}

const loudest = (posts) => Math.max(...posts.map((p) => p.likes ?? 0))


/**
 * Put an @ on every handle the story names.
 *
 * The writer mixes `@MiaAI_lab` and a bare `rohanpaul_ai` in one paragraph, and
 * a bare handle reads as a misspelled word rather than a person. Deterministic
 * here rather than another prompt rule: the set of handles a story may name is
 * exactly its own sources, so this is a lookup, not a judgement.
 */
export function normalizeHandles(text, sources) {
  let out = text
  for (const handle of new Set(sources.map((s) => s.handle).filter(Boolean))) {
    // Skip when already @-prefixed or part of a longer token. The trailing
    // guard has to allow a sentence-ending "@j_maffe." while rejecting
    // "rohanpaul_ai.com" and "x.com/j_maffe", so it rejects a dot only when a
    // word character follows it.
    const re = new RegExp(
      `(^|[^@\\w/.])${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w/@-]|\\.\\w)`,
      'g',
    )
    out = out.replace(re, `$1@${handle}`)
  }
  return out
}
