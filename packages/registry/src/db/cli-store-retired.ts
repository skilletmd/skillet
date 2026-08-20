/**
 * Shared fail-closed message for maintenance CLIs that still assumed SQLite.
 * Fresh MySQL cutover does not need sqlite→R2 / sqlite-file tools; remaining
 * useful jobs need an explicit Prisma rewrite before they can run again.
 */
export function throwSqliteCliRetired(tool: string): never {
  throw new Error(
    `${tool} still targets the retired SQLite registry store. ` +
      'Relational data is MySQL via DATABASE_URL + Prisma; skill bytes are on R2. ' +
      'This CLI is unavailable until rewritten (or obsolete after a fresh MySQL cutover).',
  )
}
