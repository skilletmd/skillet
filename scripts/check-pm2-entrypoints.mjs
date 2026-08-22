/**
 * Guard: every PM2 app's `script` must be runnable by the interpreter it
 * declares.
 *
 * `mirror-nightly` pointed at `node_modules/.bin/tsx` with `interpreter: "node"`.
 * That .bin path is a `#!/bin/sh` shim, so Node parsed `basedir=$(dirname ...)`
 * as JavaScript and threw `SyntaxError: missing ) after argument list` —
 * instantly, on every 06:00 firing, for over a month. Nothing caught it because
 * a one-shot cron app that dies in 40ms looks identical to one that finished:
 * PM2 still reports `online`, the exit is silent, and the failure only exists in
 * a stderr log nobody tails. The stdout log sat at 0 bytes the whole time.
 *
 * So the check is not "does the file exist" — it existed. It is "would this
 * interpreter choke on this file".
 *
 *   node scripts/check-pm2-entrypoints.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { apps } = require('../ecosystem.config.cjs');

const problems = [];

for (const app of apps ?? []) {
  const { name, script, interpreter } = app;
  if (!script) {
    problems.push(`${name}: no script`);
    continue;
  }
  if (!existsSync(script)) {
    problems.push(`${name}: script does not exist → ${script}`);
    continue;
  }
  // Only the node interpreter is picky about this; "none" execs the shebang and
  // a shell shim is then correct.
  if (interpreter && interpreter !== 'node') continue;

  const firstLine = readFileSync(script, 'utf8').split('\n', 1)[0] ?? '';
  const isShellShebang = /^#!\s*\/(bin\/(sh|bash|zsh)|usr\/bin\/env\s+(sh|bash|zsh))\b/.test(
    firstLine,
  );
  if (isShellShebang) {
    problems.push(
      `${name}: interpreter "node" but ${script} is a shell script (${firstLine.trim()}).\n` +
        `    Node will parse it as JavaScript and die on the first shell line.\n` +
        `    Point at the tool's real .js/.mjs entry, or set interpreter: "none".`,
    );
  }
}

if (problems.length > 0) {
  console.error('PM2 entrypoint problems:\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`OK: ${apps.length} PM2 app entrypoints match their interpreter.`);
