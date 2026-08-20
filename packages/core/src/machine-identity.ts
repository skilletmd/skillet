import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Stable, privacy-preserving machine identity.
 *
 * The OS machine id (IOPlatformUUID / /etc/machine-id / MachineGuid) is keyed
 * through HMAC-SHA256 per machine-id(5): the raw value never leaves the
 * machine, and the digest cannot be correlated with other applications'
 * derivations. The app key is domain separation, not a secret — but changing
 * it re-mints every machine identity fleet-wide, so it is versioned and fixed.
 *
 * The digest is a same-account dedupe hint for the registry (device-row
 * reclaim), never authentication: cloned VMs and imaged machines can share an
 * OS machine id.
 */
const MACHINE_IDENTITY_APP_KEY = 'md.skillet.machine-identity.v1';

function readRawMacOs(): string | null {
  try {
    const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function readRawLinux(): string | null {
  for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const raw = readFileSync(path, 'utf8');
      if (raw.trim().length > 0) return raw;
    } catch {
      // fall through to the next source
    }
  }
  return null;
}

function readRawWindows(): string | null {
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function readRawMachineId(): string | null {
  switch (process.platform) {
    case 'darwin':
      return readRawMacOs();
    case 'linux':
      return readRawLinux();
    case 'win32':
      return readRawWindows();
    default:
      return null;
  }
}

/**
 * Derive the app-scoped digest from a raw OS machine id. Pure; exported for
 * tests. Whitespace and case must not change the digest (the same physical id
 * is reported with different casing across OS tools), and a missing or
 * never-initialized id (systemd writes the literal `uninitialized`) yields
 * null rather than a digest of a non-identity.
 */
export function deriveMachineId(raw: string | null | undefined): string | null {
  const normalized = raw?.trim().toLowerCase() ?? '';
  if (normalized.length === 0 || normalized === 'uninitialized') return null;
  return createHmac('sha256', normalized).update(MACHINE_IDENTITY_APP_KEY).digest('hex');
}

let cached: string | null | undefined;

/**
 * The machine's stable identity digest, or null when the OS id is unavailable
 * (containers without /etc/machine-id, group-policy-blocked reg.exe, unknown
 * platforms). Callers own the fallback — see auth-connect-pair, which falls
 * back to the persisted device.json id, then a random UUID. Cached per
 * process: the underlying id cannot change while we run.
 */
export function stableMachineId(): string | null {
  if (cached === undefined) cached = deriveMachineId(readRawMachineId());
  return cached;
}

/** Test-only: clear the per-process cache. */
export function resetMachineIdCacheForTests(): void {
  cached = undefined;
}
