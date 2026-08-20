// Public registry-wide stats aggregates for the MySQL/Prisma path (U4).
// Month buckets use MySQL DATE_FORMAT; route meta uses JSON_EXTRACT.
import type { PrismaDb } from '../db/prisma-client.js'
import { suspendedAuthorHandlesPrisma } from './suspension.js'

export interface RegistryStatsPayload {
  totals: {
    users: number
    creators: number
    skills: number
    networkSkills: number
    kits: number
    installs: number
    versions: number
    subscriptions: number
    follows: number
  }
  growth: Array<{ month: string; skills: number; users: number }>
  series: {
    skills: number[]
    networkSkills: number[]
    kits: number[]
    creators: number[]
    installs: number[]
    users: number[]
    versions: number[]
    subscriptions: number[]
    follows: number[]
  }
  months: string[]
  categories: Array<{ key: string; skills: number; installs: number }>
  routes: {
    invocations: number
    picks: number
    topPickedSkills: Array<{ skillRef: string; picks: number }>
    invocationsByRuntime: Array<{ runtime: string; count: number }>
  }
}

type MonthRow = { m: string; n: number | bigint }

async function suspendedNotIn(prisma: PrismaDb): Promise<string[]> {
  return suspendedAuthorHandlesPrisma(prisma)
}

function publicSkillWhere(suspended: string[]) {
  return {
    visibility: 'public' as const,
    latest_hash: { not: null },
    moderation_status: { not: 'unlisted' },
    ...(suspended.length > 0 ? { author_id: { notIn: suspended } } : {}),
  }
}

function networkSkillWhere(suspended: string[]) {
  return {
    latest_hash: { not: null },
    moderation_status: { not: 'unlisted' },
    ...(suspended.length > 0 ? { author_id: { notIn: suspended } } : {}),
  }
}

function byMonth(rows: MonthRow[]): Map<string, number> {
  return new Map(rows.map((r) => [r.m, Number(r.n)]))
}

function cumulative(months: string[], map: Map<string, number>): number[] {
  let run = 0
  return months.map((m) => (run += map.get(m) ?? 0))
}

/** Build the GET /stats payload against MySQL. */
export async function buildRegistryStatsPrisma(prisma: PrismaDb): Promise<RegistryStatsPayload> {
  const suspended = await suspendedNotIn(prisma)
  const pub = publicSkillWhere(suspended)
  const net = networkSkillWhere(suspended)

  const [
    users,
    creators,
    skills,
    networkSkills,
    kits,
    installAgg,
    versions,
    subscriptionsAuthor,
    subscriptionsKit,
    follows,
  ] = await Promise.all([
    prisma.users.count({ where: { handle: { not: null } } }),
    prisma.skills.findMany({
      where: pub,
      distinct: ['author_id'],
      select: { author_id: true },
    }),
    prisma.skills.count({ where: pub }),
    prisma.skills.count({ where: net }),
    prisma.kits.count({ where: { visibility: 'public' } }),
    prisma.skills.aggregate({ where: pub, _sum: { install_count: true } }),
    prisma.skill_versions.count({ where: { skills: pub } }),
    prisma.kit_subscriptions.count({ where: { kind: 'author' } }),
    prisma.kit_subscriptions.count({
      where: { kind: 'kit', kits: { visibility: 'public' } },
    }),
    prisma.follows.count(),
  ])

  const totals = {
    users,
    creators: creators.length,
    skills,
    networkSkills,
    kits,
    installs: installAgg._sum.install_count ?? 0,
    versions,
    subscriptions: subscriptionsAuthor + subscriptionsKit,
    follows,
  }

  // Month series via MySQL date formatting (sqlite used strftime).
  const suspendedSql =
    suspended.length > 0
      ? `AND s.author_id NOT IN (${suspended.map((h) => `'${h.replace(/'/g, "''")}'`).join(',')})`
      : ''
  const publicPred = `s.visibility = 'public' AND s.latest_hash IS NOT NULL AND s.moderation_status != 'unlisted' ${suspendedSql}`
  const networkPred = `s.latest_hash IS NOT NULL AND s.moderation_status != 'unlisted' ${suspendedSql}`

  const [
    skillsMonths,
    networkMonths,
    kitsMonths,
    creatorsMonths,
    installsMonths,
    usersMonths,
    versionsMonths,
    subsMonths,
    followsMonths,
  ] = await Promise.all([
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(s.created_at), '%Y-%m') AS m, COUNT(*) AS n
         FROM skills s WHERE ${publicPred} GROUP BY m`,
    ),
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(s.created_at), '%Y-%m') AS m, COUNT(*) AS n
         FROM skills s WHERE ${networkPred} GROUP BY m`,
    ),
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m') AS m, COUNT(*) AS n
         FROM kits WHERE visibility = 'public' GROUP BY m`,
    ),
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(first_at), '%Y-%m') AS m, COUNT(*) AS n FROM (
         SELECT s.author_id, MIN(s.created_at) AS first_at
           FROM skills s WHERE ${publicPred} GROUP BY s.author_id
       ) t GROUP BY m`,
    ),
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(si.installed_at), '%Y-%m') AS m, COUNT(*) AS n
         FROM skill_installers si JOIN skills s ON s.id = si.skill_id
        WHERE ${publicPred} GROUP BY m`,
    ),
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m') AS m, COUNT(*) AS n
         FROM users WHERE handle IS NOT NULL GROUP BY m`,
    ),
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(sv.published_at), '%Y-%m') AS m, COUNT(*) AS n
         FROM skill_versions sv JOIN skills s ON s.id = sv.skill_id
        WHERE ${publicPred} GROUP BY m`,
    ),
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(ks.created_at), '%Y-%m') AS m, COUNT(*) AS n
         FROM kit_subscriptions ks
         LEFT JOIN kits k ON k.id = ks.kit_id
        WHERE ks.kind = 'author' OR k.visibility = 'public' GROUP BY m`,
    ),
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m') AS m, COUNT(*) AS n
         FROM follows GROUP BY m`,
    ),
  ])

  const monthled = {
    skills: byMonth(skillsMonths),
    networkSkills: byMonth(networkMonths),
    kits: byMonth(kitsMonths),
    creators: byMonth(creatorsMonths),
    installs: byMonth(installsMonths),
    users: byMonth(usersMonths),
    versions: byMonth(versionsMonths),
    subscriptions: byMonth(subsMonths),
    follows: byMonth(followsMonths),
  }

  const months = [...new Set(Object.values(monthled).flatMap((map) => [...map.keys()]))].sort()
  const series = {
    skills: cumulative(months, monthled.skills),
    networkSkills: cumulative(months, monthled.networkSkills),
    kits: cumulative(months, monthled.kits),
    creators: cumulative(months, monthled.creators),
    installs: cumulative(months, monthled.installs),
    users: cumulative(months, monthled.users),
    versions: cumulative(months, monthled.versions),
    subscriptions: cumulative(months, monthled.subscriptions),
    follows: cumulative(months, monthled.follows),
  }

  const growth = months.map((month, i) => ({
    month,
    skills: series.networkSkills[i] ?? 0,
    users: series.users[i] ?? 0,
  }))

  const categoryRows = await prisma.skills.groupBy({
    by: ['category'],
    where: { ...pub, category: { not: null } },
    _count: { _all: true },
    _sum: { install_count: true },
    orderBy: [{ _count: { category: 'desc' } }],
  })
  const categories = categoryRows
    .filter((r): r is typeof r & { category: string } => r.category != null)
    .map((r) => ({
      key: r.category,
      skills: r._count._all,
      installs: r._sum.install_count ?? 0,
    }))
    .sort((a, b) => b.skills - a.skills || b.installs - a.installs)

  const [routeInvocations, routePicks, topPicked, byRuntime] = await Promise.all([
    prisma.events.count({ where: { name: 'skill.route.invoke' } }),
    prisma.events.count({ where: { name: 'skill.route' } }),
    prisma.$queryRawUnsafe<Array<{ skill_ref: string; picks: number | bigint }>>(
      `SELECT skill_ref, COUNT(*) AS picks
         FROM (
           SELECT JSON_UNQUOTE(JSON_EXTRACT(meta, '$.skill_ref')) AS skill_ref
             FROM events
            WHERE name = 'skill.route'
              AND meta IS NOT NULL
              AND JSON_EXTRACT(meta, '$.skill_ref') IS NOT NULL
         ) routed
         JOIN skills s
           ON CONCAT('@', s.author_id, '/', s.slug) = routed.skill_ref
          AND ${publicPred}
        GROUP BY skill_ref
        ORDER BY picks DESC, skill_ref ASC
        LIMIT 10`,
    ),
    prisma.$queryRawUnsafe<Array<{ runtime: string; count: number | bigint }>>(
      `SELECT runtime, COUNT(*) AS count
         FROM (
           SELECT JSON_UNQUOTE(JSON_EXTRACT(meta, '$.runtime')) AS runtime
             FROM events
            WHERE name = 'skill.route.invoke'
              AND meta IS NOT NULL
              AND JSON_EXTRACT(meta, '$.runtime') IS NOT NULL
              AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(meta, '$.runtime'))) != ''
         ) invoked
        GROUP BY runtime
        ORDER BY count DESC, runtime ASC
        LIMIT 10`,
    ),
  ])

  return {
    totals,
    growth,
    series,
    months,
    categories,
    routes: {
      invocations: routeInvocations,
      picks: routePicks,
      topPickedSkills: topPicked.map((row) => ({
        skillRef: row.skill_ref,
        picks: Number(row.picks),
      })),
      invocationsByRuntime: byRuntime.map((row) => ({
        runtime: row.runtime,
        count: Number(row.count),
      })),
    },
  }
}
