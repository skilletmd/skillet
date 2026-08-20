/**
 * Retired with the MySQL cutover: copy inline SQLite blob bytes into R2.
 * Fresh MySQL installs never have sqlite inline blobs — skill bytes live on R2.
 *
 *   pnpm --filter @skillet/registry backfill:blobs
 */
import { throwSqliteCliRetired } from '../db/cli-store-retired.js'

export async function runBackfillCli(_argv: string[]): Promise<number> {
  return throwSqliteCliRetired('sqlite inline blob → R2 backfill')
}

const invokedDirectly =
  process.argv[1]?.endsWith('backfill-cli.js') ||
  process.argv[1]?.endsWith('backfill-cli.ts')

if (invokedDirectly) {
  runBackfillCli(process.argv)
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
