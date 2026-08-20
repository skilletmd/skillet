/**
 * Resolve the registry session bearer from ~/.skillet/session.json or env.
 *
 * We prefer session.json over SKILLET_TOKEN env so a fresh `skillet connect`
 * is not shadowed by a stale exported token from an earlier dev session.
 * Set SKILLET_TOKEN_FORCE=1 to make SKILLET_TOKEN win over session.json (CI).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function skilletDir(): string {
  return process.env['SKILLET_DIR'] ?? join(homedir(), '.skillet');
}

export function sessionFilePath(): string {
  return join(skilletDir(), 'session.json');
}

/** Persist a registry session token to ~/.skillet/session.json (0600). */
export async function saveSessionToken(token: string): Promise<void> {
  await mkdir(skilletDir(), { recursive: true, mode: 0o700 });
  await writeFile(
    sessionFilePath(),
    JSON.stringify({ session_token: token, saved_at: new Date().toISOString() }, null, 2) + '\n',
    { mode: 0o600 },
  );
}

export async function readSessionFileToken(): Promise<string> {
  try {
    const raw = await readFile(sessionFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as { session_token?: string };
    return typeof parsed.session_token === 'string' ? parsed.session_token : '';
  } catch {
    return '';
  }
}

export function envSessionToken(): string {
  return process.env['SKILLET_TOKEN'] ?? '';
}

/** When true, `SKILLET_TOKEN` wins over `session.json` for session bearer resolution. */
export function envSessionTokenForceActive(): boolean {
  const raw = process.env['SKILLET_TOKEN_FORCE'];
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export type SessionTokenPrecedence =
  | 'explicit'
  | 'env_forced'
  | 'file'
  | 'env_fallback'
  | 'none';

/** Which source would supply the session bearer (device precedence is separate). */
export async function sessionTokenPrecedenceMode(
  explicit?: string,
): Promise<SessionTokenPrecedence> {
  if (explicit) return 'explicit';
  const envToken = envSessionToken();
  if (envSessionTokenForceActive() && envToken.length > 0) return 'env_forced';
  const fromFile = await readSessionFileToken();
  if (fromFile) return 'file';
  if (envToken.length > 0) return 'env_fallback';
  return 'none';
}

export async function loadSessionToken(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const envToken = envSessionToken();
  if (envSessionTokenForceActive() && envToken) return envToken;
  const fromFile = await readSessionFileToken();
  if (fromFile) return fromFile;
  return envToken;
}
