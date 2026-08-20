// Code capability detectors — full-inventory detection of what a bundled
// SCRIPT can DO, benign AND risky alike.
//
// These mirror the THREAT detectors' patterns but drop the risk gating: the
// threat pipeline only emits the dangerous subset (curl|sh, rm -rf /, exec of
// model output), whereas the installer's question is "what can this skill do at
// all?". So `subprocess.run(["ls"])` and `shred /dev/sda` are BOTH reported —
// the risky/benign distinction is the collector's threat-finding JOIN, not ours.
//
// Reuse over re-implementation:
//  - runs-shell / executes-generated go through the hardened AST call walkers
//    (`findJavaScriptRiskyCalls` / `findPythonRiskyCalls`) so binding resolution
//    excludes `RegExp.exec`, sqlite `.exec`, and locally-shadowed `exec()`.
//  - the remaining capabilities (network / writes / deletes / secrets / hooks)
//    are line-accurate regex shapes mirroring `exfil.ts` / `destructive.ts` /
//    `secrets.ts`, broadened from the risky-only subset to full usage.
//
// Pure: no IO, no state. Markdown/prose is U3's surface — every detector here
// gates on a concrete script/manifest extension and returns [] for `.md`.

import { lineNumber } from '../util.js';
import { extOf } from '../../file-classes.js';
import { findJavaScriptRiskyCalls } from '../ast/javascript-calls.js';
import { findPythonRiskyCalls } from '../ast/python-calls.js';
import type { Capability, CapabilityDetector } from '../../capabilities/types.js';

type Hit = { capability: Capability; lineStart: number; lineEnd: number };

// `.mts`/`.cts` are real TypeScript module variants — they MUST be inspected by
// the AST walker, not silently treated as an unknown extension.
//
// Language dispatch goes through `extOf`, NOT a raw filename regex, so a
// template wrapper is transparent: `StateServer.swift.template` and
// `build.sh.tmpl` are inspected as the Swift/shell they generate. The
// blind-spot layer already classified those as covered (`isCoveredByDetector`
// is extOf-based), so a raw-suffix match here meant a file could count as
// covered while no detector ever looked at it.
const JS_EXTS = new Set(['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts', '.tsx', '.jsx']);
const PY_EXTS = new Set(['.py']);
const SHELL_EXTS = new Set(['.sh', '.bash', '.zsh', '.ksh']);
// Swift ships in real skills as tooling and as `.swift.template` scaffolding
// (see any iOS skill).
const SWIFT_EXTS = new Set(['.swift']);

const isJs = (file: string): boolean => JS_EXTS.has(extOf(file));
const isPy = (file: string): boolean => PY_EXTS.has(extOf(file));
const isShell = (file: string): boolean => SHELL_EXTS.has(extOf(file));
const isSwift = (file: string): boolean => SWIFT_EXTS.has(extOf(file));
const PACKAGE_JSON_RE = /(?:^|\/)package\.json$/i;

function toHit(capability: Capability, contents: string, offset: number, length: number): Hit {
  return {
    capability,
    lineStart: lineNumber(contents, offset),
    lineEnd: lineNumber(contents, offset + length),
  };
}

/** Run one global regex over `contents`, one Hit per match (line-accurate). */
function regexHits(capability: Capability, contents: string, pattern: RegExp): Hit[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const re = new RegExp(pattern.source, flags);
  const out: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(contents)) !== null) {
    out.push(toHit(capability, contents, m.index, m[0].length));
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function applyAll(capability: Capability, contents: string, patterns: RegExp[]): Hit[] {
  const out: Hit[] = [];
  for (const p of patterns) out.push(...regexHits(capability, contents, p));
  return out;
}

// --- runs-shell + executes-generated via the AST call walkers ---------------
// We reuse the THREAT walkers verbatim and re-map their detector ids to
// capability keys. Binding resolution lives inside the walkers, so member calls
// like `RegExp.exec` / `db.exec(` (not bound to child_process) never surface.

function jsCapabilityFor(detector: string): Capability | null {
  if (detector.startsWith('js-child-process') || detector === 'js-os-system') return 'runs-shell';
  if (detector === 'js-eval' || detector === 'js-new-function') return 'executes-generated';
  return null;
}

function pyCapabilityFor(detector: string): Capability | null {
  if (
    detector.startsWith('python-subprocess') ||
    detector === 'python-os-system' ||
    detector === 'python-os-popen'
  ) {
    return 'runs-shell';
  }
  if (detector === 'python-eval' || detector === 'python-exec') return 'executes-generated';
  return null;
}

// `compile(src)` is the third Python codegen builtin; the AST walker only covers
// eval/exec. The leading non-word/dot guard keeps `re.compile(...)` (and other
// `.compile` methods) out — only the bare builtin counts.
const PY_COMPILE_RE = /(?<![\w.])compile\s*\(/g;

const astCallDetector: CapabilityDetector = (file, contents) => {
  const out: Hit[] = [];
  if (isJs(file)) {
    for (const site of findJavaScriptRiskyCalls(contents, file)) {
      const cap = jsCapabilityFor(site.detector);
      if (cap) out.push(toHit(cap, contents, site.offset, site.length));
    }
  } else if (isPy(file)) {
    for (const site of findPythonRiskyCalls(contents)) {
      const cap = pyCapabilityFor(site.detector);
      if (cap) out.push(toHit(cap, contents, site.offset, site.length));
    }
    out.push(...regexHits('executes-generated', contents, PY_COMPILE_RE));
  }
  return out;
};

// --- runs-shell in shell scripts --------------------------------------------
// A shell script's reason for existing is to run commands. We flag the shebang
// (so any real shell script reads as runs-shell) plus explicit re-invocation
// shapes (command substitution, eval, exec, `sh -c`, pipe-to-shell, xargs).
// Heuristic: a shebang-less script that only calls bare commands (`ls`, `cp`)
// is not flagged here — those are covered by the more specific capability
// detectors when they touch network/files/secrets.
const SHELL_RUNS = [
  /^#!.*\b(?:sh|bash|zsh|ksh|dash)\b/m,
  /\$\(/g,
  /`[^`\n]+`/g,
  /\beval\b/g,
  /\bexec\s/g,
  /\b(?:sh|bash|zsh|ksh|dash)\s+-c\b/g,
  /\|\s*(?:\/bin\/)?(?:sh|bash|zsh|ksh)\b/g,
  /\bxargs\b/g,
];

const shellRunsShellDetector: CapabilityDetector = (file, contents) =>
  isShell(file) ? applyAll('runs-shell', contents, SHELL_RUNS) : [];

// Swift subprocess shapes. `Process`/`NSTask` ARE the shell surface; the URL/path
// properties catch a Process built across several lines. `system(` needs the
// non-word guard so a `foo.system(` method call on some type stays out.
const SWIFT_RUNS = [
  /\bProcess\s*\(/g,
  /\bNSTask\b/g,
  /\.(?:launchPath|executableURL)\s*=/g,
  /\bposix_spawn\b/g,
  /(?<![\w.])system\s*\(/g,
];

const swiftRunsShellDetector: CapabilityDetector = (file, contents) =>
  isSwift(file) ? applyAll('runs-shell', contents, SWIFT_RUNS) : [];

// --- network ----------------------------------------------------------------
const JS_NETWORK = [
  // Bare global `fetch(` only. `worker.fetch(` / `env.ASSETS.fetch(` /
  // `stub.fetch(` are binding/RPC method calls (a test harness, a service or
  // Durable Object binding, static-asset serving), not necessarily the internet.
  /(?<![.\w])fetch\s*\(/g,
  /\baxios\s*(?:\.\w+)?\s*\(/g,
  /\bhttps?\.(?:get|request)\s*\(/g,
  /\bgot\s*(?:\.\w+)?\s*\(/g,
  /\bnew\s+XMLHttpRequest\b/g,
];
const PY_NETWORK = [
  /\brequests\.(?:get|post|put|delete|patch|head|options|request)\s*\(/g,
  /\bhttpx\.(?:get|post|put|delete|patch|head|options|request|stream|Client|AsyncClient)\b/g,
  /\burllib\b/g,
  /\burlopen\s*\(/g,
  /\baiohttp\b/g,
  /\bhttp\.client\b/g,
];
const SHELL_NETWORK = [/\bcurl\b/g, /\bwget\b/g];
// Deliberately NOT `URL(string:)` — a bare URL value reaches nothing on its own,
// and skills build file URLs constantly. The transport types are the capability.
const SWIFT_NETWORK = [
  /\b(?:URLSession|NSURLSession|URLRequest|NSURLConnection|NWConnection)\b/g,
  /\.(?:dataTask|downloadTask|uploadTask|bytes)\s*\(/g,
];

const networkDetector: CapabilityDetector = (file, contents) => {
  if (isJs(file)) return applyAll('network', contents, JS_NETWORK);
  if (isPy(file)) return applyAll('network', contents, PY_NETWORK);
  if (isShell(file)) return applyAll('network', contents, SHELL_NETWORK);
  if (isSwift(file)) return applyAll('network', contents, SWIFT_NETWORK);
  return [];
};

// --- writes-files -----------------------------------------------------------
const JS_WRITES = [
  /\bfs(?:\.promises)?\.(?:writeFile|writeFileSync|createWriteStream|appendFile|appendFileSync)\b/g,
];
const PY_WRITES = [
  // open(path, "w"/"a"/"x" ...) — second arg mode containing a write flag.
  // ALL THREE runs are BOUNDED on purpose. The original
  // `\bopen\s*\([^)]*,\s*['"][^'"]*[wax][^'"]*['"]` had two adjacent unbounded
  // `[^'"]*` runs flanking `[wax]` (catastrophic O(n^2) backtracking on a long
  // unterminated quoted string) AND an unbounded `[^)]*` prefix that, with a
  // repeated `open(` token and no `)`, is itself quadratic. A crafted ~200k-char
  // file pinned the synchronous regex and stalled the single-threaded event loop
  // on the publish/scan path. The 1 MiB per-file cap only bounds LINEAR
  // detectors, so it did NOT save us. 256/64 comfortably exceed any real
  // first-arg path length / mode-string length, keeping this strictly linear.
  /\bopen\s*\([^)]{0,256},\s*['"][^'"]{0,64}[wax][^'"]{0,64}['"]/g,
  /\.write_(?:text|bytes)\s*\(/g,
];
const SHELL_WRITES = [
  // `>` / `>>` redirection to a target (not `>&`, not `2>&1`), plus `tee`.
  /(?<![&>0-9])>>?(?![&>])\s*[^\s&>|;]/g,
  /\btee\b/g,
];

// `write(to:)` covers String/Data/Array; `createFile` and the writing handles
// cover FileManager and the stream APIs. Bounded runs only, so this stays linear.
const SWIFT_WRITES = [
  /\.write\s*\(\s*to\s*:/g,
  /\.createFile\s*\(/g,
  /\bFileHandle\s*\(\s*forWriting/g,
  /\bOutputStream\s*\(/g,
];

const writesFilesDetector: CapabilityDetector = (file, contents) => {
  if (isJs(file)) return applyAll('writes-files', contents, JS_WRITES);
  if (isPy(file)) return applyAll('writes-files', contents, PY_WRITES);
  if (isShell(file)) return applyAll('writes-files', contents, SHELL_WRITES);
  if (isSwift(file)) return applyAll('writes-files', contents, SWIFT_WRITES);
  return [];
};

// --- deletes-files ----------------------------------------------------------
const JS_DELETES = [
  /\bfs(?:\.promises)?\.(?:unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync)\b/g,
];
const PY_DELETES = [
  /\bos\.(?:remove|unlink|rmdir|removedirs)\b/g,
  /\bshutil\.rmtree\b/g,
  /\.unlink\s*\(/g, // pathlib Path(...).unlink()
];
// `shred` overwrites then removes — it is a destructive delete, so it counts.
const SHELL_DELETES = [/\b(?:rm|rmdir|unlink|shred)\b/g];

const SWIFT_DELETES = [/\.(?:removeItem|trashItem)\s*\(/g, /(?<![\w.])unlink\s*\(/g];

const deletesFilesDetector: CapabilityDetector = (file, contents) => {
  if (isJs(file)) return applyAll('deletes-files', contents, JS_DELETES);
  if (isPy(file)) return applyAll('deletes-files', contents, PY_DELETES);
  if (isShell(file)) return applyAll('deletes-files', contents, SHELL_DELETES);
  if (isSwift(file)) return applyAll('deletes-files', contents, SWIFT_DELETES);
  return [];
};

// --- reads-secrets ----------------------------------------------------------
// Full environment-access inventory (not just secret-shaped keys like exfil.ts).
const JS_SECRETS = [/\bprocess\.env\b/g];
const PY_SECRETS = [/\bos\.environ\b/g, /\bos\.getenv\s*\(/g];
const SHELL_SECRETS = [
  /\bprintenv\b/g,
  // Reading a .env file — sourced (`source .env`, `. ./.env`), cat'd, or
  // redirected in (`< .env`), or the dotenv loader. A BARE mention is NOT a read:
  // `--exclude='.env'` / `--exclude='.env.*'` (rsync/tar exclude — the OPPOSITE,
  // it keeps secrets out of the bundle), a path, or a comment must stay inert.
  // Path runs are bounded ({0,256}) so a crafted line can't pin the regex.
  /\b(?:source|cat)\s+[^\s|;&]{0,256}\.env(?:\.\w+)?\b/g,
  /(?:^|[\s;&|(])\.\s+[^\s|;&]{0,256}\.env(?:\.\w+)?\b/gm,
  /<\s*[^\s|;&]{0,256}\.env(?:\.\w+)?\b/g,
  /\bdotenv\b/gi,
  // secret-shaped env expansions ($API_TOKEN, ${DB_PASSWORD}). Bare `$VAR` is
  // too noisy in shell, so this is intentionally narrowed to credential names.
  // The two letter runs are BOUNDED ({0,64}) on purpose: adjacent unbounded
  // `[A-Za-z_]*` runs around the keyword cause O(n^2) catastrophic backtracking,
  // so a ~25MB crafted file of letters would hang the scan. 64 chars
  // comfortably exceeds any real env-var name prefix/suffix.
  /\$\{?[A-Za-z_]{0,64}(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z_]{0,64}\}?/g,
];

// Environment plus the Keychain read API, which is the Apple-platform way to
// reach a stored credential.
const SWIFT_SECRETS = [
  /\bProcessInfo\.processInfo\.environment\b/g,
  /(?<![\w.])getenv\s*\(/g,
  /\bSecItemCopyMatching\s*\(/g,
];

const readsSecretsDetector: CapabilityDetector = (file, contents) => {
  if (isJs(file)) return applyAll('reads-secrets', contents, JS_SECRETS);
  if (isPy(file)) return applyAll('reads-secrets', contents, PY_SECRETS);
  if (isShell(file)) return applyAll('reads-secrets', contents, SHELL_SECRETS);
  if (isSwift(file)) return applyAll('reads-secrets', contents, SWIFT_SECRETS);
  return [];
};

// --- install-hooks ----------------------------------------------------------
// package.json lifecycle scripts run automatically at install time. We match
// the lifecycle key; these names rarely appear as anything else in a manifest.
const LIFECYCLE_RE =
  /"(?:preinstall|install|postinstall|preuninstall|uninstall|postuninstall|prepublish|prepublishOnly|prepare|prepack|postpack)"\s*:/g;

const installHooksDetector: CapabilityDetector = (file, contents) =>
  PACKAGE_JSON_RE.test(file) ? regexHits('install-hooks', contents, LIFECYCLE_RE) : [];

/**
 * Code capability detectors, one entry per concern. The AST detector covers
 * runs-shell + executes-generated for JS/Python (binding-resolved); the rest
 * are language-dispatched regex shapes. Inject into `runCapabilityScan`.
 */
export const CODE_CAPABILITY_DETECTORS: CapabilityDetector[] = [
  astCallDetector,
  shellRunsShellDetector,
  swiftRunsShellDetector,
  networkDetector,
  writesFilesDetector,
  deletesFilesDetector,
  readsSecretsDetector,
  installHooksDetector,
];
