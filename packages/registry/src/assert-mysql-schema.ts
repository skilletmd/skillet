import type { PrismaClient } from '@prisma/client'

/**
 * Fail closed at boot when the MySQL schema is behind the binary.
 * /api/hc does not touch Prisma, so a missing table (e.g. muted_team_kits)
 * used to leave the process "healthy" while /sync/manifest returned 500.
 */
export async function assertMysqlSchemaReady(prisma: PrismaClient): Promise<void> {
  try {
    await prisma.muted_team_kits.findFirst({ select: { kit_id: true } })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `MySQL schema is behind the registry binary (muted_team_kits probe failed): ${detail}. ` +
        'Run: pnpm --filter @skillet/registry exec prisma migrate deploy',
    )
  }
}
