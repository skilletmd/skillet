/**
 * Structural stand-in for the former `node:sqlite` DatabaseSync type.
 * Keeps leftover register* signatures typechecking without importing
 * node:sqlite into registry production modules (U5/U6 gap test).
 */
export type SqliteStatement = {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid?: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export type SqliteHandle = {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
  close(): void
}

/** Alias used while dual-path call sites still say DatabaseSync. */
export type DatabaseSync = SqliteHandle

/** Thrown when a leftover sqlite branch runs after the MySQL cutover. */
export function unavailableSqliteHandle(): SqliteHandle {
  const boom = (): never => {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return {
    prepare: () => ({
      run: boom,
      get: boom,
      all: boom,
    }),
    exec: boom,
    close: () => undefined,
  }
}
