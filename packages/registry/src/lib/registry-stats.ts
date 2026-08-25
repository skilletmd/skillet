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
    /**
     * Skills saved by users: distinct (user, skill) pairs, counting a save
     * however it happened (added to one of their kits, or brought in by a kit
     * or author subscription, sized at subscribe time). Unlike `installs` this
     * counts the person once, not once per machine that materializes the skill.
     */
    saves: number
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
    saves: number[]
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
    /**
     * `/skillet @handle` summons. Counted server-side on the version fetch,
     * NOT from `events` like invocations and picks: summon deliberately works
     * with nothing installed, so there is no CLI to emit an event.
     */
    summons: number
    /**
     * The public headline: picks + summons, i.e. every time a skill was routed
     * to an agent whether or not it was installed. The two inputs are counted
     * on different paths (see `summons`), so an MCP summon, which writes both a
     * `skill.route` event and a summon tally, is counted twice. There is no user
     * on the summon side to dedupe against.
     */
    routed: number
    /** `routed`, cumulative by month, aligned index-for-index to `months`. */
    routedSeries: number[]
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

/** Several month tallies added together, for a metric whose parts live in
 *  different tables (routing: route events + summon counters). */
function sumByMonth(...parts: MonthRow[][]): Map<string, number> {
  const out = new Map<string, number>()
  for (const part of parts) {
    for (const [month, n] of byMonth(part)) out.set(month, (out.get(month) ?? 0) + n)
  }
  return out
}

const routedByMonth = (picks: MonthRow[], summons: MonthRow[]) => sumByMonth(picks, summons)

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
  // The public-skill predicate, per table alias: the adds queries below join
  // `skills` under three different aliases in one statement.
  const pubPred = (a: string) =>
    `${a}.visibility = 'public' AND ${a}.latest_hash IS NOT NULL AND ${a}.moderation_status != 'unlisted' ${suspendedSql.replaceAll('s.author_id', `${a}.author_id`)}`
  const publicPred = pubPred('s')
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
    picksMonths,
    summonsMonths,
    savesMonths,
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
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(ts), '%Y-%m') AS m, COUNT(*) AS n
         FROM events WHERE name = 'skill.route' GROUP BY m`,
    ),
    // `day` is a unix day number, not a timestamp.
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(day * 86400), '%Y-%m') AS m, SUM(count) AS n
         FROM skill_summon_counts GROUP BY m`,
    ),
    // Saves: one row per (user, skill) the user put in their library, dated at
    // the FIRST time they did it. Three ways a save happens, unioned then
    // deduped, so Bob saving a skill into two of his own kits is one save and
    // Bob + Mary saving the same skill is two.
    //   1. a skill added to a kit the user owns (the auto "Saved" kit included).
    //      `source_type = 'owned'` excludes repo-linked kits, whose membership
    //      the mirror pipeline writes, not a person.
    //   2. subscribing to a kit saves every skill it held AT THAT MOMENT
    //      (`added_at <= created_at`), so a past month never drifts upward when
    //      the curator adds an 11th skill.
    //   3. an author kit is sized the same way, off what that author had
    //      published then.
    // A user's own skills never count: authorship is not adoption. Accounts
    // without a claimed handle key on their id so they can't collapse together.
    prisma.$queryRawUnsafe<MonthRow[]>(
      `SELECT DATE_FORMAT(FROM_UNIXTIME(first_at), '%Y-%m') AS m, COUNT(*) AS n FROM (
         SELECT saver, skill_id, MIN(ts) AS first_at FROM (
           SELECT k.owner_id AS saver, ks.skill_id AS skill_id, ks.added_at AS ts
             FROM kit_skills ks
             JOIN kits k ON k.id = ks.kit_id
             JOIN skills s ON s.id = ks.skill_id
            WHERE k.source_type = 'owned' AND k.owner_id <> s.author_id AND ${publicPred}
           UNION ALL
           SELECT COALESCE(u.handle, CONCAT('#', u.id)) AS saver, ks2.skill_id, sub.created_at AS ts
             FROM kit_subscriptions sub
             JOIN users u ON u.id = sub.user_id
             JOIN kit_skills ks2 ON ks2.kit_id = sub.kit_id AND ks2.added_at <= sub.created_at
             JOIN skills s2 ON s2.id = ks2.skill_id
            WHERE sub.kind = 'kit'
              AND ${pubPred('s2')}
              AND COALESCE(u.handle, '') <> s2.author_id
           UNION ALL
           SELECT COALESCE(u.handle, CONCAT('#', u.id)) AS saver, s3.id AS skill_id, sub.created_at AS ts
             FROM kit_subscriptions sub
             JOIN users u ON u.id = sub.user_id
             JOIN skills s3 ON s3.author_id = sub.author_id AND s3.created_at <= sub.created_at
            WHERE sub.kind = 'author'
              AND ${pubPred('s3')}
              AND COALESCE(u.handle, '') <> s3.author_id
         ) every_save
         GROUP BY saver, skill_id
       ) first_save
       GROUP BY m`,
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
    routed: routedByMonth(picksMonths, summonsMonths),
    saves: byMonth(savesMonths),
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
    saves: cumulative(months, monthled.saves),
  }
  // All-time saves: the last point of the cumulative series (0 before any month
  // has data), so the card and its chart can never disagree.
  const savesTotal = series.saves.at(-1) ?? 0
  const routedSeries = cumulative(months, monthled.routed)

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

  const [routeInvocations, routePicks, summonAgg, topPicked, byRuntime] = await Promise.all([
    prisma.events.count({ where: { name: 'skill.route.invoke' } }),
    prisma.events.count({ where: { name: 'skill.route' } }),
    prisma.skill_summon_counts.aggregate({ _sum: { count: true } }),
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
    totals: { ...totals, saves: savesTotal },
    growth,
    series,
    months,
    categories,
    routes: {
      invocations: routeInvocations,
      picks: routePicks,
      summons: summonAgg._sum.count ?? 0,
      routed: routePicks + (summonAgg._sum.count ?? 0),
      routedSeries,
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
