// A merged skill's sources, carried by its published version (kit map plan
// U15, KTD14; R23 R25, AE5).
//
// A merge's sources live with its private backup (origin `merge`, written by
// the computer that wrote the merge). Publishing those exact bytes copies them
// into the new version's metadata as `merged_from`: the public sources by ref
// and name, the private ones only as a count, and never a content hash, so a
// private source leaves no trace. They always come from the publisher's own
// backup, never from the publish body, so nobody can claim a source a merge
// didn't use. A source must still be a public skill to be named, at publish and
// again whenever the page reads it; one made private since is only counted.

import type { PrismaClient } from '@prisma/client'
import { KIT_MAP_NAME_MAX } from '@skillet/protocol/kit-map'
import { tryToSkillId } from '@skillet/protocol/skill-id'

/** What a published merged skill credits. */
export interface MergedFrom {
  sources: Array<{ ref: string; name: string }>
  private: number
}

/** The most sources one merge credits, with room to spare. */
const MAX_SOURCES = 64

type Db = Pick<PrismaClient, 'skill_backups' | 'skills'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `@owner/slug` in its canonical form, as owner and slug, or null. */
function refParts(value: unknown): { owner: string; slug: string } | null {
  if (typeof value !== 'string' || !value.startsWith('@')) return null
  const id = tryToSkillId(value)
  if (id === null || `@${id.replace(':', '/')}` !== value) return null
  const [owner, slug] = id.split(':') as [string, string]
  return { owner, slug }
}

function isName(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > KIT_MAP_NAME_MAX) return false
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false
  }
  return true
}

/** Of these refs, the ones that are public skills right now. */
async function stillPublic(db: Db, refs: readonly string[]): Promise<Set<string>> {
  const parts = refs.flatMap((ref) => {
    const p = refParts(ref)
    return p ? [p] : []
  })
  if (parts.length === 0) return new Set()
  const rows = await db.skills.findMany({
    where: {
      OR: parts.map((p) => ({ author_id: p.owner, slug: p.slug })),
      visibility: 'public',
      moderation_status: { in: ['none', 'unlisted'] },
    },
    select: { author_id: true, slug: true },
  })
  return new Set(rows.map((row) => `@${row.author_id}/${row.slug}`))
}

/** Name the sources that are still public, once each, and count the rest. */
async function credit(db: Db, named: Array<{ ref: string; name: string }>, privateCount: number): Promise<MergedFrom> {
  const open = await stillPublic(db, named.map((source) => source.ref))
  const sources: MergedFrom['sources'] = []
  let hidden = privateCount
  for (const source of named) {
    if (open.has(source.ref) && !sources.some((s) => s.ref === source.ref)) sources.push(source)
    else hidden++
  }
  return { sources, private: hidden }
}

/**
 * The sources a version of these bytes carries when the publisher holds them
 * as a merge backup, or null when they aren't a merge of theirs.
 */
export async function mergedFromBackup(db: Db, userId: string, hash: string): Promise<MergedFrom | null> {
  const backup = await db.skill_backups.findUnique({
    where: { user_id_hash: { user_id: userId, hash } },
    select: { origin: true, sources: true },
  })
  if (backup?.origin !== 'merge' || backup.sources == null) return null
  let raw: unknown
  try {
    raw = JSON.parse(backup.sources) as unknown
  } catch {
    return null
  }
  if (!Array.isArray(raw) || raw.length === 0) return null
  const named: Array<{ ref: string; name: string }> = []
  let privateCount = 0
  for (const source of raw.slice(0, MAX_SOURCES)) {
    if (isRecord(source) && refParts(source.ref) && isName(source.name) && source.private !== true) {
      named.push({ ref: source.ref as string, name: source.name })
    } else privateCount++
  }
  return credit(db, named, privateCount)
}

/**
 * What a version's metadata says it was merged from, re-checked: a source no
 * longer public is only counted. Null when the version isn't a merge.
 */
export async function readMergedFrom(db: Db, metadataJson: string | null): Promise<MergedFrom | null> {
  if (!metadataJson) return null
  let meta: unknown
  try {
    meta = JSON.parse(metadataJson) as unknown
  } catch {
    return null
  }
  const from = isRecord(meta) ? meta.merged_from : undefined
  if (!isRecord(from) || !Array.isArray(from.sources)) return null
  const stored = typeof from.private === 'number' && Number.isSafeInteger(from.private) && from.private >= 0 ? from.private : 0
  const named: Array<{ ref: string; name: string }> = []
  let privateCount = stored
  for (const source of from.sources.slice(0, MAX_SOURCES)) {
    if (isRecord(source) && refParts(source.ref) && isName(source.name)) named.push({ ref: source.ref as string, name: source.name })
    else privateCount++
  }
  if (named.length === 0 && privateCount === 0) return null
  return credit(db, named, privateCount)
}
