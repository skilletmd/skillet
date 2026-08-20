import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaClient } from '@prisma/client'
import { runPrismaTransaction, type PrismaDb } from '../db/prisma-client.js'
import { resolveSkillRefPrisma } from '../lib/ref-resolution.js'

/**
 * Query helpers for `device_skill_edits` — the per-device edit flag reconciled
 * from the post-sync report. Records only the fact of an edit plus its lineage
 * baseline; no content, filenames, or counts (R2). U4 consumes {@link listDeviceSkillEdits}.
 *
 * Sqlite dual-path bodies were removed in U5. Residual callers get fail-closed
 * stubs; characterization uses tests/legacy-sqlite-device-skill-edits.ts.
 */

const MAX_EDITED = 512
const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/** A single reported edited skill: the ref plus the baseline it was forked from. */
export interface EditedSkillInput {
  skill_id: string
  baseline_version: string | null
  baseline_hash: string
}

export interface DeviceSkillEditRow {
  device_id: string
  user_id: string
  skill_id: string
  baseline_version: string | null
  baseline_hash: string
  edited_at: number
}

/**
 * Validate the device→registry set of currently-customized skills. Accepts only
 * ref + baseline (version optional, hash required); any content-shaped field
 * (filename, count, body, …) is simply ignored — there is no column to store it.
 * Returns `null` on a malformed payload so the caller can 400.
 */
export function parseEditedSkills(raw: unknown): EditedSkillInput[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw)) return null
  if (raw.length > MAX_EDITED) return null
  const out: EditedSkillInput[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const rec = item as Record<string, unknown>
    const skillId = rec.skill_id ?? rec.ref
    if (typeof skillId !== 'string' || skillId.length === 0 || skillId.length > 200) return null
    const baselineHash = rec.baseline_hash ?? rec.baselineHash
    if (typeof baselineHash !== 'string' || baselineHash.length === 0 || baselineHash.length > 200) {
      return null
    }
    const baselineVersionRaw = rec.baseline_version ?? rec.baselineVersion
    const baselineVersion =
      typeof baselineVersionRaw === 'string' && baselineVersionRaw.length > 0
        ? baselineVersionRaw.slice(0, 100)
        : null
    if (seen.has(skillId)) continue
    seen.add(skillId)
    out.push({ skill_id: skillId, baseline_version: baselineVersion, baseline_hash: baselineHash })
  }
  return out
}

function refToAuthorSlug(ref: string): { author: string; slug: string } | null {
  const s = ref.trim().replace(/^@/, '')
  const slash = s.indexOf('/')
  const colon = s.indexOf(':')
  let idx = -1
  if (slash >= 0 && (colon < 0 || slash < colon)) idx = slash
  else if (colon >= 0) idx = colon
  if (idx <= 0) return null
  const author = s.slice(0, idx)
  const slug = s.slice(idx + 1)
  if (!author || !slug) return null
  return { author, slug }
}

async function resolveEditedSkillIdPrisma(prisma: PrismaDb, ref: string): Promise<string | null> {
  const parts = refToAuthorSlug(ref)
  if (!parts) return null
  return (await resolveSkillRefPrisma(prisma, parts.author, parts.slug))?.skillId ?? null
}

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-device-skill-edits.ts. */
export function reconcileDeviceSkillEdits(
  _db: DatabaseSync,
  _deviceId: string,
  _userId: string,
  _reported: EditedSkillInput[],
  _now?: number,
): number {
  throw new Error(`${SQLITE_REMOVED}: reconcileDeviceSkillEditsPrisma`)
}

/**
 * Prisma async counterpart of {@link reconcileDeviceSkillEdits}.
 * We resolve refs first, then replace the device's rows with that exact set
 * (clear + insert) so absence still clears the flag.
 */
export async function reconcileDeviceSkillEditsPrisma(
  prisma: PrismaClient,
  deviceId: string,
  userId: string,
  reported: EditedSkillInput[],
  now: number = Math.floor(Date.now() / 1000),
): Promise<number> {
  const edited: EditedSkillInput[] = []
  const seen = new Set<string>()
  for (const e of reported) {
    const skillId = await resolveEditedSkillIdPrisma(prisma, e.skill_id)
    if (!skillId || seen.has(skillId)) continue
    seen.add(skillId)
    edited.push({ ...e, skill_id: skillId })
  }

  await runPrismaTransaction(prisma, async (tx) => {
    await tx.device_skill_edits.deleteMany({ where: { device_id: deviceId } })
    if (edited.length === 0) return
    await tx.device_skill_edits.createMany({
      data: edited.map((e) => ({
        device_id: deviceId,
        user_id: userId,
        skill_id: e.skill_id,
        baseline_version: e.baseline_version,
        baseline_hash: e.baseline_hash,
        edited_at: now,
      })),
    })
  })

  return edited.length
}

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-device-skill-edits.ts. */
export function listDeviceSkillEdits(
  _db: DatabaseSync,
  _deviceId: string,
): DeviceSkillEditRow[] {
  throw new Error(`${SQLITE_REMOVED}: listDeviceSkillEditsPrisma`)
}

/** Prisma async counterpart of {@link listDeviceSkillEdits}. */
export async function listDeviceSkillEditsPrisma(
  prisma: PrismaDb,
  deviceId: string,
): Promise<DeviceSkillEditRow[]> {
  return prisma.device_skill_edits.findMany({
    where: { device_id: deviceId },
    orderBy: { edited_at: 'desc' },
    select: {
      device_id: true,
      user_id: true,
      skill_id: true,
      baseline_version: true,
      baseline_hash: true,
      edited_at: true,
    },
  })
}

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-device-skill-edits.ts. */
export function listUserSkillEdits(_db: DatabaseSync, _userId: string): DeviceSkillEditRow[] {
  throw new Error(`${SQLITE_REMOVED}: listUserSkillEditsPrisma`)
}

/** Prisma async counterpart of {@link listUserSkillEdits}. */
export async function listUserSkillEditsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<DeviceSkillEditRow[]> {
  return prisma.device_skill_edits.findMany({
    where: { user_id: userId },
    orderBy: { edited_at: 'desc' },
    select: {
      device_id: true,
      user_id: true,
      skill_id: true,
      baseline_version: true,
      baseline_hash: true,
      edited_at: true,
    },
  })
}
