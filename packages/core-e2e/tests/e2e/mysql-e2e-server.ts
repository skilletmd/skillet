// Shared MySQL registry boot for core e2e loops. Auth routes are Prisma-only
// after the dual-path removal, so :memory: sqlite servers can no longer mint
// sessions or resolve principals.
//
// We use a dedicated database (skillet_core_e2e) so parallel `pnpm -r test`
// registry MySQL suites cannot truncate mid-flight while these loops run.
//
// Default `pnpm test` does not run these loops (no Docker required for commits).
// `pnpm test:e2e` / `pnpm test:mysql` skip cleanly when :3307 is unreachable.
import net from 'node:net'
import type { buildServer } from '@skillet/registry'

export type RegistryHandle = Awaited<ReturnType<typeof buildServer>>

const DEFAULT_E2E_URL =
  'mysql://root:skillet@127.0.0.1:3307/skillet_core_e2e'

export function coreE2eDatabaseUrl(): string {
  return (process.env.CORE_E2E_DATABASE_URL ?? '').trim() || DEFAULT_E2E_URL
}

/** Fast TCP probe so e2e suites skip instead of hanging when MySQL is down. */
export async function isCoreMysqlE2eReachable(
  databaseUrl: string = coreE2eDatabaseUrl(),
  timeoutMs = 300,
): Promise<boolean> {
  if (process.env.SKILLET_SKIP_MYSQL_E2E === '1') return false
  let host = '127.0.0.1'
  let port = 3307
  try {
    const parsed = new URL(databaseUrl)
    host = parsed.hostname || host
    port = Number(parsed.port || '3306') || 3306
  } catch {
    return false
  }
  return await new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end()
      resolve(true)
    })
    socket.setTimeout(timeoutMs)
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => resolve(false))
  })
}

function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url)
  const name = parsed.pathname.replace(/^\//, '').trim()
  if (!name || !/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing unexpected MySQL database name from URL: ${name}`)
  }
  return name
}

async function ensureE2eDatabase(databaseUrl: string): Promise<void> {
  const dbName = databaseNameFromUrl(databaseUrl)
  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/mysql'
  // Root credentials from docker-compose.mysql.yml create the dedicated DB.
  if (!adminUrl.username) adminUrl.username = 'root'
  if (!adminUrl.password) adminUrl.password = 'skillet'

  const { createPrismaClient } = await import(
    '../../../registry/src/db/prisma-client.js'
  )
  const admin = createPrismaClient({ databaseUrl: adminUrl.toString() })
  try {
    await admin.$executeRawUnsafe(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
  } finally {
    await admin.$disconnect()
  }
}

export async function freshMysqlE2eServer(opts: {
  scanSync?: boolean
} = {}): Promise<RegistryHandle> {
  // Prefer CORE_E2E_DATABASE_URL so a shared DATABASE_URL from registry tests
  // does not point these suites at the contended skillet_registry schema.
  const databaseUrl = coreE2eDatabaseUrl()
  process.env.DATABASE_URL = databaseUrl
  if (!process.env.BLOB_STORE) process.env.BLOB_STORE = 'memory'

  await ensureE2eDatabase(databaseUrl)

  const { ensureMysqlMigrated, resetMysqlRegistry, createTestPrismaClient } =
    await import('../../../registry/tests/mysql-test-env.js')
  const { buildServer } = await import('@skillet/registry')

  await ensureMysqlMigrated()
  const seed = createTestPrismaClient()
  await resetMysqlRegistry(seed)
  await seed.$disconnect()

  // Default scanSync false: async proposal scans race materialize/drift repair
  // under MySQL memory blobs. Suites that need scans opt in explicitly.
  const server = await buildServer({
    logger: false,
    usePrismaAuth: true,
    scanSync: opts.scanSync ?? false,
    auth: { devAuth: true },
  })
  await server.app.ready()
  return server
}
