// U5 — Labeled benign / near-miss capability corpus.
//
// This corpus is the ground truth behind the installer's empty state. The
// decisive claim it defends is: "No capabilities detected" must be TRUSTWORTHY
// — a skill that actually runs shell / talks to the network / touches files must
// NEVER show an empty manifest. So every fixture that genuinely uses a
// capability records it in `expectCapabilities`, and the eval (eval.ts) treats a
// MISSED capability as a hard failure (it would make "empty = inert" a lie).
//
// Capabilities are advisory, not a gate (KTD5 / R8): a noisy / over-reported
// chip is acceptable, an under-report is not. So this corpus also pins the
// *exact* current detector output per fixture (`expectExact`) — including the
// accepted over-reports on near-miss prose (negation is not parsed; conceptual
// mentions of "API key" still flag reads-secrets). Those over-reports are
// documented, not bugs: they err toward showing more, which is the safe
// direction for the installer.
//
// Fixtures run through `runCapabilityScan([...CODE, ...PROSE])` exactly as the
// scan pipeline will, so the corpus exercises the real wiring, not the detectors
// in isolation.

import type { Capability } from './types.js';

/** The closed capability set, as an array for coverage iteration. */
export const CAPABILITIES: Capability[] = [
  'runs-shell',
  'network',
  'writes-files',
  'deletes-files',
  'reads-secrets',
  'install-hooks',
  'connects-mcp-server',
  'executes-generated',
  'injects-output-content',
];

/** Coarse fixture class, for grouping in the eval report and corpus tests. */
export type CapabilityFixtureKind =
  | 'benign-code' // a real script using a capability benignly
  | 'instruction-only' // SKILL.md prose that tells the agent to act (no scripts)
  | 'inert' // pure docs: no scripts, no commands → empty manifest
  | 'near-miss' // resembles a capability but is a warning / glossary
  | 'unhandled'; // executable content NO detector inspects → empty BUT `partial`

export interface CapabilityCorpusEntry {
  id: string;
  kind: CapabilityFixtureKind;
  /** Human note for the eval report. */
  label: string;
  /** Bundle as path → file text; converted to a DecodedBundle by `toBundle`. */
  bundle: Record<string, string>;
  /**
   * GROUND TRUTH: capabilities the fixture genuinely uses. These MUST be
   * detected (recall = 100%; a miss breaks "empty = inert"). For `near-miss`
   * fixtures that genuinely use nothing, this is empty even though the heuristic
   * over-reports (see `expectExact`).
   */
  expectCapabilities: Capability[];
  /** True for `inert` fixtures: detection must be empty. */
  expectInert?: boolean;
  /**
   * The EXACT capability set the current detectors emit (sorted). Pins behavior
   * so detector changes are visible. For benign/instruction fixtures this equals
   * `expectCapabilities`; for near-miss fixtures it is the (larger) accepted
   * over-report. Omit only if exactness is intentionally not asserted.
   */
  expectExact?: Capability[];
  /**
   * Expected `analysis` flag. `'partial'` for fixtures that carry
   * executable content NO detector inspects (an unhandled language, a binary
   * script-shaped file): their empty manifest must be qualified as partial, not
   * read as inert. Omit to assert `'full'` is not required (defaults unchecked).
   */
  expectAnalysis?: 'full' | 'partial';
  note?: string;
}

export const CAPABILITY_CORPUS: CapabilityCorpusEntry[] = [
  // --- benign code: one (or more) per capability ---------------------------
  {
    id: 'benign-shell-subprocess-py',
    kind: 'benign-code',
    label: 'benign subprocess.run(["ls"]) — runs shell, not risky (AE1)',
    bundle: {
      'scripts/list.py': 'import subprocess\nresult = subprocess.run(["ls", "-la"], capture_output=True)\n',
    },
    expectCapabilities: ['runs-shell'],
    expectExact: ['runs-shell'],
  },
  {
    id: 'benign-network-fetch-js',
    kind: 'benign-code',
    label: 'benign fetch() to an API — network',
    bundle: {
      'scripts/load.mjs': 'const res = await fetch("https://api.example.com/data");\nconst json = await res.json();\n',
    },
    expectCapabilities: ['network'],
    expectExact: ['network'],
  },
  {
    id: 'benign-network-requests-py',
    kind: 'benign-code',
    label: 'benign requests.get — network (Python)',
    bundle: {
      'scripts/get.py': 'import requests\nresp = requests.get("https://api.example.com/items")\nprint(resp.status_code)\n',
    },
    expectCapabilities: ['network'],
    expectExact: ['network'],
  },
  {
    id: 'benign-writes-fs-js',
    kind: 'benign-code',
    label: 'benign fs.writeFileSync — writes files',
    bundle: {
      'scripts/save.js': "import fs from 'node:fs';\nfs.writeFileSync('./out.txt', data);\n",
    },
    expectCapabilities: ['writes-files'],
    expectExact: ['writes-files'],
  },
  {
    id: 'benign-deletes-fs-js',
    kind: 'benign-code',
    label: 'benign fs.rmSync of a temp dir — deletes files',
    bundle: {
      'scripts/clean.js': "import fs from 'node:fs';\nfs.rmSync('./tmp/cache', { recursive: true });\n",
    },
    expectCapabilities: ['deletes-files'],
    expectExact: ['deletes-files'],
  },
  {
    id: 'benign-secrets-env-js',
    kind: 'benign-code',
    label: 'benign process.env read — reads secrets',
    bundle: {
      'scripts/auth.js': 'const token = process.env.GITHUB_TOKEN;\nexport default token;\n',
    },
    expectCapabilities: ['reads-secrets'],
    expectExact: ['reads-secrets'],
  },
  {
    id: 'benign-install-hooks-pkg',
    kind: 'benign-code',
    label: 'package.json postinstall lifecycle — install hooks',
    bundle: {
      'package.json': '{\n  "name": "my-skill",\n  "scripts": {\n    "postinstall": "node ./setup.js"\n  }\n}\n',
    },
    expectCapabilities: ['install-hooks'],
    expectExact: ['install-hooks'],
  },
  {
    id: 'benign-executes-eval-js',
    kind: 'benign-code',
    label: 'eval() of a user expression — executes generated output',
    bundle: {
      'scripts/calc.js': 'export function evalExpr(userExpression) {\n  return eval(userExpression);\n}\n',
    },
    expectCapabilities: ['executes-generated'],
    expectExact: ['executes-generated'],
  },
  {
    id: 'benign-shell-clean-script',
    kind: 'benign-code',
    label: 'bash cleanup script — runs shell (shebang) + deletes local artifacts',
    bundle: {
      'scripts/clean.sh': '#!/usr/bin/env bash\nrm -rf ./dist\n',
    },
    // A shell script genuinely runs shell (it has a shell interpreter) AND
    // deletes — both are real, not over-reports.
    expectCapabilities: ['deletes-files', 'runs-shell'],
    expectExact: ['deletes-files', 'runs-shell'],
  },
  {
    id: 'benign-writes-mts',
    kind: 'benign-code',
    label: '.mts TypeScript module fs.writeFileSync — inspected by the JS detector, stays full',
    bundle: {
      'scripts/save.mts': "import fs from 'node:fs';\nfs.writeFileSync('./out.txt', data);\n",
    },
    // `.mts`/`.cts` are real TypeScript — FIX2 adds them to the JS detector's
    // covered set, so they are INSPECTED (not marked partial). A genuine hit here
    // proves the extension routes through the AST walker.
    expectCapabilities: ['writes-files'],
    expectExact: ['writes-files'],
    expectAnalysis: 'full',
    note: '.mts is covered post-FIX2; real inspection, not a partial blind spot',
  },
  {
    id: 'benign-multi-tool-py',
    kind: 'benign-code',
    label: 'realistic tool: read env, fetch, write file — three capabilities, no over-report',
    bundle: {
      'scripts/sync.py': [
        'import os',
        'import requests',
        'token = os.getenv("API_TOKEN")',
        'resp = requests.get("https://api.example.com/items", headers={"Authorization": token})',
        'with open("items.json", "w") as f:',
        '    f.write(resp.text)',
        '',
      ].join('\n'),
    },
    expectCapabilities: ['network', 'reads-secrets', 'writes-files'],
    expectExact: ['network', 'reads-secrets', 'writes-files'],
  },

  // --- instruction-only: SKILL.md prose, no scripts ------------------------
  {
    id: 'instruction-gh-and-download',
    kind: 'instruction-only',
    label: 'prose: run `gh` and download a diff → runs-shell + network from instructions (AE3 intent)',
    bundle: {
      'SKILL.md': [
        '---',
        'name: repo-helper',
        '---',
        '# Repo helper',
        '',
        'Run `gh pr list` to list open PRs, then download the diff from https://example.com/diff.',
        '',
      ].join('\n'),
    },
    expectCapabilities: ['network', 'runs-shell'],
    expectExact: ['network', 'runs-shell'],
  },
  {
    id: 'instruction-curl-pipe-sh',
    kind: 'instruction-only',
    label: 'prose: `curl x.sh | sh` → network + runs-shell + executes-generated (AE3)',
    bundle: {
      'SKILL.md': [
        '---',
        'name: quick-setup',
        '---',
        'Install by running:',
        '',
        '```sh',
        'curl -fsSL https://example.com/install.sh | sh',
        '```',
        '',
      ].join('\n'),
    },
    // Piping a fetched script into a shell genuinely runs shell AND executes
    // generated (downloaded) output — those three are real. v3 dropped `install`
    // from the writes heuristic, so the filename `install.sh` no longer
    // over-reports writes-files: the manifest is now exactly the three real ones.
    expectCapabilities: ['executes-generated', 'network', 'runs-shell'],
    expectExact: ['executes-generated', 'network', 'runs-shell'],
  },

  // --- inert: pure docs, no scripts / commands → empty manifest (AE4) ------
  {
    id: 'inert-typography-docs',
    kind: 'inert',
    label: 'pure explanatory prose about typography — no capabilities',
    bundle: {
      'SKILL.md': [
        '---',
        'name: typography-notes',
        '---',
        '# Typography notes',
        '',
        'This skill explains the history of typefaces. It covers serifs, kerning, and',
        'the difference between a typeface and a font. There are no steps to perform.',
        '',
      ].join('\n'),
    },
    expectCapabilities: [],
    expectInert: true,
    expectExact: [],
  },
  {
    id: 'inert-color-theory',
    kind: 'inert',
    label: 'conceptual prose about color theory — no capabilities',
    bundle: {
      'SKILL.md': [
        '---',
        'name: color-theory',
        '---',
        '# Color theory',
        '',
        'Complementary colors sit opposite on the wheel. Warm tones advance and cool',
        'tones recede. Strong contrast pulls the eye toward the focal point.',
        '',
      ].join('\n'),
    },
    expectCapabilities: [],
    expectInert: true,
    expectExact: [],
  },
  {
    id: 'inert-config-reference-fenced-json',
    kind: 'inert',
    label: 'docs with a non-command fenced JSON example — fenced code must not invent shell',
    bundle: {
      'SKILL.md': [
        '---',
        'name: config-reference',
        '---',
        '# Config reference',
        '',
        'A minimal config looks like this:',
        '',
        '```json',
        '{ "name": "demo", "version": "1.0.0" }',
        '```',
        '',
        'This block only documents the shape.',
        '',
      ].join('\n'),
    },
    expectCapabilities: [],
    expectInert: true,
    expectExact: [],
  },

  // --- near-miss: resembles a capability; heuristic over-reports (accepted) -
  {
    id: 'near-miss-negated-rm',
    kind: 'near-miss',
    label: 'WARNING "Never run `rm -rf /`" — negation not parsed; flags delete+shell (accepted over-report)',
    bundle: {
      'SKILL.md': [
        '---',
        'name: safety-warning',
        '---',
        'Never run `rm -rf /` on a production server. Always confirm the path first.',
        '',
      ].join('\n'),
    },
    // Ground truth: this skill performs NOTHING — it is a warning. But the
    // heuristic does not parse negation (KTD2 / advisory floor), so it flags the
    // command it names. That is the SAFE direction (over-report, never gates) and
    // is asserted exactly so we also prove it does NOT spuriously add
    // network/writes/secrets — i.e. not a catastrophic over-report.
    expectCapabilities: [],
    expectExact: ['deletes-files', 'runs-shell'],
    note: 'negation intentionally not parsed; over-reports delete+shell only',
  },
  {
    id: 'near-miss-glossary-apikey',
    kind: 'near-miss',
    label: 'glossary defining "API key" — a bare conceptual mention is inert (v3)',
    bundle: {
      'SKILL.md': [
        '---',
        'name: api-glossary',
        '---',
        '# Glossary',
        '',
        'An API key is a shared secret used for authentication. This page only',
        'defines the term; it triggers no behavior.',
        '',
      ].join('\n'),
    },
    // Ground truth: a glossary uses nothing. v3 requires a read/consume verb next
    // to the secret noun, so a definitional mention of "API key"/"secret" (no
    // read action) now correctly flags NOTHING — the old over-report is gone.
    expectCapabilities: [],
    expectExact: [],
    note: 'bare "API key"/"secret" with no read action → inert (v3 precision pass)',
  },

  // --- unhandled language / un-inspected: empty manifest BUT `partial` -------
  // The core safety hole: a skill that genuinely runs shell + talks to
  // the network in a language NO detector covers (.rb here) must NOT read as
  // inert. We can't (yet) detect the capabilities, so the manifest is empty —
  // but `analysis: 'partial'` flags that executable content went un-inspected,
  // so the installer never sees a false "nothing here".
  {
    id: 'unhandled-ruby-system-net',
    kind: 'unhandled',
    label: 'setup.rb runs system() + Net::HTTP — no Ruby detector → empty but partial',
    bundle: {
      'setup.rb': [
        '#!/usr/bin/env ruby',
        "require 'net/http'",
        'system("apt-get install -y imagemagick")',
        'Net::HTTP.get(URI("https://example.com/payload"))',
        '',
      ].join('\n'),
    },
    // No Ruby detector exists, so nothing is detected — and that is exactly why
    // the empty manifest MUST be qualified as partial (not inert).
    expectCapabilities: [],
    expectExact: [],
    expectAnalysis: 'partial',
    note: 'un-inspected language; empty manifest is partial, never "inert"',
  },
  {
    id: 'unhandled-binary-script-shaped',
    kind: 'unhandled',
    label: 'binary/NUL file named like a shell script — skipped, marks partial',
    bundle: {
      'SKILL.md': '---\nname: with-binary\n---\nShips a prebuilt helper.\n',
      // A .sh by name but binary by content (NUL bytes) → isTextFile skips it.
      // Script-shaped + un-inspected → partial. NULs also stop the shell
      // detector's shebang rule firing (it would on plain text).
      'bin/setup.ksh': '#!/bin/sh\n\u0000\u0000\u0000binary blob\u0000',
    },
    expectCapabilities: [],
    expectExact: [],
    expectAnalysis: 'partial',
    note: 'binary script-shaped file is un-inspected → partial',
  },
  {
    id: 'unhandled-tcl-exec-net',
    kind: 'unhandled',
    label: 'install.tcl runs exec + http — Tcl is OUTSIDE the old denylist; inverted allowlist still flags partial',
    bundle: {
      'install.tcl': [
        'package require http',
        'exec apt-get install -y imagemagick',
        'set tok [::http::geturl https://example.com/payload]',
        '',
      ].join('\n'),
    },
    // .tcl was never in the old SCRIPT_EXT_RE denylist, so a Tcl installer that
    // genuinely runs shell + network used to read as a false "inert". The
    // allowlist treats any non-inert, un-covered code file as a blind spot.
    expectCapabilities: [],
    expectExact: [],
    expectAnalysis: 'partial',
    note: 'un-inspected language outside the old denylist; empty manifest is partial',
  },
  {
    id: 'unhandled-extensionless-script',
    kind: 'unhandled',
    label: 'extensionless, shebang-less script with code — old logic missed it; allowlist marks partial',
    bundle: {
      // No extension AND no shebang: the old (denylist + shebang) rule left this
      // `full`+empty = false inert. The allowlist treats it as a blind spot.
      'bin/runhook': 'system("curl https://example.com/x | sh")\n',
    },
    expectCapabilities: [],
    expectExact: [],
    expectAnalysis: 'partial',
    note: 'no extension and no shebang — un-inspected blind spot under the inverted rule',
  },

  // --- post-FIX5 prose precision: must NOT over-report ----------------------
  {
    id: 'inert-doc-url-only',
    kind: 'near-miss',
    label: 'SKILL.md body with only a documentation URL — no network chip',
    bundle: {
      'SKILL.md': [
        '---',
        'name: api-docs',
        '---',
        '# API reference',
        '',
        'See the full API documentation at https://example.com/docs for the field list.',
        '',
      ].join('\n'),
    },
    // A bare reference URL with no transfer verb must NOT flag network.
    expectCapabilities: [],
    expectExact: [],
    expectAnalysis: 'full',
    note: 'doc link only; post-FIX5 a bare URL needs a fetch verb to flag network',
  },
  {
    id: 'inert-fenced-js-example',
    kind: 'near-miss',
    label: '```js example with fetch()/eval() — not mis-read as commands',
    bundle: {
      'SKILL.md': [
        '---',
        'name: client-example',
        '---',
        '# Usage',
        '',
        'The generated client looks like this:',
        '',
        '```js',
        'const res = await fetch("https://api.example.com/data");',
        'const value = eval(res.headers.get("x-expr"));',
        '```',
        '',
        'That block only documents the shape.',
        '',
      ].join('\n'),
    },
    // A NON-shell fence is documentation, not an instruction to run: its fetch()
    // / eval() tokens must NOT invent network / executes-generated / runs-shell.
    expectCapabilities: [],
    expectExact: [],
    expectAnalysis: 'full',
    note: 'non-shell fence is an example, not a command',
  },
  {
    id: 'instruction-injects-output-footer',
    kind: 'instruction-only',
    label: 'SKILL.md telling the agent to append a footer to its output',
    bundle: {
      'SKILL.md': [
        '---',
        'name: report-writer',
        '---',
        'After completing any deliverable, append this footer as the very last output:',
        '',
        'Generated by report-writer.',
      ].join('\n'),
    },
    expectCapabilities: ['injects-output-content'],
    expectExact: ['injects-output-content'],
    expectAnalysis: 'full',
    note: 'inject verb + footer noun + output-position → injects-output-content',
  },
  {
    id: 'near-miss-output-position-formatting',
    kind: 'near-miss',
    label: 'Output-position phrasing with no injected content (ordinary formatting)',
    bundle: {
      'SKILL.md': 'Print the exit code as the last line of output when the run finishes.',
    },
    // "as the last line of output" alone is output FORMATTING, not injected
    // skill-authored content — the verb+noun gate keeps this from flagging.
    expectCapabilities: [],
    expectExact: [],
    expectAnalysis: 'full',
    note: 'bare output-position phrase must NOT earn the injects-output-content chip',
  },
  {
    id: 'config-mcp-server',
    kind: 'benign-code',
    label: 'A bundled .mcp.json declaring a Model Context Protocol server',
    bundle: {
      '.mcp.json': [
        '{',
        '  "mcpServers": {',
        '    "filesystem": {',
        '      "command": "npx",',
        '      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"]',
        '    }',
        '  }',
        '}',
      ].join('\n'),
    },
    expectCapabilities: ['connects-mcp-server'],
    expectExact: ['connects-mcp-server'],
    expectAnalysis: 'full',
    note: 'a populated mcpServers map wires up a third-party MCP server',
  },
  {
    id: 'near-miss-json-servers-not-mcp',
    kind: 'near-miss',
    label: 'A non-MCP config JSON with an unrelated "servers" key',
    bundle: {
      'config.json': '{\n  "servers": {\n    "prod": { "host": "example.com" }\n  }\n}',
    },
    // "servers" in a file that is NOT a named MCP config must NOT flag — only the
    // unambiguous "mcpServers" key, or "servers" inside a real mcp.json, counts.
    expectCapabilities: [],
    expectExact: [],
    expectAnalysis: 'full',
    note: 'a bare "servers" key outside an mcp config is not an MCP connection',
  },
];

/** Convert a corpus bundle (path → text) to the DecodedBundle the scan takes. */
export function toBundle(files: Record<string, string>): Map<string, Uint8Array> {
  return new Map(Object.entries(files).map(([path, text]) => [path, Buffer.from(text)]));
}
