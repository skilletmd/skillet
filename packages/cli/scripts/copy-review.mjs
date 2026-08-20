// Copy-review page generator: captures every `--help` screen live from source
// and inventories every user-facing reply string in src/, then renders one
// HTML page for reviewing CLI copy (not functionality).
//
// Consecutive print calls merge into one "screen" block — the page shows what
// a user sees per moment, not one card per console.log.
//
// Run from packages/cli:
//   node --import tsx/esm scripts/copy-review.mjs
// Output: packages/cli/copy-review.html (gitignored). Open it in a browser,
// edit src/, rerun, refresh.
//
// Signed-in transcripts (optional): start a LOCAL dev registry with dev auth,
//   SKILLET_ENABLE_DEV_AUTH=1 pnpm dev:registry     (repo root)
// then rerun this script. It mints a throwaway account, pairs a throwaway
// HOME, seeds two fixture skills, and captures the connected-state voice.
// Nothing touches real state: fresh HOME + SKILLET_REGISTRY_URL/WEB_URL
// pinned to localhost for those scenarios only. Without the registry the
// script degrades to signed-out sets plus a how-to note on the page.
// Override the target with COPY_REVIEW_REGISTRY / COPY_REVIEW_WEB.
import { Command } from 'commander';
import { registerAllCommands } from '../src/commands/register-all.js';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(pkgRoot, 'src');

// ---------------------------------------------------------------- command tree

function walk(cmd, path = []) {
  const out = [];
  for (const sub of cmd.commands) {
    const p = [...path, sub.name()];
    out.push({ path: p, hidden: sub._hidden === true, description: sub.description() });
    out.push(...walk(sub, p));
  }
  return out;
}

const defaultProgram = new Command('skillet');
registerAllCommands(defaultProgram);
const defaultCmds = walk(defaultProgram);

const fullProgram = new Command('skillet');
registerAllCommands(fullProgram, { legacyManagement: true });
const allCmds = walk(fullProgram);
const defaultKeys = new Set(defaultCmds.map((c) => c.path.join(' ')));
for (const c of allCmds) if (!defaultKeys.has(c.path.join(' '))) c.legacy = true;

// ---------------------------------------------------------------- help capture

// Scrub dev env so captured copy shows production URLs, and force the legacy
// flag only for legacy verbs so the default surface stays what users see.
function spawnEnv(legacy) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('SKILLET_')) delete env[k];
  if (legacy) env.SKILLET_LEGACY_CLI = '1';
  env.SKILLET_FORCE_COLOR = '1'; // captured output keeps its real look; ANSI → HTML below
  return env;
}

async function captureHelp(pathParts, legacy) {
  const args = ['--import', 'tsx/esm', 'src/index.ts', ...pathParts, '--help'];
  try {
    const { stdout, stderr } = await execFileP(process.execPath, args, {
      cwd: pkgRoot,
      env: spawnEnv(legacy),
      timeout: 30_000,
    });
    return (stdout + stderr).trimEnd();
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trimEnd();
    return out || `(help capture failed: ${err.message})`;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

console.log(`Capturing ${allCmds.length + 1} help screens…`);
const rootHelp = await captureHelp([], false);
const helps = await mapLimit(allCmds, 8, async (c) => {
  const text = await captureHelp(c.path, c.legacy === true);
  process.stdout.write('.');
  return { ...c, help: text };
});
console.log('');

// ---------------------------------------------------------------- transcripts

// Real runs against a throwaway HOME — true run order and true branching, no
// mocks. This is the signed-out fresh-machine experience; interactive prompts
// skip themselves because stdout is piped. Sequential on one sandbox so state
// accumulates the way it would for a real user running these in order.
const SCENARIOS = [
  { cmd: [], note: 'bare command — the onboarding wizard, in actual run order' },
  {
    cmd: [],
    note: 'bare command on a machine whose session was revoked (the re-pair path)',
    home: 'revoked',
    tty: 'In a real terminal this prompts inline: Pair code · "Paste your code · Esc to skip" — pasting reconnects and re-syncs on the spot.',
  },
  {
    cmd: ['connect'],
    note: 'missing pair code',
    tty: 'In a real terminal this prompts inline: Pair code · "Paste your code · Esc to cancel". This fallback text is what scripts and pipes get.',
  },
  { cmd: ['connect', 'WRONGCD1'], note: 'bad pair code' },
  { cmd: ['sync'] },
  { cmd: ['list'] },
  { cmd: ['whoami'] },
  { cmd: ['upload'] },
  { cmd: ['doctor'] },
];

// Scenario runs use the fresh BUNDLE, not tsx/src: the bundle runs from any
// cwd, and cwd must be the sandbox HOME — sync treats cwd as the project root
// (lockfile, project adapters), so running from pkgRoot would write state
// into the repo.
const CLI_BUNDLE = join(pkgRoot, 'dist', 'cli.cjs');
console.log('Bundling CLI for transcript capture…');
await new Promise((resolve, reject) => {
  const b = spawn(process.execPath, [join(pkgRoot, 'scripts', 'bundle-cli.mjs')], {
    cwd: pkgRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  b.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`bundle exited ${code}`))));
});

function captureTranscript(cmdParts, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_BUNDLE, ...cmdParts], {
      cwd: env.HOME ?? pkgRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ out: out.trimEnd(), code });
    });
  });
}

const sandbox = mkdtempSync(join(tmpdir(), 'skillet-copy-review-'));
// A machine with a dead device token: the registry 401s it, which is exactly
// the state after a device is removed on web Settings or its row reclaimed.
const revokedSandbox = mkdtempSync(join(tmpdir(), 'skillet-copy-review-revoked-'));
mkdirSync(join(revokedSandbox, '.skillet'), { recursive: true });
writeFileSync(
  join(revokedSandbox, '.skillet', 'device.json'),
  JSON.stringify({ device_token: 'skillet_d_dead', device_id: 'dead-device', saved_at: new Date().toISOString() }, null, 2) + '\n',
);
console.log('Recording fresh-machine transcripts…');
const transcripts = [];
for (const s of SCENARIOS) {
  const home = s.home === 'revoked' ? revokedSandbox : sandbox;
  const { out, code } = await captureTranscript(s.cmd, { ...spawnEnv(false), HOME: home });
  transcripts.push({ ...s, out, code });
  process.stdout.write('.');
}
console.log('');

// ---------------------------------------------------- signed-in transcripts

const DEV_REGISTRY = process.env.COPY_REVIEW_REGISTRY ?? 'http://localhost:3481';
const DEV_WEB = process.env.COPY_REVIEW_WEB ?? 'http://localhost:3000';

async function devFetch(path, { method = 'GET', bearer, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return fetch(`${DEV_REGISTRY}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(4000),
  });
}

// Mint account → pair code → pair a fresh sandbox HOME via the real CLI →
// seed two fixture skills. Returns { env, pairedTranscript } or { skip }.
async function setupPairedSandbox() {
  try {
    const mint = await devFetch('/api/v1/sessions/dev', {
      method: 'POST',
      body: { handle: 'copy-review', two_factor: true },
    });
    if (!mint.ok) {
      return {
        skip:
          mint.status === 404
            ? 'dev auth is disabled on the registry (start it with SKILLET_ENABLE_DEV_AUTH=1)'
            : `sessions/dev returned HTTP ${mint.status}`,
      };
    }
    const { session_token } = await mint.json();
    const codeRes = await devFetch('/api/v1/connect/codes', { method: 'POST', bearer: session_token, body: {} });
    if (!codeRes.ok) return { skip: `connect/codes returned HTTP ${codeRes.status}` };
    const { code: pairCode } = await codeRes.json();

    const home = mkdtempSync(join(tmpdir(), 'skillet-copy-review-paired-'));
    const env = {
      ...spawnEnv(false),
      HOME: home,
      SKILLET_REGISTRY_URL: DEV_REGISTRY,
      SKILLET_WEB_URL: DEV_WEB,
    };
    // Fixture skills so list/sync/upload have stable material (R3).
    const fixtures = [
      ['brand-voice', 'House style for anything written'],
      ['release-notes', 'Turn merged PRs into release notes'],
      ['add-me', 'Fixture left uninstalled so the add transcript is a real first install'],
    ];
    for (const [slug, desc] of fixtures) {
      const dir = join(home, `fixture-${slug}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${desc}\n---\n\n${desc}.\n`);
    }

    const paired = await captureTranscript(['connect', pairCode], env);
    if (paired.code !== 0)
      return { skip: `connect exited ${paired.code}: ${paired.out.replace(/\[[0-9;]*m/g, '').slice(0, 120)}` };
    // Seed quietly; the human voices of import/upload are captured as scenarios.
    for (const [slug] of fixtures.slice(0, 2)) {
      await captureTranscript(['import', join(home, `fixture-${slug}`)], env);
    }
    await captureTranscript(['upload', '--all', '--json'], env);
    return {
      env,
      pairedTranscript: {
        cmd: ['connect', '<code>'],
        note: 'pairing a fresh machine against the local dev registry (code redacted)',
        out: paired.out,
        code: paired.code,
      },
    };
  } catch (err) {
    return { skip: `no dev registry answering at ${DEV_REGISTRY} (${err?.message ?? err})` };
  }
}

const SIGNED_IN_SCENARIOS = [
  { cmd: [], note: 'bare command on a healthy paired machine' },
  { cmd: ['sync'] },
  { cmd: ['list'] },
  { cmd: ['status'] },
  { cmd: ['usage'] },
  { cmd: ['whoami'] },
  { cmd: ['upload'] },
  { cmd: ['add'], note: 'missing source' },
  { cmd: ['add', 'fixture-add-me', '--yes'], note: 'local-path install, non-interactive' },
];

console.log('Recording signed-in transcripts…');
const pairedSetup = await setupPairedSandbox();
const signedInTranscripts = [];
let signedInSkipReason = null;
if (pairedSetup.skip) {
  signedInSkipReason = pairedSetup.skip;
  console.log(`  skipped: ${signedInSkipReason}`);
} else {
  signedInTranscripts.push(pairedSetup.pairedTranscript);
  for (const s of SIGNED_IN_SCENARIOS) {
    const { out, code } = await captureTranscript(s.cmd, pairedSetup.env);
    signedInTranscripts.push({ ...s, out, code });
    process.stdout.write('.');
  }
  console.log('');
}

// ------------------------------------------------------------- reply strings

// Find user-facing print calls and pull the string/template literals out of
// their argument list. Heuristic by design — it's a copy inventory, not an AST.
const CALL_HEAD =
  /\b(console\.(?:log|error|warn)|process\.std(?:out|err)\.write|(?:clack|p)\.(?:intro|outro|note|text|select|multiselect|confirm|log\.(?:info|warn|error|success|message|step)))\s*\(/g;

function sliceCallArgs(text, openParenIdx) {
  let depth = 1;
  let i = openParenIdx + 1;
  let mode = null; // ', ", `, or null
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (mode) {
      if (ch === '\\') i += 1;
      else if (mode === '`' && ch === '$' && text[i + 1] === '{') {
        let b = 1;
        i += 2;
        while (i < text.length && b > 0) {
          if (text[i] === '{') b += 1;
          else if (text[i] === '}') b -= 1;
          i += 1;
        }
        continue;
      } else if (ch === mode) mode = null;
    } else if (ch === "'" || ch === '"' || ch === '`') mode = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    i += 1;
  }
  return text.slice(openParenIdx + 1, i - 1);
}

function extractLiterals(argText) {
  const found = [];
  let i = 0;
  while (i < argText.length) {
    const ch = argText[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let out = '';
      i += 1;
      while (i < argText.length) {
        const c = argText[i];
        if (c === '\\') {
          const n = argText[i + 1];
          out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          i += 2;
          continue;
        }
        if (quote === '`' && c === '$' && argText[i + 1] === '{') {
          let b = 1;
          let expr = '';
          i += 2;
          while (i < argText.length && b > 0) {
            if (argText[i] === '{') b += 1;
            else if (argText[i] === '}') b -= 1;
            if (b > 0) expr += argText[i];
            i += 1;
          }
          out += '${' + expr + '}';
          continue;
        }
        if (c === quote) break;
        out += c;
        i += 1;
      }
      found.push(out);
    }
    i += 1;
  }
  return found.filter((s) => s.trim().length > 0);
}

function tsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

// help/ + help-format are already captured live above — skip to avoid noise.
const SKIP = [join(srcRoot, 'help'), join(srcRoot, 'help-format.ts')];

const calls = []; // { file, line, strings[] }
for (const file of tsFiles(srcRoot)) {
  if (SKIP.some((s) => file.startsWith(s))) continue;
  const text = readFileSync(file, 'utf8');
  CALL_HEAD.lastIndex = 0;
  let m;
  while ((m = CALL_HEAD.exec(text)) !== null) {
    const args = sliceCallArgs(text, m.index + m[0].length - 1);
    const strings = extractLiterals(args);
    if (strings.length === 0) continue;
    const line = text.slice(0, m.index).split('\n').length;
    const endLine = line + text.slice(m.index, CALL_HEAD.lastIndex + args.length).split('\n').length - 1;
    calls.push({ file: relative(srcRoot, file), line, endLine, strings });
  }
}

// Merge consecutive calls (≤3 source lines apart) into one "screen" block —
// that's one moment of terminal output as the user experiences it.
const blocks = []; // { file, line, text }
for (const call of calls) {
  const prev = blocks[blocks.length - 1];
  const text = call.strings.join('\n');
  if (prev && prev.file === call.file && call.line - prev.endLine <= 3) {
    prev.text += '\n' + text;
    prev.endLine = call.endLine;
  } else {
    blocks.push({ file: call.file, line: call.line, endLine: call.endLine, text });
  }
}
for (const b of blocks) b.text = b.text.replace(/\n{3,}/g, '\n\n').trim();

// Group reply files under the command they belong to; the rest are shared.
function commandForFile(relFile) {
  if (relFile === 'index.ts') return '__wizard__';
  const m = relFile.match(/^commands\/([^/]+)/);
  if (!m) return '__shared__';
  const base = m[1].replace(/\.ts$/, '');
  const alias = {
    'add-cmd': 'add',
    'import-cmd': 'import',
    'upload-cmd': 'upload',
    'route-cmd': 'route',
    'web-cmd': 'web',
    'login-legacy': 'login',
    'register-management-commands': '__shared__',
    'register-all': '__shared__',
  };
  return alias[base] ?? base;
}

const blockGroups = new Map();
for (const b of blocks) {
  const key = commandForFile(b.file);
  if (!blockGroups.has(key)) blockGroups.set(key, []);
  blockGroups.get(key).push(b);
}

// Journey groups mirror the root help surface so the page reads as flows.
const JOURNEYS = [
  ['Getting started', ['connect', 'web', 'whoami', 'auth', 'device', 'avatar']],
  ['Skills in and out', ['add', 'import', 'export', 'upload']],
  ['Sync & agents', ['sync', 'list', 'scan', 'status', 'runtimes', 'doctor']],
  ['Updates & edits', ['pending', 'approve', 'reject', 'update-mode', 'edits', 'restore', 'sweep', 'trust', 'pin']],
  ['Agents & privacy', ['mcp', 'route', 'usage', 'activity']],
];

// ------------------------------------------------------------------ HTML page

const esc = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Captured output carries real ANSI codes (SKILLET_FORCE_COLOR). Map the small
// set the CLI uses to spans; anything else is stripped.
const stripAnsi = (s) => s.replace(/\[[0-9;]*m/g, '');

function ansiToHtml(s) {
  let out = '';
  let open = 0;
  for (const part of s.split(/(\[[0-9;]*m)/)) {
    const m = part.match(/^\[([0-9;]*)m$/);
    if (!m) {
      out += esc(part);
      continue;
    }
    for (const code of (m[1] || '0').split(';')) {
      if (code === '0' || code === '') {
        out += '</span>'.repeat(open);
        open = 0;
      } else {
        out += `<span class="a${code}">`;
        open += 1;
      }
    }
  }
  return out + '</span>'.repeat(open);
}

// Render ${expr} placeholders as compact chips; long expressions get elided.
const withVars = (s) =>
  esc(s).replace(/\$\{([^}]*)\}/g, (_, e) => {
    let t = e.trim();
    if (t.length > 24) t = t.slice(0, 14) + '…' + t.slice(-8);
    return `<span class="var">${t}</span>`;
  });

function blockRows(items) {
  return items
    .map(
      (b) => `<div class="screen">
        <div class="screen-loc">src/${esc(b.file)}:${b.line}</div>
        <pre class="screen-text">${withVars(b.text)}</pre>
      </div>`,
    )
    .join('');
}

const helpByKey = new Map(helps.map((c) => [c.path.join(' '), c]));
const childrenOf = (name) =>
  helps.filter((c) => c.path.length > 1 && c.path[0] === name);

function commandSection(name) {
  const c = helpByKey.get(name);
  if (!c) return '';
  const kids = childrenOf(name);
  const group = blockGroups.get(name) ?? [];
  blockGroups.delete(name);
  const search = stripAnsi([name, c.description, c.help, ...kids.map((k) => k.help), ...group.map((b) => b.text)].join(' ')).toLowerCase();
  return `<section class="cmd" id="cmd-${name}" data-search="${esc(search)}">
    <h2><span class="prompt">skillet</span> ${esc(name)}${c.legacy ? ' <span class="tag">legacy</span>' : ''}${c.hidden && !c.legacy ? ' <span class="tag">hidden</span>' : ''}<span class="desc">${esc(c.description ?? '')}</span></h2>
    ${group.length ? blockRows(group) : ''}
    <details><summary>help screen${kids.length ? ` + ${kids.length} subcommand${kids.length === 1 ? '' : 's'}` : ''}</summary>
      <pre class="term">${ansiToHtml(c.help)}</pre>
      ${kids.map((k) => `<div class="sub-h">skillet ${esc(k.path.join(' '))}</div><pre class="term">${ansiToHtml(k.help)}</pre>`).join('')}
    </details>
  </section>`;
}

const wizardBlocks = blockGroups.get('__wizard__') ?? [];
blockGroups.delete('__wizard__');

const journeyNames = new Set(JOURNEYS.flatMap(([, names]) => names));
const legacyNames = helps.filter((c) => c.path.length === 1 && c.legacy).map((c) => c.path[0]);
const otherNames = helps
  .filter((c) => c.path.length === 1 && !c.legacy && !journeyNames.has(c.path[0]))
  .map((c) => c.path[0]);

function journeySection(title, names) {
  const sections = names.map(commandSection).filter(Boolean).join('');
  if (!sections) return '';
  const id = 'j-' + title.toLowerCase().replace(/[^a-z]+/g, '-');
  return `<div class="journey" id="${id}"><h1 class="journey-h">${esc(title)}</h1>${sections}</div>`;
}

const transcriptsHtml = `<div class="journey" id="j-transcripts">
  <h1 class="journey-h">Live transcripts <span class="muted">(fresh machine, signed out — real output in real run order)</span></h1>
  ${transcripts
    .map(
      (t) => `<section class="cmd" data-search="${esc(stripAnsi(t.cmd.join(' ') + ' ' + t.out).toLowerCase())}">
    <h2><span class="prompt">$</span> skillet${t.cmd.length ? ' ' + esc(t.cmd.join(' ')) : ''}${t.note ? `<span class="desc">${esc(t.note)}</span>` : ''}</h2>
    <pre class="term">${ansiToHtml(t.out)}${t.code !== 0 ? `\n<span class="exit">exit ${t.code}</span>` : ''}</pre>
    ${t.tty ? `<div class="tty-note">⌨ ${esc(t.tty)}</div>` : ''}
  </section>`,
    )
    .join('')}</div>`;

const signedInHtml = signedInSkipReason
  ? `<div class="journey" id="j-signedin">
  <h1 class="journey-h">Signed in <span class="muted">(skipped)</span></h1>
  <div class="tty-note">Signed-in transcripts skipped: ${esc(signedInSkipReason)}.<br>Start a local registry with <code>SKILLET_ENABLE_DEV_AUTH=1 pnpm dev:registry</code> and rerun this script to capture the connected-state voice.</div>
</div>`
  : `<div class="journey" id="j-signedin">
  <h1 class="journey-h">Signed in <span class="muted">(local dev registry — URLs shown are dev, prod says skillet.md)</span></h1>
  ${signedInTranscripts
    .map(
      (t) => `<section class="cmd" data-search="${esc(stripAnsi('signed in ' + t.cmd.join(' ') + ' ' + t.out).toLowerCase())}">
    <h2><span class="prompt">$</span> skillet${t.cmd.length ? ' ' + esc(t.cmd.join(' ')) : ''}${t.note ? `<span class="desc">${esc(t.note)}</span>` : ''}</h2>
    <pre class="term">${ansiToHtml(t.out)}${t.code !== 0 ? `\n<span class="exit">exit ${t.code}</span>` : ''}</pre>
  </section>`,
    )
    .join('')}</div>`;

const journeysHtml =
  `<div class="journey" id="j-first-run">
    <h1 class="journey-h">First run <span class="muted">(every branch — success, error, skip; source order)</span></h1>
    <section class="cmd" id="wizard" data-search="first run wizard onboarding ${esc(wizardBlocks.map((b) => b.text).join(' ').toLowerCase())}">
      <h2><span class="prompt">$</span> skillet <span class="desc">all wizard screens incl. branches the transcript above didn't hit (connected, sync errors)</span></h2>
      ${blockRows(wizardBlocks)}
      <details><summary>root help screen (<code>skillet --help</code>)</summary><pre class="term">${ansiToHtml(rootHelp)}</pre></details>
    </section>
  </div>` +
  JOURNEYS.map(([title, names]) => journeySection(title, names)).join('') +
  journeySection('Everything else', otherNames);

const legacyHtml = legacyNames.length
  ? `<div class="journey" id="j-legacy"><h1 class="journey-h">Legacy <span class="muted">(SKILLET_LEGACY_CLI=1, deprecation-hint copy)</span></h1>
      <details class="legacy-fold"><summary>${legacyNames.length} legacy commands</summary>${legacyNames.map(commandSection).join('')}</details></div>`
  : '';

const sharedFiles = [...new Set((blockGroups.get('__shared__') ?? []).map((b) => b.file))].sort();
const sharedHtml = `<div class="journey" id="j-shared"><h1 class="journey-h">Shared messages <span class="muted">(used across commands)</span></h1>
  ${sharedFiles
    .map((f) => {
      const items = (blockGroups.get('__shared__') ?? []).filter((b) => b.file === f);
      return `<section class="cmd" data-search="${esc(items.map((b) => b.text).join(' ').toLowerCase())}">
        <h2 class="file-h">src/${esc(f)}</h2>${blockRows(items)}</section>`;
    })
    .join('')}</div>`;

const navGroups = [
  ['Transcripts', ['#j-transcripts', '#j-signedin']],
  ['First run', ['#wizard']],
  ...JOURNEYS.map(([title, names]) => [
    title,
    names.filter((n) => helpByKey.has(n)).map((n) => `#cmd-${n}`),
  ]),
  ['Everything else', otherNames.map((n) => `#cmd-${n}`)],
  ['More', ['#j-legacy', '#j-shared']],
];
const navHtml = navGroups
  .map(([title, hrefs]) => {
    if (hrefs.length === 0) return '';
    const links = hrefs
      .map((h) => {
        const label =
          h === '#j-transcripts' ? 'live runs' : h === '#j-signedin' ? 'signed in' : h === '#wizard' ? 'wizard' : h === '#j-legacy' ? 'legacy' : h === '#j-shared' ? 'shared' : h.replace('#cmd-', '');
        return `<a href="${h}">${esc(label)}</a>`;
      })
      .join('');
    return `<div class="nav-g"><div class="nav-t">${esc(title)}</div>${links}</div>`;
  })
  .join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skillet CLI copy review</title>
<style>
  :root { --ink: #1a1712; --ink-2: #6f675c; --line: #e6e0d6; --bg: #faf7f2; --card: #fff; --accent: #b4552d; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ece7de; --ink-2: #9a917f; --line: #2e2b25; --bg: #171512; --card: #1e1b17; } }
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  .layout { display: flex; justify-content: center; gap: 34px; padding: 28px 20px; }
  nav { position: sticky; top: 28px; align-self: start; width: 150px; flex: none; max-height: calc(100vh - 56px); overflow-y: auto; }
  .nav-t { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-2); margin: 12px 0 3px; }
  .nav-g:first-child .nav-t { margin-top: 0; }
  nav a { display: block; color: var(--ink-2); text-decoration: none; padding: 1.5px 8px; border-radius: 6px; font-size: 12.5px; }
  nav a:hover { color: var(--ink); background: var(--card); }
  main { width: 100%; max-width: 640px; min-width: 0; }
  header h1 { font-size: 20px; }
  header .sub { color: var(--ink-2); font-size: 12.5px; margin-top: 2px; }
  #filter { width: 100%; margin: 14px 0 4px; padding: 8px 12px; font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
  .journey-h { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin: 34px 0 4px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  .muted { color: var(--ink-2); text-transform: none; letter-spacing: 0; font-weight: 400; }
  section.cmd { margin: 18px 0 24px; }
  h2 { font-size: 14px; font-family: ui-monospace, SF Mono, Menlo, monospace; margin-bottom: 6px; font-weight: 600; }
  h2 .prompt { color: var(--ink-2); font-weight: 400; }
  h2 .desc { display: block; font: 12px/1.4 -apple-system, system-ui, sans-serif; color: var(--ink-2); font-weight: 400; margin-top: 1px; }
  h2.file-h { font-size: 12px; color: var(--ink-2); font-weight: 400; }
  .tag { font: 9.5px/1 -apple-system, system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); border: 1px solid currentColor; border-radius: 4px; padding: 1.5px 4px; vertical-align: 2px; margin-left: 4px; }
  .screen { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px 11px; margin: 5px 0; }
  .screen-loc { float: right; margin: 1px 0 3px 12px; font: 10px/1.4 ui-monospace, SF Mono, Menlo, monospace; color: var(--ink-2); opacity: 0.7; }
  .screen-text { font: 12px/1.55 ui-monospace, SF Mono, Menlo, monospace; white-space: pre-wrap; overflow-wrap: break-word; }
  .var { background: color-mix(in srgb, var(--accent) 13%, transparent); color: var(--accent); border-radius: 4px; padding: 0 3px; font-size: 10.5px; }
  details { margin: 6px 0; }
  summary { font-size: 11.5px; color: var(--ink-2); cursor: pointer; user-select: none; }
  summary:hover { color: var(--ink); }
  pre.term { background: #16130e; color: #e8e2d6; padding: 12px 14px; border-radius: 8px; overflow-x: auto; font: 11.5px/1.55 ui-monospace, SF Mono, Menlo, monospace; margin: 8px 0; }
  .sub-h { font: 600 12px/1 ui-monospace, SF Mono, Menlo, monospace; margin: 12px 0 0; }
  .exit { color: #8a8272; }
  .tty-note { font-size: 11.5px; color: var(--ink-2); margin: 4px 2px 0; }
  /* ANSI palette for captured output */
  .a1 { font-weight: 700; } .a2 { opacity: 0.55; }
  .a31 { color: #e0605e; } .a32 { color: #63b06c; } .a33 { color: #d4a94f; } .a36 { color: #5eb3d0; }
  .legacy-fold > summary { font-size: 13px; padding: 6px 0; }
  .hit-hidden { display: none; }
</style></head><body>
<div class="layout">
  <nav>${navHtml}</nav>
  <main>
    <header>
      <h1>Skillet CLI copy review</h1>
      <div class="sub">${helps.length + 1} help screens · ${blocks.length} reply screens · regenerate: <code>node --import tsx/esm scripts/copy-review.mjs</code></div>
      <input id="filter" type="search" placeholder="Filter commands and copy…">
    </header>
    ${transcriptsHtml}
    ${signedInHtml}
    ${journeysHtml}
    ${legacyHtml}
    ${sharedHtml}
  </main>
</div>
<script>
  const input = document.getElementById('filter');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('section.cmd').forEach((s) => {
      s.classList.toggle('hit-hidden', q !== '' && !(s.dataset.search || '').includes(q));
    });
    document.querySelectorAll('.legacy-fold').forEach((d) => { if (q) d.open = true; });
  });
</script>
</body></html>`;

const outPath = join(pkgRoot, 'copy-review.html');
writeFileSync(outPath, html);
console.log(`Wrote ${outPath} (${helps.length + 1} help screens, ${blocks.length} reply screens)`);
