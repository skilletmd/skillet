#!/usr/bin/env node
/**
 * Run `prisma generate` only when the schema has actually changed.
 *
 * Why: on Windows a loaded DLL cannot be replaced, and the generated client
 * embeds `query_engine-windows.dll.node`. Any process that imported
 * @prisma/client — the registry dev server, a `tsx watch` orphan, a concurrent
 * test worker — holds that file open, so an unconditional `prisma generate`
 * fails the build with EPERM. That broke `pnpm test`, `pnpm typecheck` and the
 * pre-commit hook whenever the app was running.
 *
 * How staleness is decided: `prisma generate` writes a copy of the schema into
 * the generated client, and names that package after its hash — so the copy IS
 * the client's identity. Comparing it to our schema answers "was the client
 * built from this?" exactly. The copy is reformatted (Prisma realigns columns),
 * so compare token-wise rather than byte-wise.
 *
 * Version bumps need no special handling: @prisma/client regenerates from its
 * own postinstall, so an upgraded client is already current by the time any
 * build runs.
 *
 * Escape hatch: PRISMA_FORCE_GENERATE=1 always regenerates.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = join(packageRoot, 'prisma', 'schema.prisma');

/** Collapse formatting so Prisma's realignment doesn't read as a change. */
function fingerprint(source) {
  const normalized = source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
    .join('\n');
  return createHash('sha256').update(normalized).digest('hex');
}

function generate() {
  // Resolve prisma's CLI entry and run it with this Node, rather than relying on
  // the `prisma` name. Bare-name spawning only works when node_modules/.bin is on
  // PATH (true under `pnpm run`, not when this script is invoked directly), and on
  // Windows the .bin entry is a .cmd that Node refuses to spawn without a shell
  // (EINVAL, CVE-2024-27980 hardening). Resolving the JS avoids both.
  let cli;
  try {
    const require_ = createRequire(join(packageRoot, 'package.json'));
    const pkgPath = require_.resolve('prisma/package.json');
    const bin = JSON.parse(readFileSync(pkgPath, 'utf8')).bin;
    const rel = typeof bin === 'string' ? bin : bin?.prisma;
    if (!rel) throw new Error('prisma package.json has no bin entry');
    cli = join(dirname(pkgPath), rel);
  } catch (err) {
    console.error(`prisma: could not locate the CLI (${err.message}). Is prisma installed?`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [cli, 'generate'], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`prisma generate failed to start: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (!existsSync(schemaPath)) {
  console.error(`prisma: schema not found at ${schemaPath}`);
  process.exit(1);
}
if (process.env.PRISMA_FORCE_GENERATE === '1') generate();

// The generated client lives beside @prisma/client in the same node_modules,
// which holds under pnpm's nested store layout as well as a flat one.
let generatedSchema = null;
try {
  const require_ = createRequire(join(packageRoot, 'package.json'));
  const clientEntry = require_.resolve('@prisma/client');
  const candidate = join(dirname(clientEntry), '..', '..', '.prisma', 'client', 'schema.prisma');
  if (existsSync(candidate)) generatedSchema = readFileSync(candidate, 'utf8');
} catch {
  generatedSchema = null; // not installed yet — generate below
}

if (generatedSchema !== null && fingerprint(readFileSync(schemaPath, 'utf8')) === fingerprint(generatedSchema)) {
  console.log('prisma: schema unchanged, reusing the generated client');
  process.exit(0);
}

generate();
