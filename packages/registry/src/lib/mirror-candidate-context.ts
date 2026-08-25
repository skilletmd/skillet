// Decision context for a mirror review-queue candidate.
//
// The queue told an admin a candidate scored 84/100 across 24 skills. It did
// not tell them WHAT those 24 skills are, so every real decision started by
// opening GitHub. The names and descriptions were already being read — the
// quality rubric parses them to score description quality — and then thrown
// away with the text it scored.
//
// This captures them instead, at screen time, for both callers that create a
// queue row (the nightly discovery sweep and the admin URL submit) so a pasted
// candidate carries the same context as a discovered one.
//
// Capture is deliberately NOT the rubric's sample. `MAX_SKILL_SAMPLES = 5`
// bounds what gets SCORED, because scoring 57 skills would not move the score;
// listing 5 of 57 names would misrepresent the candidate outright.
import type { PrismaClient } from '@prisma/client'
import { parseFrontmatter } from '../sync/sync-repo.js'
import { fetchSkillMd, type QualityInput } from './mirror-quality.js'
import { guessCategory } from '../classify/heuristic.js'
import {
  bestOverlap,
  buildOverlapIndex,
  loadPublicCatalogPrisma,
  type OverlapIndex,
} from './mirror-overlap.js'

export interface CapturedSkill {
  /** Skill directory path inside the repo; '' for a single-skill repo root. */
  slug: string
  name: string | null
  description: string | null
  /**
   * Pre-decision guess only. The AI classifier still decides the STORED
   * category after approval, exactly where it does today — this runs before the
   * decision because running a model over every skill of every candidate in a
   * 64-row queue costs real money to inform a call the heuristic informs well
   * enough.
   */
  category: string | null
  /** "author/slug" of the closest public skill the catalog already has. */
  overlapRef?: string | null
  overlapScore?: number | null
}

/**
 * Concurrent SKILL.md fetches. One request per skill is the real cost here, and
 * these go to raw.githubusercontent.com — a CDN that does not draw on the
 * 5,000/hr GitHub API quota the rest of the sweep spends.
 */
const CAPTURE_CONCURRENCY = 8

/** Display name for a skill whose frontmatter gave us nothing. */
export function slugLeaf(slug: string): string {
  const leaf = slug.split('/').filter(Boolean).pop()
  return leaf ?? ''
}

/**
 * Read every skill in the candidate repo. Takes the listing the quality pass
 * already fetched rather than re-walking the tree.
 *
 * A skill whose SKILL.md is unreachable or has unparseable frontmatter is
 * captured by slug with null name and description — never dropped. A candidate
 * that lists 57 skills and shows 54 would be lying about its own size, which is
 * worse than showing three rows that say only where they live.
 *
 * Returns null when NOTHING could be read: a repo full of nameless rows is not
 * context, it is noise wearing context's shape, and the caller leaves
 * `skills_captured_at` null so the queue can say "not captured" honestly.
 * A partial read still writes — one unreachable skill out of 57 is a fact about
 * that skill, not a failure of the pass.
 */
export async function captureCandidateSkills(
  input: QualityInput & { ref: string; dirs: string[] },
): Promise<CapturedSkill[] | null> {
  const { ref, dirs } = input
  const out: CapturedSkill[] = []
  let readable = 0
  for (let i = 0; i < dirs.length; i += CAPTURE_CONCURRENCY) {
    const batch = dirs.slice(i, i + CAPTURE_CONCURRENCY)
    const mds = await Promise.all(batch.map((dir) => fetchSkillMd(input, ref, dir)))
    batch.forEach((slug, n) => {
      const md = mds[n]
      if (typeof md === 'string') readable += 1
      const fm = typeof md === 'string' ? parseFrontmatter(md) : {}
      const name = fm.name?.trim() || null
      const description = fm.description?.trim() || null
      out.push({
        slug,
        name,
        description,
        // The leaf, not the path: a nested `skills/pr-reviewer` would otherwise
        // feed the classifier the word "skills", which is not evidence of
        // anything. `name` goes in as the title because it is the strongest
        // text we have and we already captured it.
        category: guessCategory({ slug: slugLeaf(slug), title: name, description }),
      })
    })
  }
  if (out.length > 0 && readable === 0) return null
  return out
}

/**
 * Replace a candidate's captured skills and stamp the queue row.
 *
 * Replace, not merge: a re-screen reads the repo as it is now, and a skill the
 * author deleted must not survive as a row nobody will ever remove.
 */
export async function writeCandidateSkills(
  prisma: PrismaClient,
  queueId: string,
  skills: CapturedSkill[],
): Promise<void> {
  await prisma.mirror_candidate_skills.deleteMany({ where: { queue_id: queueId } })
  if (skills.length > 0) {
    await prisma.mirror_candidate_skills.createMany({
      data: skills.map((s) => ({
        queue_id: queueId,
        slug: s.slug.slice(0, 255),
        name: s.name,
        description: s.description,
        category: s.category,
        overlap_ref: s.overlapRef ?? null,
        overlap_score: s.overlapScore ?? null,
      })),
    })
  }
  await prisma.mirror_review_queue.update({
    where: { id: queueId },
    data: {
      skills_captured_at: Math.floor(Date.now() / 1000),
      category_summary: summarizeCategories(skills),
    },
  })
}

/**
 * Category key to skill count, for the queue row. Counts SKILLS, not
 * directories, and omits the unplaceable rather than counting them under a
 * category named "null" — an admin reading "null: 4" learns nothing, and a
 * summary that adds up to fewer than the skill count is the honest shape.
 */
export function summarizeCategories(skills: CapturedSkill[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of skills) {
    if (!s.category) continue
    out[s.category] = (out[s.category] ?? 0) + 1
  }
  return out
}

/**
 * Capture and store a candidate's context. Best-effort by design: a GitHub
 * failure mid-capture leaves the queue row intact with `skills_captured_at`
 * null. The candidate is still reviewable, just without names — losing the
 * candidate over a missing description would be the worse trade.
 */
export async function recordCandidateContext(
  prisma: PrismaClient,
  queueId: string,
  input: QualityInput & { ref: string | null; dirs: string[] },
  /**
   * Prebuilt catalog index. A sweep passes one built once for the whole run;
   * without it each candidate would re-read 1,365 rows to answer the same
   * question. The URL submit omits it: one candidate, a human waiting.
   */
  overlapIndex?: OverlapIndex,
): Promise<CapturedSkill[] | null> {
  if (!input.ref || input.dirs.length === 0) return null
  try {
    const skills = await captureCandidateSkills({ ...input, ref: input.ref })
    if (!skills) return null
    const index = overlapIndex ?? buildOverlapIndex(await loadPublicCatalogPrisma(prisma))
    for (const skill of skills) {
      const hit = bestOverlap(index, skill)
      skill.overlapRef = hit?.ref ?? null
      skill.overlapScore = hit?.score ?? null
    }
    await writeCandidateSkills(prisma, queueId, skills)
    return skills
  } catch (err) {
    console.warn(
      `  ~ candidate context capture failed for ${input.owner}/${input.repo}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return null
  }
}
