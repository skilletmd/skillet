/**
 * Minimum-supported-client-version gate (desktop auto-update plan, U4).
 *
 * Ships DORMANT: the floor defaults to `0.0.0`, so no client is ever blocked
 * until an operator sets SKILLET_MIN_CLIENT_VERSION for a real breaking change.
 * Fail-open by design — a missing or unparseable client version always passes,
 * so we never lock out a client we cannot classify.
 */

/** Configured floor. Defaults to `0.0.0` (dormant — nothing is below it). */
export function minSupportedVersion(): string {
  return process.env.SKILLET_MIN_CLIENT_VERSION ?? '0.0.0';
}

/** Parse a dotted semver core (`major.minor.patch`) into numbers; null if malformed. */
function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 if a<b, 0 if equal or either is unparseable, 1 if a>b. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * True only when the client version is present, parseable, and strictly below
 * the configured floor. Everything else fails open: missing header, garbled
 * version, or the dormant `0.0.0` floor.
 */
export function clientBelowFloor(clientVersion: string | undefined): boolean {
  if (!clientVersion) return false;
  if (parseSemver(clientVersion) === null) return false; // garbled → allow
  const floor = minSupportedVersion();
  if (parseSemver(floor) === null) return false;
  return compareSemver(clientVersion, floor) < 0;
}

/** Structured 426 body the desktop parses to render its blocking update screen. */
export function upgradeRequiredBody(min: string): {
  error: string;
  message: string;
  min_version: string;
} {
  return {
    error: 'client_upgrade_required',
    message: 'Please update Skillet to keep syncing.',
    min_version: min,
  };
}
