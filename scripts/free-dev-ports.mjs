#!/usr/bin/env node
/**
 * Free dev ports before launching `pnpm dev` / `pnpm dev:all`.
 *
 * Why: `pnpm --parallel` does not always propagate signals to its spawned
 * children, so a crashed or Ctrl-C'd dev session can leave orphan `vite`,
 * `next dev`, or `tsx watch` processes squatting on 1420 / 3000 / 3001.
 * The next boot then fails with "Port X is already in use" or
 * `ECONNREFUSED`. Killing any squatter on these specific dev ports before
 * launch sidesteps the orphan-leak class of failure.
 *
 * Scope: only the ports our own dev scripts bind. Never touches other PIDs.
 */

import { execSync } from 'node:child_process';

const DEV_PORTS = [3000, 3001, 1420];

function pidsOnPort(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);
  } catch {
    // lsof exits 1 when nothing matches — that's the empty case, not an error
    return [];
  }
}

let killed = 0;
for (const port of DEV_PORTS) {
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, 'SIGKILL');
      console.log(`[free-dev-ports] killed pid=${pid} on :${port}`);
      killed += 1;
    } catch {
      // Process already gone — fine
    }
  }
}

if (killed === 0) {
  console.log('[free-dev-ports] ports clean');
}
