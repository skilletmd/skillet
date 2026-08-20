// Quarantined sqlite skill-install helpers for characterization under tests/ (U4).
import { createHash } from 'node:crypto'
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import type { Principal } from '../src/auth/middleware.js'
import { followSubject } from './legacy-sqlite-db-helpers.js'
import { queryOne } from './legacy-sqlite-query.js'
import { bumpAttentionForHandle } from './legacy-sqlite-attention.js'
import { installerAttestation } from '../src/routes/skill-install.js'

function anonymousInstallerId(clientIp: string, skillId: string): string {
  const day = Math.floor(Date.now() / 1000 / 86_400)
  return createHash('sha256')
    .update(`${clientIp}\0${skillId}\0${day}`)
    .digest('hex')
    .slice(0, 32)
}

export function recordSkillInstall(
  db: DatabaseSync,
  skillId: string,
  principal: Principal | undefined,
  clientIp = 'unknown',
): { recorded: boolean } {
  const { installer_kind, installer_id } = principal
    ? installerAttestation(principal)
    : { installer_kind: 'anonymous' as const, installer_id: anonymousInstallerId(clientIp, skillId) }
  const inserted = db
    .prepare(
      `INSERT INTO skill_installers (skill_id, installer_kind, installer_id, installed_at)
       VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(skill_id, installer_kind, installer_id) DO NOTHING`,
    )
    .run(skillId, installer_kind, installer_id)
  if ((inserted.changes as number) === 0) {
    return { recorded: false }
  }
  db.prepare('UPDATE skills SET install_count = install_count + 1 WHERE id = ?').run(skillId)
  if (installer_kind === 'user') {
    const skill = queryOne<{ author_id: string }>(
      db,
      'SELECT author_id FROM skills WHERE id = ?',
      skillId,
    )
    const actor = queryOne<{ handle: string | null }>(
      db,
      'SELECT handle FROM users WHERE id = ?',
      installer_id,
    )?.handle
    if (skill && actor) {
      bumpAttentionForHandle(db, skill.author_id, {
        kind: 'social',
        social: { kind: 'installed_skill', actor, at: Math.floor(Date.now() / 1000) },
      })
    }
  }
  return { recorded: true }
}

export function autoFollowAuthorOnInstall(
  db: DatabaseSync,
  principal: Principal | undefined,
  authorHandle: string,
): { followed: boolean } {
  const userId =
    principal?.class === 'session'
      ? principal.user_id
      : principal?.class === 'device'
        ? principal.user_id
        : null
  if (!userId) return { followed: false }

  const isSelf = queryOne<{ ok: number }>(
    db,
    'SELECT 1 AS ok FROM users WHERE id = ? AND handle = ?',
    userId,
    authorHandle,
  )
  if (isSelf) return { followed: false }

  const exists = queryOne<{ ok: number }>(
    db,
    'SELECT 1 AS ok FROM authors WHERE id = ?',
    authorHandle,
  )
  if (!exists) return { followed: false }

  try {
    return { followed: followSubject(db, userId, 'author', authorHandle) }
  } catch {
    return { followed: false }
  }
}
