import { PrismaClient } from '@prisma/client'

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super('DATABASE_URL is required for the registry MySQL (Prisma) store')
    this.name = 'MissingDatabaseUrlError'
  }
}

/**
 * Prisma client or interactive-transaction client. Auth helpers accept this so
 * the same queries work inside `$transaction` during later waves.
 */
export type PrismaDb = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>

/** Resolve the Prisma MySQL URL or throw when unset/blank. */
export function requireDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = (env.DATABASE_URL ?? '').trim()
  if (!url) throw new MissingDatabaseUrlError()
  return url
}

/**
 * One PrismaClient per process. Callers pass `datasources` only when tests need
 * an override URL without mutating process.env globally.
 */
export function createPrismaClient(options?: {
  databaseUrl?: string
  log?: Array<'query' | 'info' | 'warn' | 'error'>
}): PrismaClient {
  const url = options?.databaseUrl ?? requireDatabaseUrl()
  return new PrismaClient({
    datasources: { db: { url } },
    log: options?.log,
  })
}

/** Interactive transaction wrapper that mirrors our old sync `runTransaction`. */
export async function runPrismaTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: PrismaDb) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => fn(tx))
}
