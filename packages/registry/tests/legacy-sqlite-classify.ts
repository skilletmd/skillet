// Quarantined sqlite classify helpers for characterization under tests/ (U5).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { queryOne } from './legacy-sqlite-query.js'
import {
  classifySkill,
  type ClassifyInput,
} from '../src/classify/index.js'

export type { ClassifyInput }
export { classifySkill, firstCategoryIn } from '../src/classify/index.js'

export async function classifyAndStore(
  db: DatabaseSync,
  skillId: string,
  input: ClassifyInput,
): Promise<boolean> {
  const category = await classifySkill(input)
  if (!category) return false
  try {
    db.prepare('UPDATE skills SET category = ? WHERE id = ?').run(category, skillId)
    return true
  } catch {
    return false
  }
}

export function readStoredSkillMd(db: DatabaseSync, skillId: string): string {
  const skill = queryOne<{ latest_hash: string | null }>(
    db,
    'SELECT latest_hash FROM skills WHERE id = ?',
    skillId,
  )
  if (!skill?.latest_hash) return ''
  const bare = skill.latest_hash.startsWith('sha256:')
    ? skill.latest_hash.slice('sha256:'.length)
    : skill.latest_hash
  const row = queryOne<{ bytes: Uint8Array | Buffer | null }>(
    db,
    `SELECT b.bytes FROM skill_version_files f
       JOIN blobs b ON b.hash = f.blob_hash
       WHERE f.skill_id = ? AND (f.version_hash = ? OR f.version_hash = ?) AND f.path = 'SKILL.md'`,
    skillId,
    bare,
    `sha256:${bare}`,
  )
  if (!row?.bytes || row.bytes.byteLength === 0) return ''
  return Buffer.from(row.bytes).toString('utf8')
}

export async function classifyUncategorizedSkills(
  db: DatabaseSync,
  rows: Array<{ id: string; slug: string; description: string | null }>,
): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY || rows.length === 0) return 0
  let classified = 0
  for (const row of rows) {
    const current = queryOne<{ category: string | null }>(
      db,
      'SELECT category FROM skills WHERE id = ?',
      row.id,
    )
    if (!current || current.category != null) continue
    const body = readStoredSkillMd(db, row.id)
    const stored = await classifyAndStore(db, row.id, {
      slug: row.slug,
      description: row.description,
      body,
    })
    if (stored) classified++
  }
  return classified
}
