/**
 * Pick what an author's three suggested invocations should be about.
 *
 * Clustering is deliberately heuristic and lives in `src/` because both the
 * backfill script and (later) the server need it. Only the phrasing step needs
 * a model, and that transport stays in `scripts/lib/` — same boundary the
 * category classifier already draws between `src/classify` and
 * `scripts/lib/claude-cli-classify.ts`.
 *
 * The output is clusters plus one representative skill each, so the phrase the
 * model writes is always traceable to a skill that exists. That is what makes
 * "every suggestion resolves" a property of the pipeline rather than a hope.
 */
import { MAX_SUMMON_SUGGESTIONS, guessCategory } from '@skillet/protocol'

/** A public skill, as clustering needs it. */
export interface ClusterableSkill {
  ref: string
  slug: string
  description: string | null
  category: string | null
  install_count?: number
  summon_count?: number
  created_at?: number
}

export interface SuggestionCluster {
  category: string
  size: number
  /** The skill whose description the phrasing step reads. */
  representative: ClusterableSkill
  /**
   * The cluster's top few skills, best-ranked first, `representative` included.
   *
   * The phrasing step chooses among these rather than being handed one. Rank
   * alone picks the WRONG skill often enough to matter: the most-adopted skill
   * in a cluster is very often the kit's own plumbing — a setup step, an
   * install guide, a help card, a shared-patterns module — and none of those
   * has a task a stranger would ever type. Ranked first on production:
   * `caveman-help` ("quick-reference card for all modes"), `gws-shared`
   * ("shared patterns for authentication, global flags"), `codex` ("OpenAI
   * Codex CLI wrapper"). Faithfully phrased, those produce "show caveman
   * commands" and "run codex", which are the tool's name, not anyone's want.
   *
   * Giving the model the runners-up lets it skip past the plumbing to a real
   * piece of work. `representative` stays the fallback for a pick it cannot
   * make, and every ref still comes from a skill that exists.
   */
  candidates: ClusterableSkill[]
}

/**
 * How many of a cluster's skills the phrasing step gets to choose between.
 *
 * Four, not the whole cluster: past the top few the skills are long-tail and
 * the prompt grows with every author. Enough to get past the plumbing, not
 * enough to turn phrasing into a search.
 */
export const CLUSTER_CANDIDATES = 4

/**
 * A cluster smaller than this is one person's side project, not an area they
 * are known for. Below it, a suggestion says more about our eagerness than
 * about the author.
 */
export const MIN_CLUSTER_SIZE = 3

/**
 * The category to cluster a skill under: its stored one, else a keyword guess.
 *
 * The fallback is load-bearing rather than defensive. Category coverage on
 * production is incomplete and CONCENTRATED — one author's whole 77-skill kit
 * can be uncategorized — so clustering on the stored column alone silently
 * excludes entire authors from ever showing a block, however good their kit is.
 * `guessCategory` is the same heuristic the classifier tries first, so this
 * agrees with what the category backfill would eventually store anyway.
 */
export function effectiveCategory(skill: ClusterableSkill): string | null {
  if (skill.category) return skill.category
  return guessCategory({ slug: skill.slug, description: skill.description })
}

/**
 * Rank an author's skills into at most three clusters.
 *
 * A skill that neither carries nor can be guessed a category is dropped rather
 * than pooled: "uncategorized" is not a thing anyone summons someone for, and a
 * cluster of them would produce a representative with nothing in common with
 * its peers.
 */
export function clusterSkills(
  skills: ClusterableSkill[],
  opts: { minClusterSize?: number; max?: number } = {},
): SuggestionCluster[] {
  const minSize = opts.minClusterSize ?? MIN_CLUSTER_SIZE
  const max = opts.max ?? MAX_SUMMON_SUGGESTIONS

  const byCategory = new Map<string, ClusterableSkill[]>()
  for (const skill of skills) {
    const category = effectiveCategory(skill)
    if (!category) continue
    const bucket = byCategory.get(category)
    if (bucket) bucket.push(skill)
    else byCategory.set(category, [skill])
  }

  const clusters: SuggestionCluster[] = []
  for (const [category, members] of byCategory) {
    if (members.length < minSize) continue
    const ranked = rankMembers(members)
    clusters.push({
      category,
      size: members.length,
      representative: ranked[0]!,
      candidates: ranked.slice(0, CLUSTER_CANDIDATES),
    })
  }

  // Bigger cluster first; ties broken by category name so the same kit always
  // produces the same three lines.
  clusters.sort((a, b) => b.size - a.size || (a.category < b.category ? -1 : 1))
  return clusters.slice(0, max)
}

/**
 * The skill that speaks for a cluster: most adopted, then most summoned, then
 * newest, then by ref. Adoption first because a suggestion is a recommendation,
 * and the skill other people already chose is the safest one to put a stranger
 * in front of.
 */
export function pickRepresentative(members: ClusterableSkill[]): ClusterableSkill {
  return rankMembers(members)[0]!
}

/** The same order `pickRepresentative` reads its answer off the front of. */
export function rankMembers(members: ClusterableSkill[]): ClusterableSkill[] {
  return [...members].sort(
    (a, b) =>
      (b.install_count ?? 0) - (a.install_count ?? 0) ||
      (b.summon_count ?? 0) - (a.summon_count ?? 0) ||
      (b.created_at ?? 0) - (a.created_at ?? 0) ||
      (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
  )
}

/**
 * Whether a model-written phrase is fit to publish under someone's name.
 *
 * The descriptions feeding the phrasing prompt are author-written text from
 * mirrored repos, which is the same hostile surface the scanner exists for. A
 * live probe showed the fencing holds, but one passing probe is not a control;
 * this is. Anything that reads like a link, an instruction, an address, or
 * markup is rejected outright rather than cleaned, because a phrase we had to
 * repair is a phrase we do not understand.
 */
export function isPublishablePhrase(phrase: string): boolean {
  const task = phrase.trim()
  if (task.length < 2 || task.length > 40) return false

  // One line. A phrase that wrapped is a phrase that said more than a task.
  if (/[\r\n]/.test(task)) return false

  // Links, markup, handles, emails, and code fences: none of these belong in
  // "redo my site", and all of them are what an injected description asks for.
  if (/https?:|www\.|@|<|>|`|\[|\]|\(|\)|\{|\}|\||\\/.test(task)) return false

  // Letters, digits, spaces, and the two joiners a real task phrase uses.
  if (!/^[a-z0-9][a-z0-9 '-]*$/.test(task)) return false

  // "install my package", "run this", "click here" — imperative-shaped but
  // about us or about following a link rather than about the author's work.
  if (/\b(install|download|visit|click|subscribe|buy|ignore|disregard)\b/.test(task)) return false

  return task.split(/\s+/).length <= 6
}
