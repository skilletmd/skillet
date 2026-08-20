// Owner install timeseries for GET /skills/:author/:slug/installs/timeseries.
import { Prisma } from '@prisma/client'
import type { PrismaDb } from '../db/prisma-client.js'

export type InstallTimeseriesBucket = 'hour' | 'day'

export type InstallTimeseriesPoint = { bucket: string; count: number }

/** Bucketed install counts for one skill over [from, to). */
export async function skillInstallTimeseriesPrisma(
  prisma: PrismaDb,
  skillId: string,
  opts: { bucket: InstallTimeseriesBucket; from: number; to: number },
): Promise<InstallTimeseriesPoint[]> {
  // fmt is a closed-set literal (hour|day), never user-controlled SQL.
  const fmt = opts.bucket === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d'
  const rows = await prisma.$queryRaw<Array<{ bucket: string; count: bigint | number }>>(
    Prisma.sql`
      SELECT DATE_FORMAT(FROM_UNIXTIME(installed_at), ${fmt}) AS bucket, COUNT(*) AS count
        FROM skill_installers
       WHERE skill_id = ${skillId}
         AND installed_at >= ${opts.from}
         AND installed_at < ${opts.to}
       GROUP BY bucket
       ORDER BY bucket`,
  )
  return rows.map((r) => ({
    bucket: r.bucket,
    count: typeof r.count === 'bigint' ? Number(r.count) : r.count,
  }))
}
