// Single-skill SkillSummaryRow load for MySQL/Prisma (U4 skill detail/catalog).
import type { PrismaDb } from '../db/prisma-client.js'
import type { SkillSummaryRow } from '../routes/skill-summary.js'

/** Load one skill summary by id (same joins as SKILL_SUMMARY_SELECT). */
export async function loadSkillSummaryByIdPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<SkillSummaryRow | null> {
  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: {
      id: true,
      author_id: true,
      slug: true,
      description: true,
      visibility: true,
      latest_hash: true,
      install_count: true,
      created_at: true,
      category: true,
      moderation_status: true,
    },
  })
  if (!skill) return null

  const [versionCount, latest, user, scan] = await Promise.all([
    prisma.skill_versions.count({ where: { skill_id: skillId } }),
    skill.latest_hash
      ? prisma.skill_versions.findFirst({
          where: { skill_id: skillId, hash: skill.latest_hash },
          select: {
            major: true,
            minor: true,
            patch: true,
            signature_b64: true,
            signature_key_id: true,
          },
        })
      : Promise.resolve(null),
    prisma.users.findFirst({
      where: { handle: skill.author_id },
      select: { author_key_id: true },
    }),
    skill.latest_hash
      ? prisma.skill_version_scans.findFirst({
          where: {
            skill_id: skillId,
            skill_version_id: skill.latest_hash,
          },
          select: { status: true },
        })
      : Promise.resolve(null),
  ])

  return {
    author_id: skill.author_id,
    slug: skill.slug,
    skill_id: skill.id,
    description: skill.description,
    visibility: skill.visibility === 'public' ? 'public' : 'private',
    latest_hash: skill.latest_hash,
    version: versionCount,
    latest_major: latest?.major ?? null,
    latest_minor: latest?.minor ?? null,
    latest_patch: latest?.patch ?? null,
    install_count: skill.install_count,
    created_at: skill.created_at,
    signature_b64: latest?.signature_b64 ?? null,
    signature_key_id: latest?.signature_key_id ?? null,
    registered_key_id: user?.author_key_id ?? null,
    scan_status: scan?.status ?? null,
    moderation_status: skill.moderation_status,
    category: skill.category,
  }
}
