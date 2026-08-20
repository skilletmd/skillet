// MySQL-backed registry test harness (U5). Fail closed without DATABASE_URL;
// migrate once per process; truncate between tests instead of dropping the DB.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PrismaClient } from '@prisma/client'
import { createPrismaClient } from '../src/db/prisma-client.js'

const execFileAsync = promisify(execFile)

const MYSQL_HINT =
  'Start local MySQL (Docker: docker compose -f docker-compose.mysql.yml up -d → :3307),\n' +
  'or native MySQL 8.x on :3306 with utf8mb4, then set DATABASE_URL, e.g.\n' +
  '  mysql://skillet:skillet@127.0.0.1:3307/skillet_registry  (compose)\n' +
  '  mysql://skillet:skillet@127.0.0.1:3306/skillet_registry  (native)'

export class MissingTestDatabaseUrlError extends Error {
  constructor() {
    super(
      'DATABASE_URL is required for MySQL registry tests.\n' + MYSQL_HINT,
    )
    this.name = 'MissingTestDatabaseUrlError'
  }
}

/**
 * Registry tests TRUNCATE every table, so they must never run against the
 * database a developer's dev stack is using — a pre-commit test sweep would
 * silently wipe it. Derive an isolated sibling database by suffixing the
 * database name with `_test` (idempotent when already suffixed).
 * SKILLET_TEST_DATABASE_URL overrides the derivation outright.
 */
export function testDatabaseUrlFrom(
  raw: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = (env.SKILLET_TEST_DATABASE_URL ?? '').trim()
  if (explicit) return explicit
  const u = new URL(raw)
  const name = u.pathname.replace(/^\//, '')
  if (!name.endsWith('_test')) u.pathname = `/${name}_test`
  return u.toString()
}

/** Fail closed when DATABASE_URL is missing or blank; always test-isolated. */
export function requireTestDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = (env.DATABASE_URL ?? '').trim()
  if (!url) throw new MissingTestDatabaseUrlError()
  return testDatabaseUrlFrom(url, env)
}

// Module-load pin: importing @prisma/client (via prisma-client.js above) has
// already dotenv-loaded packages/registry/.env into process.env, so any code
// that resolves DATABASE_URL ambiently — buildServer, bare PrismaClient — would
// reach the developer's live dev database. Rewrite it to the isolated *_test
// sibling the moment this harness loads, before any suite can construct a
// client. Test-only file; production never imports it.
if ((process.env.DATABASE_URL ?? '').trim()) {
  process.env.DATABASE_URL = testDatabaseUrlFrom(process.env.DATABASE_URL!, process.env)
}

/**
 * Live MySQL integration suites opt in with SKILLET_MYSQL_TESTS=1 (set by
 * `pnpm test:mysql`). A naked DATABASE_URL from packages/registry/.env must
 * not enlist these into the default parallel `pnpm test` run — they share one
 * DB and race under concurrency.
 */
export function mysqlTestsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.SKILLET_MYSQL_TESTS === '1' && Boolean((env.DATABASE_URL ?? '').trim())
}

export function createTestPrismaClient(options?: {
  databaseUrl?: string
}): PrismaClient {
  return createPrismaClient({
    databaseUrl: options?.databaseUrl ?? requireTestDatabaseUrl(),
  })
}

const PRISMA_MIGRATIONS_TABLE = '_prisma_migrations'

type TableNameRow = { TABLE_NAME: string } | { table_name: string }

function tableNameFromRow(row: TableNameRow): string {
  if ('TABLE_NAME' in row && typeof row.TABLE_NAME === 'string') return row.TABLE_NAME
  if ('table_name' in row && typeof row.table_name === 'string') return row.table_name
  throw new Error(`Unexpected INFORMATION_SCHEMA row: ${JSON.stringify(row)}`)
}

/** Truncate every application table in FK-safe order (FK checks off). */
export async function resetMysqlRegistry(prisma: PrismaClient): Promise<void> {
  // Belt-and-suspenders: the URL derivation (testDatabaseUrlFrom) is supposed to
  // point every test at a `_test` sibling DB, but that guarantee is only as good
  // as the derivation — a stray SKILLET_TEST_DATABASE_URL, or a dev DB that
  // happens to be named `*_test`, could bypass it. Refuse to truncate unless the
  // *live* connection's database name ends in `_test`. This checks the actual DB
  // we're about to wipe, not an env var, so it holds regardless of how the URL
  // was resolved. Override only with an explicit, deliberate opt-out.
  const [{ name: dbName } = { name: null }] = await prisma.$queryRawUnsafe<
    Array<{ name: string | null }>
  >('SELECT DATABASE() AS name')
  if (
    process.env.SKILLET_ALLOW_NONTEST_TRUNCATE !== '1' &&
    !(dbName ?? '').endsWith('_test')
  ) {
    throw new Error(
      `Refusing to TRUNCATE database "${dbName ?? '(none)'}" — its name does not end in ` +
        `"_test". Registry tests must run against an isolated *_test database. ` +
        `Set SKILLET_ALLOW_NONTEST_TRUNCATE=1 only if you truly intend to wipe this DB.`,
    )
  }
  const rows = await prisma.$queryRawUnsafe<TableNameRow[]>(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME <> '${PRISMA_MIGRATIONS_TABLE}'`,
  )

  const tables = rows.map(tableNameFromRow)
  for (const table of tables) {
    // We only truncate simple identifiers from INFORMATION_SCHEMA.
    if (!/^[A-Za-z0-9_]+$/.test(table)) {
      throw new Error(`Refusing to truncate unexpected table name: ${table}`)
    }
  }

  // Prisma pools connections, so SET FOREIGN_KEY_CHECKS must share the same
  // connection as every TRUNCATE — use an interactive transaction. Under
  // monorepo pre-commit load the default 5s interactive timeout can expire.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0')
      try {
        for (const table of tables) {
          await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``)
        }
      } finally {
        await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1')
      }
    },
    { timeout: 30_000 },
  )
}

let migrateDeployPromise: Promise<void> | undefined

/**
 * Run `prisma migrate deploy` once per process against DATABASE_URL.
 * Idempotent: already-applied migrations are a no-op.
 */
export async function ensureMysqlMigrated(): Promise<void> {
  if (migrateDeployPromise) return migrateDeployPromise

  migrateDeployPromise = (async () => {
    const url = requireTestDatabaseUrl()
    const here = dirname(fileURLToPath(import.meta.url))
    const packageRoot = join(here, '..')
    const prismaBin = join(packageRoot, 'node_modules', '.bin', 'prisma')
    // On Windows `.bin/prisma` is a sh script and its sibling shim is a .CMD,
    // which Node refuses to spawn without a shell (EINVAL, since the
    // CVE-2024-27980 hardening). Run it through cmd so PATHEXT resolves the
    // shim, and quote the path so a profile directory with spaces survives.
    const viaShell = process.platform === 'win32'

    try {
      await execFileAsync(viaShell ? `"${prismaBin}"` : prismaBin, ['migrate', 'deploy'], {
        cwd: packageRoot,
        env: { ...process.env, DATABASE_URL: url },
        maxBuffer: 10 * 1024 * 1024,
        shell: viaShell,
      })
    } catch (err) {
      migrateDeployPromise = undefined
      const detail =
        err instanceof Error && 'stderr' in err && typeof err.stderr === 'string'
          ? err.stderr.trim()
          : err instanceof Error
            ? err.message
            : String(err)
      throw new Error(`prisma migrate deploy failed for registry tests:\n${detail}\n${MYSQL_HINT}`)
    }
  })()

  return migrateDeployPromise
}

/**
 * Migrated, empty Prisma client for MySQL-backed waves.
 * `freshServer()` already boots MySQL/Prisma; use this when a suite needs a
 * second client for direct seed/assert without going through HTTP.
 */
export async function freshMysqlPrisma(): Promise<PrismaClient> {
  await ensureMysqlMigrated()
  const prisma = createTestPrismaClient()
  await resetMysqlRegistry(prisma)
  return prisma
}
