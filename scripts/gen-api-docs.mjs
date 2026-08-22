#!/usr/bin/env node
// Generate the /docs/api/* reference pages from the OpenAPI document.
//
//   node scripts/gen-api-docs.mjs           # write
//   node scripts/gen-api-docs.mjs --check   # fail if the committed pages drifted
//
// WHY generated: the hand-written /docs/api page covered 6 of 20 operations,
// because keeping a prose page in step with a spec is a chore nobody does
// twice. The spec in `@skillet/protocol/openapi` is the single source of truth;
// these pages are a projection of it. `/docs/api` itself stays hand-written —
// auth, errors, caching, and the stability contract are judgment, not schema.
//
// One page per OpenAPI tag, which is what makes it navigable: the docs sidebar
// lists the resources, and the per-page "On this page" rail (built from h2/h3
// by `extractHeadings`) becomes the endpoint index for that resource. The nav
// entries are emitted too, so adding an operation to the spec adds it to the
// sidebar with no hand edit.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'packages/web/content/docs/api');
const NAV_OUT = join(ROOT, 'packages/web/src/lib/docs-nav-api.generated.ts');
const SITE = 'https://skillet.md';
const REGISTRY = 'https://registry.skillet.md';

const { buildOpenApiDocument } = await import(
  join(ROOT, 'packages/protocol/dist/openapi.js')
);
const doc = buildOpenApiDocument({ siteUrl: SITE, registryUrl: REGISTRY });
const BASE = doc.servers[0].url;

const GENERATED_NOTE =
  'Generated from the OpenAPI document by `scripts/gen-api-docs.mjs`. Do not edit by hand.';

/* ----------------------------------------------------------------- schema -- */

/** Resolve a local $ref against components/schemas. */
function deref(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return node;
  if (typeof node.$ref === 'string') {
    const name = node.$ref.replace('#/components/schemas/', '');
    return deref(doc.components.schemas[name], depth + 1);
  }
  if (Array.isArray(node.allOf)) {
    // Merge the branches so an inherited object reads as one shape.
    const merged = { type: 'object', properties: {}, required: [] };
    for (const branch of node.allOf) {
      const r = deref(branch, depth + 1) ?? {};
      Object.assign(merged.properties, r.properties ?? {});
      merged.required.push(...(r.required ?? []));
    }
    return merged;
  }
  return node;
}

/** A representative value for a schema, for the sample response body. */
function sample(schema, depth = 0) {
  const s = deref(schema, depth);
  if (!s || depth > 5) return null;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];

  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  switch (type) {
    case 'object': {
      const out = {};
      for (const [key, value] of Object.entries(s.properties ?? {})) {
        out[key] = sample(value, depth + 1);
      }
      return out;
    }
    case 'array':
      return [sample(s.items, depth + 1)].filter((v) => v !== null);
    case 'integer':
      return 0;
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return s.format === 'uri' ? `${SITE}/…` : '…';
    default:
      return null;
  }
}

/**
 * Human-readable type for a parameter table cell.
 *
 * A primitive type name is PLAIN text, an enum member is code. The distinction
 * is the point: `string` names a type, `new` is a literal you type into the
 * request. It also gives the cell a visual hierarchy — the parameter name is
 * then the only pill in it, so it reads as the thing you are looking up.
 * Bolding the name instead did nothing: the mono face shows no weight
 * difference at this size, so name and type looked identical.
 */
function typeLabel(schema) {
  const s = deref(schema) ?? {};
  const type = Array.isArray(s.type) ? s.type.filter((t) => t !== 'null').join(' \\| ') : s.type;
  if (Array.isArray(s.enum)) return s.enum.map((v) => `\`${v}\``).join(' \\| ');
  if (type === 'array') return `${typeLabel(s.items)}[]`;
  return type ?? 'any';
}

/** Escape a cell so a pipe in a description cannot break the table. */
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/* -------------------------------------------------------------- rendering -- */

/** A copy-pasteable path with example values substituted for `{params}`. */
function examplePath(path, params) {
  return path.replace(/\{(\w+)\}/g, (_, name) => {
    const param = params.find((p) => p.name === name);
    const example = deref(param?.schema)?.examples?.[0];
    return example ?? name.toUpperCase();
  });
}

function curlFor(method, path, params) {
  const query = params
    .filter((p) => p.in === 'query' && p.required)
    .map((p) => {
      const example = deref(p.schema)?.examples?.[0] ?? 'VALUE';
      return `${p.name}=${encodeURIComponent(String(example))}`;
    })
    .join('&');
  const url = `${BASE}${examplePath(path, params)}${query ? `?${query}` : ''}`;
  const auth = authRequirement(method, path);
  const lines = [`curl -s "${url}"`];
  // Only show the header when the call cannot be made without it. A copyable
  // example that demands a token for an anonymous endpoint is a worse example.
  if (!auth.anonymous && auth.scopes.length) {
    lines.push(`  -H "Authorization: Bearer $SKILLET_TOKEN"`);
  }
  if (method !== 'get') lines.unshift(`# ${method.toUpperCase()}`);
  return lines.join(' \\\n');
}

/**
 * What an operation demands: whether a credential is required at all, and the
 * scopes that satisfy it.
 *
 * An EMPTY requirement object in the `security` array (`{}`) is OpenAPI for
 * "no credential needed", and it is an ALTERNATIVE to the others, not an
 * addition. The document now names a scope on every operation — including the
 * anonymous reads, as `[{}, { bearerAuth: ['read'] }]`, so an agent holding a
 * token learns that `read` is enough — which means collapsing the array to a
 * flat scope list would relabel the entire public catalog as authenticated.
 */
function authRequirement(method, path) {
  const op = doc.paths[path][method];
  const security = op.security ?? doc.security ?? [];
  const anonymous = security.some((requirement) => Object.keys(requirement).length === 0);
  const scopes = new Set();
  for (const requirement of security) {
    for (const list of Object.values(requirement)) for (const s of list) scopes.add(s);
  }
  return { anonymous, scopes: [...scopes] };
}

function renderOperation(path, method, op) {
  const params = op.parameters ?? [];
  const out = [];
  out.push(`## ${method.toUpperCase()} ${path}`);
  out.push('');
  out.push(op.description);
  out.push('');

  const { anonymous, scopes } = authRequirement(method, path);
  out.push(
    anonymous
      ? scopes.length
        ? `**Auth** — none. This endpoint is anonymous. A bearer token with the \`${scopes.join('`, `')}\` scope also works.`
        : '**Auth** — none. This endpoint is anonymous.'
      : `**Auth** — bearer token with the \`${scopes.join('`, `')}\` scope.`,
  );
  out.push('');
  out.push(`**Operation ID** — \`${op.operationId}\``);
  out.push('');

  if (params.length) {
    // Two columns, not five. The docs column is ~790px wide; `name | in | type
    // | required | description` gave every one of them a sliver and forced the
    // descriptions into ragged four-word lines. Folding the three descriptors
    // into the name cell is the same shape Stripe uses, and it reads at any
    // width.
    out.push('| Parameter | Description |');
    out.push('| --- | --- |');
    for (const p of params) {
      // One line, not a stacked cell: react-markdown runs without rehype-raw,
      // so a `<br>` would render as literal text.
      const facts = [typeLabel(p.schema), p.in, p.required ? 'required' : 'optional'];
      out.push(`| \`${p.name}\` ${facts.join(' · ')} | ${cell(p.description)} |`);
    }
    out.push('');
  }

  out.push('```bash');
  out.push(curlFor(method, path, params));
  out.push('```');
  out.push('');

  const ok = op.responses['200'];
  const schema = ok?.content?.['application/json']?.schema;
  if (schema) {
    out.push(`Returns ${ok.description.charAt(0).toLowerCase()}${ok.description.slice(1)}`);
    out.push('');
    out.push('```json');
    out.push(JSON.stringify(sample(schema), null, 2));
    out.push('```');
    out.push('');
  }

  const others = Object.entries(op.responses).filter(([code]) => code !== '200');
  if (others.length) {
    out.push('| Status | Meaning |');
    out.push('| --- | --- |');
    for (const [code, res] of others) out.push(`| \`${code}\` | ${cell(res.description)} |`);
    out.push('');
  }
  return out.join('\n');
}

function renderPage(tag, operations, order) {
  const front = [
    '---',
    `title: ${tag.name.charAt(0).toUpperCase()}${tag.name.slice(1)} API`,
    `description: ${JSON.stringify(tag.description)}`,
    `order: ${order}`,
    'section: API reference',
    '---',
    '',
    `<!-- ${GENERATED_NOTE} -->`,
    '',
    `Base URL: \`${BASE}\``,
    '',
    `Auth, errors, caching, pagination, and rate limits are in the [API overview](/docs/api). Every endpoint here is also described in [\`/openapi.json\`](${SITE}/openapi.json).`,
    '',
    '## Endpoints',
    '',
  ];
  const index = operations.map(
    ([path, method, op]) =>
      `- [\`${method.toUpperCase()} ${path}\`](#${anchor(`${method.toUpperCase()} ${path}`)}) — ${op.summary}`,
  );
  const bodies = operations.map(([path, method, op]) => renderOperation(path, method, op));
  return [...front, ...index, '', ...bodies].join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Mirror the id `extractHeadings` builds, so the index links resolve. */
function anchor(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ----------------------------------------------------------------- output -- */

const byTag = new Map();
for (const [path, item] of Object.entries(doc.paths)) {
  for (const [method, op] of Object.entries(item)) {
    for (const tag of op.tags ?? []) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push([path, method, op]);
    }
  }
}

const files = new Map();
const navItems = [];
doc.tags.forEach((tag, i) => {
  const operations = byTag.get(tag.name) ?? [];
  if (!operations.length) return;
  files.set(`${tag.name}.md`, renderPage(tag, operations, i + 1));
  navItems.push({
    title: `${tag.name.charAt(0).toUpperCase()}${tag.name.slice(1)}`,
    href: `/docs/api/${tag.name}`,
  });
});

const navSource = `// ${GENERATED_NOTE}
//
// Spread into DOC_NAV so a new operation in the spec reaches the sidebar
// without a hand edit, and so the docs coverage test keeps passing.
import type { NavItem } from './docs-nav'

export const API_REFERENCE_ITEMS: NavItem[] = [
${navItems.map((i) => `  { title: ${JSON.stringify(i.title)}, href: ${JSON.stringify(i.href)} },`).join('\n')}
]
`;

const check = process.argv.includes('--check');
const stale = [];

function reconcile(path, next) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === next) return;
  if (check) {
    stale.push(path.replace(`${ROOT}/`, ''));
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, body] of files) reconcile(join(OUT_DIR, name), body);
reconcile(NAV_OUT, navSource);

// A tag removed from the spec must not leave an orphan page behind — it would
// 404 from the sidebar and still ship in the sitemap.
for (const name of readdirSync(OUT_DIR)) {
  if (files.has(name)) continue;
  if (check) stale.push(join(OUT_DIR, name).replace(`${ROOT}/`, ''));
  else rmSync(join(OUT_DIR, name));
}

if (check) {
  if (stale.length) {
    console.error(
      `Generated API docs are stale. Run \`node scripts/gen-api-docs.mjs\`:\n  ${stale.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log('OK: /docs/api/* is up to date.');
} else {
  console.log(`Wrote ${files.size} API reference pages to content/docs/api/.`);
}
