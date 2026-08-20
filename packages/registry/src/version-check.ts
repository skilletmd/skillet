// Pin a modern Node for registry (async Prisma, undici, etc.). Fail fast at
// startup with a clear message rather than crashing deep inside a query on an
// older runtime. Exported as a pure function so it can be unit-tested without
// spawning a process.
//
// Historically this check cited node:sqlite stability; after the MySQL cutover
// we keep the floor for runtime features the service still relies on. Web blog
// tooling may retain its own Node pin independently.

const MIN_MAJOR = 24;

/** Throws with an actionable message when `version` (e.g. `process.version`) is
 *  below the Node major the registry requires. */
export function assertNodeVersion(version: string = process.version): void {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
  if (Number.isNaN(major) || major < MIN_MAJOR) {
    throw new Error(
      `Skillet registry requires Node >= ${MIN_MAJOR} (found ${version}).`,
    );
  }
}
