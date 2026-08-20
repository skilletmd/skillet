// Lightweight Python call-site extractor (hardened). We do not
// execute code and we do not ship a full CPython parser — instead we walk the
// source with a quote / comment state machine and only record real call
// parentheses outside literals (with f-string expression support).

import type { Severity } from '../../types.js';
import { lineNumber, snippetAround } from '../util.js';
import { isAllowlistedBinary } from './tool-allowlist.js';

export interface PythonCallSite {
  callee: string;
  offset: number;
  length: number;
  confidence: Severity;
  detector: string;
}

const RISKY_CALLEES = new Map<string, { confidence: Severity; detector: string }>([
  ['eval', { confidence: 'high', detector: 'python-eval' }],
  ['exec', { confidence: 'high', detector: 'python-exec' }],
  ['os.system', { confidence: 'high', detector: 'python-os-system' }],
  ['os.popen', { confidence: 'high', detector: 'python-os-popen' }],
  ['subprocess.run', { confidence: 'medium', detector: 'python-subprocess-run' }],
  ['subprocess.call', { confidence: 'medium', detector: 'python-subprocess-call' }],
  ['subprocess.Popen', { confidence: 'medium', detector: 'python-subprocess-popen' }],
  ['subprocess.check_output', { confidence: 'medium', detector: 'python-subprocess-check-output' }],
  ['subprocess.check_call', { confidence: 'medium', detector: 'python-subprocess-check-call' }],
]);

const OS_METHODS = new Set(['system', 'popen']);
const SUBPROCESS_METHODS = new Set([
  'run',
  'call',
  'Popen',
  'check_output',
  'check_call',
]);

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function riskySpec(callee: string): { confidence: Severity; detector: string } | undefined {
  return RISKY_CALLEES.get(callee);
}

function readCallee(source: string, start: number): { callee: string; end: number } | null {
  let i = start;
  let callee = '';
  while (i < source.length && isIdentChar(source[i]!)) {
    callee += source[i];
    i++;
  }
  while (i < source.length && source[i] === '.') {
    callee += '.';
    i++;
    const segStart = i;
    while (i < source.length && isIdentChar(source[i]!)) {
      callee += source[i];
      i++;
    }
    if (i === segStart) return null;
  }
  while (i < source.length && /\s/.test(source[i]!)) i++;
  if (source[i] !== '(') return null;
  return { callee, end: i + 1 };
}

// Quote-aware: track string state while scanning the argument list so
// a `)` inside a string argument cannot mis-bound the paren scan, and a literal
// `shell=True` appearing inside a string cannot mis-grade the call. Only
// code-state characters count toward paren depth and toward the kwarg match.
function hasShellTrueArg(source: string, openParenIdx: number): boolean {
  if (source[openParenIdx] !== '(') return false;
  let depth = 1;
  let i = openParenIdx + 1;
  const start = i;
  let argState: 'code' | 'sq' | 'dq' | 'tsq' | 'tdq' = 'code';

  while (i < source.length && depth > 0) {
    const ch = source[i]!;
    const next = source[i + 1];
    const next2 = source[i + 2];

    if (argState === 'code') {
      if (ch === "'" && next === "'" && next2 === "'") {
        argState = 'tsq';
        i += 3;
        continue;
      }
      if (ch === '"' && next === '"' && next2 === '"') {
        argState = 'tdq';
        i += 3;
        continue;
      }
      if (ch === "'") {
        argState = 'sq';
        i++;
        continue;
      }
      if (ch === '"') {
        argState = 'dq';
        i++;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
      continue;
    }

    if (argState === 'sq') {
      if (ch === '\\' && i + 1 < source.length) i += 2;
      else {
        if (ch === "'") argState = 'code';
        i++;
      }
      continue;
    }

    if (argState === 'dq') {
      if (ch === '\\' && i + 1 < source.length) i += 2;
      else {
        if (ch === '"') argState = 'code';
        i++;
      }
      continue;
    }

    if (argState === 'tsq') {
      if (ch === "'" && next === "'" && next2 === "'") {
        argState = 'code';
        i += 3;
      } else {
        i++;
      }
      continue;
    }

    // argState === 'tdq'
    if (ch === '"' && next === '"' && next2 === '"') {
      argState = 'code';
      i += 3;
    } else {
      i++;
    }
  }

  // Build a code-only projection of the argument list (string bodies blanked) so
  // the kwarg regex never matches a `shell=True` that lives inside a literal.
  const codeArgs = stripStringBodies(source.slice(start, i - 1));
  return /\bshell\s*=\s*True\b/.test(codeArgs);
}

/** Replace string-literal bodies with spaces, preserving length and structure. */
function stripStringBodies(snippet: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'sq' | 'dq' | 'tsq' | 'tdq' = 'code';
  while (i < snippet.length) {
    const ch = snippet[i]!;
    const next = snippet[i + 1];
    const next2 = snippet[i + 2];
    if (state === 'code') {
      if (ch === "'" && next === "'" && next2 === "'") {
        out += '   ';
        state = 'tsq';
        i += 3;
        continue;
      }
      if (ch === '"' && next === '"' && next2 === '"') {
        out += '   ';
        state = 'tdq';
        i += 3;
        continue;
      }
      if (ch === "'") {
        out += ' ';
        state = 'sq';
        i++;
        continue;
      }
      if (ch === '"') {
        out += ' ';
        state = 'dq';
        i++;
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    if (state === 'sq') {
      if (ch === '\\' && i + 1 < snippet.length) {
        out += '  ';
        i += 2;
        continue;
      }
      out += ' ';
      if (ch === "'") state = 'code';
      i++;
      continue;
    }
    if (state === 'dq') {
      if (ch === '\\' && i + 1 < snippet.length) {
        out += '  ';
        i += 2;
        continue;
      }
      out += ' ';
      if (ch === '"') state = 'code';
      i++;
      continue;
    }
    if (state === 'tsq') {
      if (ch === "'" && next === "'" && next2 === "'") {
        out += '   ';
        state = 'code';
        i += 3;
        continue;
      }
      out += ' ';
      i++;
      continue;
    }
    // state === 'tdq'
    if (ch === '"' && next === '"' && next2 === '"') {
      out += '   ';
      state = 'code';
      i += 3;
      continue;
    }
    out += ' ';
    i++;
  }
  return out;
}

function readAttributeRef(source: string, start: number): { ref: string; end: number } | null {
  let i = start;
  let ref = '';
  while (i < source.length && isIdentChar(source[i]!)) {
    ref += source[i];
    i++;
  }
  while (i < source.length && source[i] === '.') {
    ref += '.';
    i++;
    const segStart = i;
    while (i < source.length && isIdentChar(source[i]!)) {
      ref += source[i];
      i++;
    }
    if (i === segStart) return null;
  }
  if (!ref) return null;
  return { ref, end: i };
}

function resolveCallee(
  callee: string,
  bindings: Map<string, string>,
): { canonical: string; spec: { confidence: Severity; detector: string } } | null {
  const direct = riskySpec(callee);
  if (direct) return { canonical: callee, spec: direct };
  const bound = bindings.get(callee);
  if (!bound) return null;
  const spec = riskySpec(bound);
  if (!spec) return null;
  return { canonical: bound, spec };
}

function pushCall(
  out: PythonCallSite[],
  contents: string,
  offset: number,
  length: number,
  canonical: string,
  spec: { confidence: Severity; detector: string },
): void {
  let confidence = spec.confidence;
  let detector = spec.detector;
  const openParen = offset + length - 1;
  const isSubprocess = canonical.startsWith('subprocess.');
  const shell = isSubprocess && hasShellTrueArg(contents, openParen);
  if (shell) {
    confidence = 'high';
    detector = `${spec.detector}-shell`;
  }
  // Suppress a static-binary subprocess call: `subprocess.run(['uv', 'venv'])`
  // runs a known tool with fixed args — a capability, not a threat. Only when
  // NOT shell=True; a dynamic/interpolated command returns null and keeps its
  // grade. The capability collector still records the subprocess capability.
  if (isSubprocess && !shell) {
    const binary = pythonFirstLiteralBinary(contents, openParen);
    if (binary && isAllowlistedBinary(binary)) return;
  }
  out.push({
    callee: canonical,
    offset,
    length,
    confidence,
    detector,
  });
}

/**
 * The first command binary of a Python subprocess call when it is a STATIC
 * string literal — `subprocess.run(['uv', …])` → `uv`, `subprocess.run('git x')`
 * → `git`. Returns null for a dynamic/first-non-literal arg (`subprocess.run(cmd)`,
 * `subprocess.run([str(py), …])`, f-strings), which keeps the finding.
 */
function pythonFirstLiteralBinary(source: string, openParenIdx: number): string | null {
  let i = openParenIdx + 1;
  while (i < source.length && /\s/.test(source[i]!)) i++;
  // List form: step into `[` and skip to the first element.
  if (source[i] === '[') {
    i++;
    while (i < source.length && /\s/.test(source[i]!)) i++;
  }
  const quote = source[i];
  if (quote !== '"' && quote !== "'") return null; // dynamic / non-literal first arg
  i++;
  let value = '';
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    value += source[i];
    i++;
  }
  return value || null;
}

/**
 * Collect `from X import Y` bindings and simple `alias = os.system` assignments.
 */
function collectPythonBindings(contents: string): Map<string, string> {
  const bindings = new Map<string, string>();
  let i = 0;
  let state: 'code' | 'sq' | 'dq' | 'tsq' | 'tdq' | 'comment' = 'code';

  while (i < contents.length) {
    const ch = contents[i]!;
    const next = contents[i + 1];
    const next2 = contents[i + 2];

    if (state === 'comment') {
      if (ch === '\n') state = 'code';
      i++;
      continue;
    }

    if (state !== 'code') {
      // Skip string bodies during binding collection.
      if (state === 'sq') {
        if (ch === '\\' && i + 1 < contents.length) {
          i += 2;
          continue;
        }
        if (ch === "'") state = 'code';
        i++;
        continue;
      }
      if (state === 'dq') {
        if (ch === '\\' && i + 1 < contents.length) {
          i += 2;
          continue;
        }
        if (ch === '"') state = 'code';
        i++;
        continue;
      }
      if (state === 'tsq') {
        if (ch === "'" && next === "'" && next2 === "'") {
          state = 'code';
          i += 3;
          continue;
        }
        i++;
        continue;
      }
      if (state === 'tdq') {
        if (ch === '"' && next === '"' && next2 === '"') {
          state = 'code';
          i += 3;
          continue;
        }
        i++;
        continue;
      }
    }

    if (state === 'code') {
      if (ch === '#') {
        state = 'comment';
        i++;
        continue;
      }
      if (ch === "'" && next === "'" && next2 === "'") {
        state = 'tsq';
        i += 3;
        continue;
      }
      if (ch === '"' && next === '"' && next2 === '"') {
        state = 'tdq';
        i += 3;
        continue;
      }
      if (ch === "'") {
        state = 'sq';
        i++;
        continue;
      }
      if (ch === '"') {
        state = 'dq';
        i++;
        continue;
      }

      if (contents.startsWith('from ', i)) {
        const lineEnd = contents.indexOf('\n', i);
        const line = contents.slice(i, lineEnd === -1 ? contents.length : lineEnd);
        const m = line.match(/^from\s+(os|subprocess)\s+import\s+(.+)$/);
        if (m) {
          const mod = m[1]!;
          const imports = m[2]!.split(',');
          for (const part of imports) {
            const trimmed = part.trim();
            if (!trimmed || trimmed === '(') continue;
            const asSplit = trimmed.split(/\s+as\s+/);
            const name = (asSplit[0] ?? '').trim();
            const local = (asSplit[1] ?? name).trim();
            if (!name || !local) continue;
            if (mod === 'os' && OS_METHODS.has(name)) {
              bindings.set(local, `os.${name}`);
            } else if (mod === 'subprocess' && SUBPROCESS_METHODS.has(name)) {
              bindings.set(local, `subprocess.${name}`);
            }
          }
        }
        i = lineEnd === -1 ? contents.length : lineEnd + 1;
        continue;
      }

      if (isIdentChar(ch) && (i === 0 || !isIdentChar(contents[i - 1]!))) {
        const eq = contents.indexOf('=', i);
        if (eq !== -1 && eq - i < 40) {
          const lhs = contents.slice(i, eq).trim();
          const rhsStart = eq + 1;
          let j = rhsStart;
          while (j < contents.length && /\s/.test(contents[j]!)) j++;
          const rhsRead = readAttributeRef(contents, j);
          if (/^[A-Za-z_]\w*$/.test(lhs) && rhsRead && riskySpec(rhsRead.ref)) {
            bindings.set(lhs, rhsRead.ref);
            i = rhsRead.end;
            continue;
          }
        }
      }

      i++;
      continue;
    }
  }

  return bindings;
}

function findGetattrRiskyCalls(contents: string): PythonCallSite[] {
  const out: PythonCallSite[] = [];
  const re = /getattr\s*\(\s*(os|subprocess)\s*,\s*(['"])([\w.]+)\2\s*\)\s*\(/g;
  for (const match of contents.matchAll(re)) {
    const mod = match[1]!;
    const method = match[3]!;
    const canonical = `${mod}.${method}`;
    const spec = riskySpec(canonical);
    if (!spec) continue;
    const offset = match.index ?? 0;
    const length = match[0].length;
    pushCall(out, contents, offset, length, canonical, spec);
  }
  return out;
}

function findDunderImportRiskyCalls(contents: string): PythonCallSite[] {
  const out: PythonCallSite[] = [];
  const re =
    /__import__\(\s*(['"])(os|subprocess)\1\s*\)\.(system|popen|run|call|Popen|check_output|check_call)\s*\(/g;
  for (const match of contents.matchAll(re)) {
    const mod = match[2]!;
    const method = match[3]!;
    const canonical = `${mod}.${method}`;
    const spec = riskySpec(canonical);
    if (!spec) continue;
    const offset = match.index ?? 0;
    const length = match[0].length;
    pushCall(out, contents, offset, length, canonical, spec);
  }
  return out;
}

type WalkState = 'code' | 'sq' | 'dq' | 'tsq' | 'tdq' | 'comment' | 'fsq' | 'fdq';

function walkPythonCalls(
  contents: string,
  bindings: Map<string, string>,
  out: PythonCallSite[],
  start = 0,
  end = contents.length,
): void {
  let i = start;
  let state: WalkState = 'code';

  while (i < end) {
    const ch = contents[i]!;
    const next = contents[i + 1];
    const next2 = contents[i + 2];

    if (state === 'comment') {
      if (ch === '\n') state = 'code';
      i++;
      continue;
    }

    if (state === 'code') {
      if (ch === '#') {
        state = 'comment';
        i++;
        continue;
      }
      if ((ch === 'f' || ch === 'F') && next === "'" && next2 !== "'") {
        state = 'fsq';
        i += 2;
        continue;
      }
      if ((ch === 'f' || ch === 'F') && next === '"' && next2 !== '"') {
        state = 'fdq';
        i += 2;
        continue;
      }
      if (ch === "'" && next === "'" && next2 === "'") {
        state = 'tsq';
        i += 3;
        continue;
      }
      if (ch === '"' && next === '"' && next2 === '"') {
        state = 'tdq';
        i += 3;
        continue;
      }
      if (ch === "'") {
        state = 'sq';
        i++;
        continue;
      }
      if (ch === '"') {
        state = 'dq';
        i++;
        continue;
      }

      if (isIdentChar(ch) && (i === start || !isIdentChar(contents[i - 1]!))) {
        const read = readCallee(contents, i);
        if (read) {
          const resolved = resolveCallee(read.callee, bindings);
          if (resolved) {
            const offset = i;
            const length = read.end - i;
            pushCall(out, contents, offset, length, resolved.canonical, resolved.spec);
            i = read.end;
            continue;
          }
        }
      }
      i++;
      continue;
    }

    if (state === 'sq' || state === 'fsq') {
      if (ch === '\\' && i + 1 < end) {
        i += 2;
        continue;
      }
      if (state === 'fsq' && ch === '{') {
        const close = findFStringExprEnd(contents, i + 1, end);
        if (close !== null) {
          walkPythonCalls(contents, bindings, out, i + 1, close);
          i = close + 1;
          continue;
        }
      }
      if (ch === "'") state = 'code';
      i++;
      continue;
    }

    if (state === 'dq' || state === 'fdq') {
      if (ch === '\\' && i + 1 < end) {
        i += 2;
        continue;
      }
      if (state === 'fdq' && ch === '{') {
        const close = findFStringExprEnd(contents, i + 1, end);
        if (close !== null) {
          walkPythonCalls(contents, bindings, out, i + 1, close);
          i = close + 1;
          continue;
        }
      }
      if (ch === '"') state = 'code';
      i++;
      continue;
    }

    if (state === 'tsq') {
      if (ch === "'" && next === "'" && next2 === "'") {
        state = 'code';
        i += 3;
        continue;
      }
      i++;
      continue;
    }

    if (state === 'tdq') {
      if (ch === '"' && next === '"' && next2 === '"') {
        state = 'code';
        i += 3;
        continue;
      }
      i++;
      continue;
    }
  }
}

function findFStringExprEnd(contents: string, start: number, end: number): number | null {
  let depth = 1;
  let i = start;
  let state: 'code' | 'sq' | 'dq' = 'code';
  while (i < end) {
    const ch = contents[i]!;
    if (state === 'code') {
      if (ch === '{') {
        depth++;
        i++;
        continue;
      }
      if (ch === '}') {
        depth--;
        if (depth === 0) return i;
        i++;
        continue;
      }
      if (ch === "'") {
        state = 'sq';
        i++;
        continue;
      }
      if (ch === '"') {
        state = 'dq';
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (state === 'sq') {
      if (ch === '\\' && i + 1 < end) {
        i += 2;
        continue;
      }
      if (ch === "'") state = 'code';
      i++;
      continue;
    }
    if (state === 'dq') {
      if (ch === '\\' && i + 1 < end) {
        i += 2;
        continue;
      }
      if (ch === '"') state = 'code';
      i++;
      continue;
    }
  }
  return null;
}

function dedupeCalls(sites: PythonCallSite[]): PythonCallSite[] {
  const seen = new Set<number>();
  const out: PythonCallSite[] = [];
  for (const site of sites) {
    if (seen.has(site.offset)) continue;
    seen.add(site.offset);
    out.push(site);
  }
  return out;
}

/**
 * Enumerate risky Python call sites in `contents`. Deterministic and pure.
 */
export function findPythonRiskyCalls(contents: string): PythonCallSite[] {
  const bindings = collectPythonBindings(contents);
  const out: PythonCallSite[] = [];
  walkPythonCalls(contents, bindings, out);
  out.push(...findGetattrRiskyCalls(contents));
  out.push(...findDunderImportRiskyCalls(contents));
  return dedupeCalls(out);
}

export function pythonCallSnippet(contents: string, offset: number, length: number): {
  lineStart: number;
  lineEnd: number;
  snippet: string;
} {
  const lineStart = lineNumber(contents, offset);
  const lineEnd = lineNumber(contents, offset + length);
  return { lineStart, lineEnd, snippet: snippetAround(contents, offset, length) };
}
