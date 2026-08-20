/**
 * Retired with the MySQL cutover: re-host legacy inline `data:` avatars into R2.
 * Needs a Prisma rewrite before it can run against DATABASE_URL.
 *
 *   DATABASE_URL=... pnpm --filter @skillet/registry backfill:avatars
 */
import { throwSqliteCliRetired } from '../db/cli-store-retired.js'

export async function runAvatarBackfillCli(_argv: string[]): Promise<number> {
  return throwSqliteCliRetired('avatar data: URI backfill')
}

const invokedDirectly =
  process.argv[1]?.endsWith('backfill-avatars-cli.js') ||
  process.argv[1]?.endsWith('backfill-avatars-cli.ts')

if (invokedDirectly) {
  runAvatarBackfillCli(process.argv)
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
