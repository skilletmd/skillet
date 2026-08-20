/**
 * Account update_mode reads and writes for the MySQL/Prisma path (U4).
 */
import type { PrismaClient } from '@prisma/client'
import { runPrismaTransaction } from '../db/prisma-client.js'
import { stampAutoApprovalsPrisma } from './stamp-auto-approvals.js'

export type AccountUpdateMode = 'auto' | 'manual'

/** Read the account-level update mode; defaults to manual when unset. */
export async function getAccountUpdateModePrisma(
  prisma: PrismaClient,
  userId: string,
): Promise<AccountUpdateMode> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { update_mode: true },
  })
  const mode = row?.update_mode
  return mode === 'auto' ? 'auto' : 'manual'
}

/**
 * Atomically set update_mode and stamp pending approvals when flipping to auto.
 * Returns how many pending targets were stamped (for the web confirmation copy).
 */
export async function patchAccountUpdateModePrisma(
  prisma: PrismaClient,
  userId: string,
  mode: AccountUpdateMode,
): Promise<number> {
  return runPrismaTransaction(prisma, async (tx) => {
    await tx.users.update({
      where: { id: userId },
      data: { update_mode: mode },
    })
    if (mode === 'auto') return stampAutoApprovalsPrisma(tx, userId)
    return 0
  })
}
