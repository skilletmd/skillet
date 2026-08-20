// Quarantined sqlite github-token helpers for characterization under tests/ (U5).
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { queryOne } from './legacy-sqlite-query.js'
import { encryptToken, decryptToken } from '../src/sync/repo-auth.js'

export function storeUserGithubToken(db: DatabaseSync, userId: string, rawToken: string): void {
  const token = rawToken.trim()
  if (!token) return
  db.prepare(
    `INSERT INTO user_github_tokens (user_id, token_enc, updated_at)
       VALUES (?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       token_enc = excluded.token_enc,
       updated_at = excluded.updated_at`,
  ).run(userId, encryptToken(token))
}

export function getUserGithubToken(db: DatabaseSync, userId: string): string | null {
  const row = queryOne<{ token_enc: string }>(
    db,
    `SELECT token_enc FROM user_github_tokens WHERE user_id = ?`,
    userId,
  )
  if (!row?.token_enc) return null
  try {
    return decryptToken(row.token_enc)
  } catch {
    return null
  }
}

export function userHasGithubToken(db: DatabaseSync, userId: string): boolean {
  const row = queryOne<{ ok: number }>(
    db,
    `SELECT 1 AS ok FROM user_github_tokens WHERE user_id = ? LIMIT 1`,
    userId,
  )
  return row?.ok === 1
}
