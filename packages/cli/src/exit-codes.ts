/**
 * Stable CLI exit codes for CI and scripting.
 * Documented in packages/web/content/docs/cli.md — do not renumber without a major bump.
 */
export const ExitCode = {
  /** Command completed successfully. */
  OK: 0,
  /** General failure (sync adapter fail, quarantined status, etc.). */
  ERROR: 1,
  /** Invalid usage / missing required args. */
  USAGE: 2,
  /** Auth required or auth rejected. */
  AUTH: 3,
  /** Conflict / stale base / registry 409. */
  CONFLICT: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export function exitWith(code: ExitCodeValue): never {
  process.exit(code);
}

/**
 * Classify a caught error into an exit code so every registry-touching command
 * routes auth rejections consistently. A revoked device / stale session comes
 * back as a 401/403 from the registry AFTER the local pairing gate passed
 * (the gate only sees a missing token, not a rejected one), so those must exit
 * AUTH — not the generic ERROR — or scripts and the tray treat "re-pair
 * needed" as a retryable failure. A 409 is a stale-base CONFLICT. Everything
 * else is ERROR. Duck-types `status`/`code` so it works whether or not the
 * caller has a RegistryError instance in scope.
 */
export function exitCodeForError(err: unknown): ExitCodeValue {
  const status = (err as { status?: number } | null)?.status;
  const code = (err as { code?: string } | null)?.code;
  if (status === 401 || status === 403 || code === "machine_disconnected") {
    return ExitCode.AUTH;
  }
  if (status === 409 || code === "stale_base") return ExitCode.CONFLICT;
  return ExitCode.ERROR;
}
