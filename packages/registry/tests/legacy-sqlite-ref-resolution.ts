// Quarantined sqlite ref-resolution helpers for characterization under tests/ (U3).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { toSkillId } from '@skillet/protocol/skill-id'
import { queryOne } from './legacy-sqlite-query.js'
import type { ResolvedSkillRef } from '../src/lib/ref-resolution.js'

export function resolveHandle(db: DatabaseSync, handle: string): string {
  let current = handle
  const seen = new Set<string>()
  for (let i = 0; i < 32; i++) {
    const row = queryOne<{ new_handle: string }>(
      db,
      'SELECT new_handle FROM handle_aliases WHERE old_handle = ?',
      current,
    )
    if (!row) return current
    if (seen.has(current)) return current
    seen.add(current)
    current = row.new_handle
  }
  return current
}

function expandSkillAliasChain(db: DatabaseSync, startId: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  let current = startId
  for (let i = 0; i < 32; i++) {
    if (seen.has(current)) break
    seen.add(current)
    ids.push(current)
    const row = queryOne<{ to_skill_id: string }>(
      db,
      'SELECT to_skill_id FROM skill_aliases WHERE from_skill_id = ?',
      current,
    )
    if (!row) break
    current = row.to_skill_id
  }
  return ids
}

export function resolveSkillRef(
  db: DatabaseSync,
  author: string,
  slug: string,
): ResolvedSkillRef | null {
  const requestedId = `${author}:${slug}`
  const canonicalAuthor = resolveHandle(db, author)

  const candidateIds = new Set<string>()
  for (const id of expandSkillAliasChain(db, requestedId)) {
    candidateIds.add(id)
  }
  for (const id of expandSkillAliasChain(db, `${canonicalAuthor}:${slug}`)) {
    candidateIds.add(id)
  }
  candidateIds.add(`${canonicalAuthor}:${slug}`)

  for (const skillId of candidateIds) {
    const row = queryOne<{ author_id: string; slug: string }>(
      db,
      'SELECT author_id, slug FROM skills WHERE id = ?',
      skillId,
    )
    if (row) {
      return {
        skillId: toSkillId(skillId),
        author: row.author_id,
        slug: row.slug,
        redirected: skillId !== requestedId || row.author_id !== author || row.slug !== slug,
      }
    }
  }
  return null
}

export function registerHandleAlias(
  db: DatabaseSync,
  oldHandle: string,
  newHandle: string,
): void {
  db.prepare(
    `INSERT INTO handle_aliases (old_handle, new_handle, created_at)
     VALUES (?, ?, unixepoch())
     ON CONFLICT(old_handle) DO UPDATE SET new_handle = excluded.new_handle`,
  ).run(oldHandle, newHandle)
}

export function registerSkillAlias(
  db: DatabaseSync,
  fromSkillId: string,
  toSkillId: string,
): void {
  db.prepare(
    `INSERT INTO skill_aliases (from_skill_id, to_skill_id, created_at)
     VALUES (?, ?, unixepoch())
     ON CONFLICT(from_skill_id) DO UPDATE SET to_skill_id = excluded.to_skill_id`,
  ).run(fromSkillId, toSkillId)
}
