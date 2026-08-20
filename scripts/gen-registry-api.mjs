#!/usr/bin/env node
// Generate docs/registry-api.md — an accurate HTTP route reference for the
// registry, extracted from the Fastify route registrations in source so it can't
// drift. Run: `node scripts/gen-registry-api.mjs` (or `--check` in CI to fail if
// the committed doc is stale).
//
// It reads method + path from every `app.get|post|put|patch|delete('...')` call
// under packages/registry/src, prepends the `/api/v1` version prefix to routes
// mounted under it, groups by source file, and writes a Markdown table per area.
// The curated preamble (auth model, error shape, internal routes) lives in this
// script so the whole doc regenerates from one place.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'packages/registry/src');
const OUT = join(ROOT, 'docs/registry-api.md');
const PREFIX = '/api/v1';

const INTERNAL_ONLY = ['/api/v1/auth/web', '/api/v1/auth/link', '/api/v1/github/repos'];

/** Recursively list *.ts files (skip tests + dist). */
function tsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === 'dist' || name === 'node_modules') continue;
      out.push(...tsFiles(p));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

// method + optional (possibly multi-line) generic type args + the path string.
const ROUTE_RE =
  /\bapp\.(get|post|put|patch|delete)\s*(?:<[\s\S]*?>)?\s*\(\s*[`'"]([^`'"]+)[`'"]/g;

const byFile = new Map();
for (const file of tsFiles(SRC)) {
  const text = readFileSync(file, 'utf8');
  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(text)) !== null) {
    const method = m[1].toUpperCase();
    const raw = m[2];
    if (!raw.startsWith('/')) continue; // skip non-path first args
    // Routes inside the /api/v1 mount use bare paths (`/skills`); root-level
    // routes hardcode the full path (`/api/v1/...` or the unversioned `/api/hc`).
    // Anything already under `/api/` is absolute — only bare paths get the prefix.
    const path = raw.startsWith('/api/') ? raw : PREFIX + raw;
    const rel = relative(ROOT, file);
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push({ method, path });
  }
}

function areaTitle(relPath) {
  const b = basename(relPath).replace(/\.ts$/, '');
  return b
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const METHOD_ORDER = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 };
const groups = [...byFile.entries()]
  .map(([file, routes]) => ({ file, title: areaTitle(file), routes }))
  .sort((a, b) => a.title.localeCompare(b.title));

let total = 0;
for (const g of groups) {
  g.routes.sort(
    (a, b) => a.path.localeCompare(b.path) || METHOD_ORDER[a.method] - METHOD_ORDER[b.method],
  );
  total += g.routes.length;
}

function isInternal(path) {
  return INTERNAL_ONLY.some((p) => path === p || path.startsWith(`${p}/`));
}

const lines = [];
lines.push('# Registry HTTP API');
lines.push('');
lines.push(
  '> Generated from the Fastify route registrations in `packages/registry/src` by',
);
lines.push(
  '> `scripts/gen-registry-api.mjs`. Do not edit by hand — run the script to refresh.',
);
lines.push('');
lines.push(
  'The registry (`@skillet/registry`) is the source of truth: a Fastify + Prisma/MySQL',
);
lines.push(
  'service. This is the route map a self-hoster needs; conceptual detail lives in the',
);
lines.push('main [README](../README.md) and [packages/registry/README.md](../packages/registry/README.md).');
lines.push('');
lines.push('## Conventions');
lines.push('');
lines.push(`- **Base path.** Every route is under \`${PREFIX}\`. Health check: \`GET /api/hc\`.`);
lines.push(
  '- **Auth.** Bearer tokens in `Authorization` — `skillet_s_` session, `skillet_d_`',
);
lines.push(
  '  device, `skillet_m_` MCP-link. Public reads work unauthenticated; write and',
);
lines.push('  account routes require the right token class.');
lines.push(
  '- **Internal routes (BFF only).** Routes marked 🔒 let the trusted web BFF act on any',
);
lines.push(
  '  account. They require the web-internal HMAC signature, must never be internet-routable,',
);
lines.push(
  '  and can be origin-locked with `SKILLET_INTERNAL_ORIGIN_ALLOWLIST` (they 404 for any',
);
lines.push('  other peer). See the README Operations section.');
lines.push(
  '- **Errors.** 4xx carry `{ error }` (and sometimes `code`/`message`); 5xx are reduced to',
);
lines.push('  `{ error: "internal", request_id }` with the detail logged server-side.');
lines.push(
  '- **Rate limits.** Per-client-IP classes (ambient / write / heavy); see',
);
lines.push('  `packages/registry/README.md`.');
lines.push('');
lines.push(`_${total} routes across ${groups.length} areas._`);
lines.push('');

for (const g of groups) {
  lines.push(`## ${g.title}`);
  lines.push('');
  lines.push('| Method | Path |');
  lines.push('| --- | --- |');
  for (const r of g.routes) {
    const mark = isInternal(r.path) ? ' 🔒' : '';
    lines.push(`| ${r.method} | \`${r.path}\`${mark} |`);
  }
  lines.push('');
}

const rendered = lines.join('\n');

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    /* missing → stale */
  }
  if (current !== rendered) {
    console.error(
      'docs/registry-api.md is stale. Run: node scripts/gen-registry-api.mjs',
    );
    process.exit(1);
  }
  console.log('OK: docs/registry-api.md is up to date.');
} else {
  writeFileSync(OUT, rendered);
  console.log(`Wrote ${relative(ROOT, OUT)} — ${total} routes, ${groups.length} areas.`);
}
