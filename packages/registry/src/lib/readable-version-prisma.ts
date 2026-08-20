// Prisma counterpart of resolveReadableVersion (version-scoped serve gates).
import type { PrismaDb } from '../db/prisma-client.js'
import { canReadSkillPrisma } from '../auth/skill-read-access.js'
import { normalizeVersionHash, resolveSkillRefPrisma } from './ref-resolution.js'
import {
  serveBlockForModerationPrisma,
  serveBlockForScanPrisma,
} from '../routes/serve-guards.js'

export type ReadableVersionPrismaResult =
  | {
      ok: true
      hash: string
      skillId: string
      visibility: string
      canonAuthor: string
      canonSlug: string
    }
  | { ok: false; status: number; body?: unknown }

/** Shared serve-gates for version-scoped Prisma reads. */
export async function resolveReadableVersionPrisma(
  prisma: PrismaDb,
  principal: Parameters<typeof canReadSkillPrisma>[1],
  author: string,
  slug: string,
  hashParam: string,
): Promise<ReadableVersionPrismaResult> {
  const rawHash = normalizeVersionHash(hashParam)
  // Resolve the skill FIRST, then scope the version lookup to it (#472).
  // Querying skill_versions by hash alone (findFirst, no scope) picks
  // arbitrarily when two skills share a content hash, which could 404 a
  // legitimate read (flaky denial). Scoping by the resolved skill_id makes the
  // lookup deterministic and removes the cross-skill ambiguity.
  const resolved = await resolveSkillRefPrisma(prisma, author, slug)
  if (!resolved) {
    return { ok: false, status: 404, body: { error: 'Version not found' } }
  }

  const version = await prisma.skill_versions.findFirst({
    where: {
      skill_id: resolved.skillId,
      OR: [{ hash: rawHash }, { hash: `sha256:${rawHash}` }],
    },
    select: { hash: true, skill_id: true, yanked_at: true },
  })
  if (!version) {
    return { ok: false, status: 404, body: { error: 'Version not found' } }
  }

  const skillRow = await prisma.skills.findUnique({
    where: { id: version.skill_id },
    select: { visibility: true, author_id: true, slug: true },
  })
  if (
    !skillRow ||
    !(await canReadSkillPrisma(prisma, principal, version.skill_id, skillRow.visibility))
  ) {
    return { ok: false, status: 404, body: { error: 'Version not found' } }
  }

  if (version.yanked_at) {
    return { ok: false, status: 404, body: { error: 'Version not found' } }
  }

  const modBlock = await serveBlockForModerationPrisma(prisma, version.skill_id)
  if (modBlock) {
    return { ok: false, status: modBlock.status, body: modBlock.body }
  }

  const scanBlock = await serveBlockForScanPrisma(prisma, version.hash)
  if (scanBlock) {
    return { ok: false, status: scanBlock.status, body: scanBlock.body }
  }

  return {
    ok: true,
    hash: version.hash,
    skillId: version.skill_id,
    visibility: skillRow.visibility,
    canonAuthor: skillRow.author_id,
    canonSlug: skillRow.slug,
  }
}
