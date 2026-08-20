// Platform admin checks. A user is a platform admin if their `users.is_admin`
// flag is set OR their handle is named in the `SKILLET_ADMIN_HANDLES` env
// allowlist (comma-separated). The env path bootstraps the first admins before
// anyone can be flagged in the DB. Distinct from org roles (org-scoped).
import type { PrismaDb } from '../db/prisma-client.js'

/** Parse `SKILLET_ADMIN_HANDLES` into a set of bare, lowercased handles. */
export function parseAdminHandles(raw: string | undefined): Set<string> {
  const out = new Set<string>()
  if (!raw) return out
  for (const part of raw.split(',')) {
    const h = part.trim().replace(/^@/, '').toLowerCase()
    if (h) out.add(h)
  }
  return out
}

/** Parse `SKILLET_ADMIN_USER_IDS` into a set of stable registry user ids. */
export function parseAdminUserIds(raw: string | undefined): Set<string> {
  const out = new Set<string>()
  if (!raw) return out
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (id) out.add(id)
  }
  return out
}

function isAdminFromRow(
  row: { is_admin: number; handle: string | null } | null | undefined,
): boolean {
  if (!row) return false
  if (row.is_admin === 1) return true

  if (row.handle) {
    const allow = parseAdminHandles(process.env.SKILLET_ADMIN_HANDLES)
    if (allow.has(row.handle.toLowerCase())) return true
  }
  return false
}

/** True when the user is a platform admin (DB flag or env allowlist). */
export async function isAdminUserPrisma(prisma: PrismaDb, userId: string): Promise<boolean> {
  const allowIds = parseAdminUserIds(process.env.SKILLET_ADMIN_USER_IDS)
  if (allowIds.has(userId)) return true

  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { is_admin: true, handle: true },
  })
  return isAdminFromRow(row)
}
