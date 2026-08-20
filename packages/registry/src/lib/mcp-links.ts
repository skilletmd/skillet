// Personal MCP link CRUD + serve-auth for the MySQL/Prisma path (U4).
import type { PrismaClient } from '@prisma/client'
import { asUserId } from '../auth/identity.js'
import type { Principal } from '../auth/middleware.js'
import { classifyToken, hashToken, scopesFor } from '../auth/tokens.js'
import { newId } from '../db/index.js'
import { runPrismaTransaction, type PrismaDb } from '../db/prisma-client.js'

export type ServeAuth =
  | { ok: true; linkId: string; userId: string; handle: string | null; principal: Principal }
  | { ok: false; reason: 'invalid' | 'suspended' }

export interface McpLinkActiveRow {
  id: string
  token_secret_enc: string
  created_at: number
  last_used_at: number | null
}

/**
 * Serve gate: raw token → sha256 → live mcp_links row → users join.
 * Touches last_used_at on success.
 */
export async function resolveServeAuthPrisma(
  prisma: PrismaDb,
  rawToken: string | null,
): Promise<ServeAuth> {
  if (!rawToken || classifyToken(rawToken) !== 'mcp') return { ok: false, reason: 'invalid' }
  const row = await prisma.mcp_links.findFirst({
    where: { token_hash: hashToken(rawToken), revoked_at: null },
    select: {
      id: true,
      user_id: true,
      users: { select: { handle: true, suspended_at: true } },
    },
  })
  if (!row) return { ok: false, reason: 'invalid' }
  if (row.users.suspended_at != null) return { ok: false, reason: 'suspended' }
  const now = Math.floor(Date.now() / 1000)
  await prisma.mcp_links.update({
    where: { id: row.id },
    data: { last_used_at: now },
  })
  return {
    ok: true,
    linkId: row.id,
    userId: row.user_id,
    handle: row.users.handle,
    principal: {
      class: 'mcp',
      mcp_link_id: row.id,
      user_id: asUserId(row.user_id),
      scopes: scopesFor('mcp'),
    },
  }
}

export async function findActiveMcpLinkPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<McpLinkActiveRow | null> {
  return prisma.mcp_links.findFirst({
    where: { user_id: userId, revoked_at: null },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      token_secret_enc: true,
      created_at: true,
      last_used_at: true,
    },
  })
}

export async function listMcpLinkClientsPrisma(
  prisma: PrismaDb,
  linkId: string,
): Promise<Array<{ client: string; last_used_at: number }>> {
  return prisma.mcp_link_clients.findMany({
    where: { link_id: linkId },
    orderBy: { last_used_at: 'desc' },
    select: { client: true, last_used_at: true },
  })
}

export async function revokeActiveMcpLinksPrisma(
  prisma: PrismaDb,
  userId: string,
  now: number,
): Promise<void> {
  await prisma.mcp_links.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: now },
  })
}

/** Mint a link only when none is active (enable race-safe path). */
export async function enableMcpLinkPrisma(
  prisma: PrismaClient,
  userId: string,
  tokenSecretEnc: string,
  tokenHash: string,
  now: number,
): Promise<'minted' | 'existing'> {
  return runPrismaTransaction(prisma, async (tx) => {
    const existing = await findActiveMcpLinkPrisma(tx, userId)
    if (existing) return 'existing'
    await tx.mcp_links.create({
      data: {
        id: newId(),
        user_id: userId,
        token_hash: tokenHash,
        token_secret_enc: tokenSecretEnc,
        created_at: now,
      },
    })
    return 'minted'
  })
}

/** Revoke active + insert replacement in one transaction. */
export async function regenerateMcpLinkPrisma(
  prisma: PrismaClient,
  userId: string,
  tokenSecretEnc: string,
  tokenHash: string,
  now: number,
): Promise<void> {
  await runPrismaTransaction(prisma, async (tx) => {
    await revokeActiveMcpLinksPrisma(tx, userId, now)
    await tx.mcp_links.create({
      data: {
        id: newId(),
        user_id: userId,
        token_hash: tokenHash,
        token_secret_enc: tokenSecretEnc,
        created_at: now,
      },
    })
  })
}

export async function upsertMcpLinkClientPrisma(
  prisma: PrismaDb,
  linkId: string,
  client: string,
  now: number,
): Promise<void> {
  await prisma.mcp_link_clients.upsert({
    where: { link_id_client: { link_id: linkId, client } },
    create: {
      link_id: linkId,
      client,
      first_used_at: now,
      last_used_at: now,
    },
    update: { last_used_at: now },
  })
}
