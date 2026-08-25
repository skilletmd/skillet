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

export interface CapturedSkill {
  /** Skill directory path inside the repo; '' for a single-skill repo root. */
  slug: string
  name: string | null
  description: string | null
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
      out.push({
        slug,
        name: fm.name?.trim() || null,
        description: fm.description?.trim() || null,
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
      })),
    })
  }
  await prisma.mirror_review_queue.update({
    where: { id: queueId },
    data: { skills_captured_at: Math.floor(Date.now() / 1000) },
  })
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
): Promise<CapturedSkill[] | null> {
  if (!input.ref || input.dirs.length === 0) return null
  try {
    const skills = await captureCandidateSkills({ ...input, ref: input.ref })
    if (!skills) return null
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
