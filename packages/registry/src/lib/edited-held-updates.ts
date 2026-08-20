// Prisma async counterpart of editedHeldUpdates (pre-cutover AE2/AE6 semantics).
import { toSkillId, type SkillId } from '@skillet/protocol/skill-id'
import type { PrismaDb } from '../db/prisma-client.js'
import { listUserSkillEditsPrisma } from '../routes/device-skill-edits.js'
import { resolvedTargetsPrisma } from './pending-update-targets.js'

/** One held update on one edited device: the skill an upstream version is waiting
 *  for, scoped to the specific device that carries the local edit. */
export interface EditedHeldUpdate {
  skill_id: SkillId
  author_id: string
  slug: string
  to_hash: string
  baseline_hash: string
  baseline_version: string | null
  device_id: string
  device_label: string | null
  device_last_seen_at: number | null
  edited_at: number
  /** True when the author has shipped a newer version being held (Upgrade is
   *  offered). False for an edit-only row: the skill is edited locally but no
   *  upstream update is waiting, so the web shows it without an Upgrade action. */
  has_upstream: boolean
}

/** Compare content hashes ignoring an optional `sha256:` prefix. */
function sameHash(a: string, b: string): boolean {
  const strip = (h: string): string => (h.startsWith('sha256:') ? h.slice(7) : h)
  return strip(a) === strip(b)
}

/**
 * Per-(skill, edited device) rows for the "Skills you've edited" section.
 * Edit-only when baseline matches the current target (`has_upstream: false`);
 * Upgrade when the author shipped a newer hash (`has_upstream: true`), unless
 * that exact target is already approved.
 */
export async function editedHeldUpdatesPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<EditedHeldUpdate[]> {
  const edits = await listUserSkillEditsPrisma(prisma, userId)
  if (edits.length === 0) return []

  const targets = new Map(
    (await resolvedTargetsPrisma(prisma, userId)).map((t) => [t.skill_id as string, t]),
  )
  const out: EditedHeldUpdate[] = []

  for (const e of edits) {
    const sid = toSkillId(e.skill_id)
    const t = targets.get(sid)
    if (!t) continue

    const hasUpstream = !sameHash(t.to_hash, e.baseline_hash)
    if (hasUpstream) {
      const decided = await prisma.update_decisions.findFirst({
        where: {
          user_id: userId,
          skill_id: e.skill_id,
          version_hash: t.to_hash,
          state: 'approved',
        },
        select: { id: true },
      })
      if (decided) continue
    }

    const dev = await prisma.devices.findUnique({
      where: { id: e.device_id },
      select: { label: true, last_seen_at: true },
    })

    out.push({
      skill_id: sid,
      author_id: t.author_id,
      slug: t.slug,
      to_hash: t.to_hash,
      baseline_hash: e.baseline_hash,
      baseline_version: e.baseline_version,
      device_id: e.device_id,
      device_label: dev?.label ?? null,
      device_last_seen_at: dev?.last_seen_at ?? null,
      edited_at: e.edited_at,
      has_upstream: hasUpstream,
    })
  }

  return out
}
