#!/usr/bin/env node
/**
 * Smoke-check a live registry: TLS + /api/hc + public catalog read.
 * Used post-deploy and in CI when REGISTRY_URL is configured.
 *
 * Usage:
 *   node scripts/check-registry-health.mjs
 *   REGISTRY_URL=https://registry.skillet.md node scripts/check-registry-health.mjs
 *   REGISTRY_SMOKE_TOKEN=<bearer> node scripts/check-registry-health.mjs
 */
const base = (process.env.REGISTRY_URL ?? 'https://registry.skillet.md').replace(/\/+$/, '');

async function check(path, { accept = [200] } = {}) {
  const url = `${base}${path}`;
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (cause) {
    throw new Error(`${url} — fetch failed: ${cause instanceof Error ? cause.message : cause}`);
  }
  if (!accept.includes(res.status)) {
    const body = await res.text().catch(() => '');
    throw new Error(`${url} — expected ${accept.join('|')}, got ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  return res;
}

async function main() {
  console.log(`Checking registry at ${base}`);
  await check('/api/hc');
  console.log('  /api/hc OK');
  // Public catalog lives under /api/v1 (legacy /v1/skills is 404 on current deploys).
  await check('/api/v1/skills', { accept: [200] });
  console.log('  /api/v1/skills OK');
  // Optional auth probe: catches schema drift that /api/hc misses (e.g. missing
  // muted_team_kits → /sync/manifest 500). Set REGISTRY_SMOKE_TOKEN to a session
  // or device bearer from a paired account.
  const token = (process.env.REGISTRY_SMOKE_TOKEN ?? '').trim();
  if (token) {
    const url = `${base}/api/v1/me/muted-team-kits`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status !== 200) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `${url} — expected 200, got ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      );
    }
    console.log('  /api/v1/me/muted-team-kits OK');
  }
  console.log('Registry health check passed.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
