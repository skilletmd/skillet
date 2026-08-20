import { ExitCode, exitWith, type ExitCodeValue } from "./exit-codes.js";

/** Machine-readable CLI envelope for `--json` responses. */
export interface JsonEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export function writeJson<T>(payload: JsonEnvelope<T>, exitCode?: ExitCodeValue): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  if (exitCode !== undefined && exitCode !== ExitCode.OK) {
    exitWith(exitCode);
  }
}

export function writeJsonOk<T>(data: T, exitCode: ExitCodeValue = ExitCode.OK): void {
  writeJson({ ok: true, data }, exitCode);
}

export function writeJsonError(
  message: string,
  opts: { code?: string; exitCode?: ExitCodeValue } = {},
): never {
  const exitCode = opts.exitCode ?? ExitCode.ERROR;
  process.stdout.write(
    JSON.stringify(
      { ok: false, error: message, ...(opts.code ? { code: opts.code } : {}) },
      null,
      2,
    ) + "\n",
  );
  exitWith(exitCode);
}

/** Legacy `{ ok, ...fields }` blobs still emitted by some commands — wrap for consistency. */
export function legacyOrEnvelope<T extends Record<string, unknown>>(
  legacy: T,
  asJson: boolean,
): void {
  if (!asJson) return;
  process.stdout.write(JSON.stringify(legacy, null, 2) + "\n");
}
