// JavaScript / TypeScript call-site AST walk (hardened).
// We resolve exec/spawn/system through import/require bindings so RegExp.exec,
// sqlite .exec, and locally-defined exec() are not false positives.

import * as acorn from 'acorn';
import { simple as walk } from 'acorn-walk';
import ts from 'typescript';
import type { Severity } from '../../types.js';
import { lineNumber, snippetAround } from '../util.js';
import { isAllowlistedBinary } from './tool-allowlist.js';

type AcornNode = acorn.Node;
type Identifier = acorn.Identifier;
type MemberExpression = acorn.MemberExpression;
type CallExpression = acorn.CallExpression;
type NewExpression = acorn.NewExpression;
type ObjectExpression = acorn.ObjectExpression;
type ImportDeclaration = acorn.ImportDeclaration;
type ObjectPattern = acorn.ObjectPattern;

export interface JsCallSite {
  callee: string;
  offset: number;
  length: number;
  confidence: Severity;
  detector: string;
}

type ModuleKind = 'child_process' | 'os';

interface Binding {
  kind: ModuleKind;
  /** Imported export name, or `*` for namespace/default imports. */
  exportName: string;
}

const CHILD_PROCESS_SPECS = new Set(['child_process', 'node:child_process']);
const OS_SPECS = new Set(['os', 'node:os']);

const CHILD_RISKY = new Map<string, { confidence: Severity; detector: string }>([
  ['exec', { confidence: 'high', detector: 'js-child-process-exec' }],
  ['execSync', { confidence: 'high', detector: 'js-child-process-exec-sync' }],
  ['spawn', { confidence: 'medium', detector: 'js-child-process-spawn' }],
  ['spawnSync', { confidence: 'medium', detector: 'js-child-process-spawn-sync' }],
]);

const OS_RISKY = new Map<string, { confidence: Severity; detector: string }>([
  ['system', { confidence: 'high', detector: 'js-os-system' }],
]);

function isIdentifier(node: AcornNode): node is Identifier {
  return node.type === 'Identifier';
}

function isMemberExpression(node: AcornNode): node is MemberExpression {
  return node.type === 'MemberExpression';
}

function calleeLabel(node: AcornNode): string | null {
  if (isIdentifier(node)) return node.name;
  if (isMemberExpression(node) && !node.computed && isIdentifier(node.property)) {
    if (isIdentifier(node.object)) {
      return `${node.object.name}.${node.property.name}`;
    }
    if (
      isMemberExpression(node.object) &&
      !node.object.computed &&
      isIdentifier(node.object.object) &&
      isIdentifier(node.object.property)
    ) {
      return `${node.object.object.name}.${node.object.property.name}.${node.property.name}`;
    }
  }
  return null;
}

function nodeSpan(node: { start: number | null; end: number | null }): { offset: number; length: number } {
  const start = node.start ?? 0;
  const end = node.end ?? start;
  return { offset: start, length: end - start };
}

/**
 * Suppress a static-binary spawn: `spawnSync('npx', ['wrangler', 'deploy'])`
 * runs a known tool with fixed args — a capability, not a threat. Only for
 * spawn/spawnSync (medium), never shell:true, and only when the first arg is a
 * string literal naming an allowlisted binary. exec/execSync (high, shell) and
 * any dynamic first arg keep their finding.
 */
function isStaticAllowlistedSpawn(method: string, args: CallExpression['arguments']): boolean {
  if (method !== 'spawn' && method !== 'spawnSync') return false;
  if (hasShellOption(args)) return false;
  const first = args[0];
  if (!first || first.type !== 'Literal' || typeof first.value !== 'string') return false;
  return isAllowlistedBinary(first.value);
}

function hasShellOption(args: CallExpression['arguments']): boolean {
  for (const arg of args) {
    if (arg.type !== 'ObjectExpression') continue;
    const obj = arg as ObjectExpression;
    for (const prop of obj.properties) {
      if (prop.type !== 'Property' || !isIdentifier(prop.key)) continue;
      if (prop.key.name !== 'shell') continue;
      if (prop.value.type === 'Literal' && prop.value.value === true) return true;
    }
  }
  return false;
}

function moduleKindFromSpecifier(spec: string): ModuleKind | null {
  if (CHILD_PROCESS_SPECS.has(spec)) return 'child_process';
  if (OS_SPECS.has(spec)) return 'os';
  return null;
}

function requireModuleArg(node: CallExpression): string | null {
  if (!isIdentifier(node.callee) || node.callee.name !== 'require') return null;
  const arg = node.arguments[0];
  if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return null;
  return arg.value;
}

function patternKey(prop: acorn.ObjectPattern['properties'][number]): string | null {
  if (prop.type !== 'Property') return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') return prop.key.value;
  return null;
}

type BodyNode = acorn.Program['body'][number];

function ingestBindingStatement(
  stmt: BodyNode,
  bindings: Map<string, Binding>,
  localShadows: Set<string>,
): void {
  if (stmt.type === 'ImportDeclaration') {
    const imp = stmt as ImportDeclaration;
    const mod = moduleKindFromSpecifier(String(imp.source.value));
    if (!mod) return;
    for (const spec of imp.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        const local = spec.local.name;
        const imported =
          spec.imported.type === 'Identifier' ? spec.imported.name : String(spec.imported.value);
        bindings.set(local, { kind: mod, exportName: imported });
      } else if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
        bindings.set(spec.local.name, { kind: mod, exportName: '*' });
      }
    }
    return;
  }

  if (stmt.type === 'FunctionDeclaration' && stmt.id) {
    localShadows.add(stmt.id.name);
    return;
  }

  if (stmt.type !== 'VariableDeclaration') return;

  for (const decl of stmt.declarations) {
    if (decl.type !== 'VariableDeclarator') continue;
    const init = decl.init;
    if (!init || init.type !== 'CallExpression') continue;
    const modSpec = requireModuleArg(init);
    if (!modSpec) continue;
    const mod = moduleKindFromSpecifier(modSpec);
    if (!mod) continue;

    if (decl.id.type === 'Identifier') {
      bindings.set(decl.id.name, { kind: mod, exportName: '*' });
      continue;
    }

    if (decl.id.type === 'ObjectPattern') {
      const pattern = decl.id as ObjectPattern;
      for (const prop of pattern.properties) {
        if (prop.type !== 'Property' || prop.value.type !== 'Identifier') continue;
        const key = patternKey(prop);
        if (!key) continue;
        bindings.set(prop.value.name, { kind: mod, exportName: key });
      }
    }
  }
}

function ingestBindingBlock(
  statements: BodyNode[],
  bindings: Map<string, Binding>,
  localShadows: Set<string>,
): void {
  for (const stmt of statements) ingestBindingStatement(stmt, bindings, localShadows);
}

function collectBindings(program: acorn.Program): {
  bindings: Map<string, Binding>;
  localShadows: Set<string>;
} {
  const bindings = new Map<string, Binding>();
  const localShadows = new Set<string>();

  ingestBindingBlock(program.body, bindings, localShadows);

  walk(program, {
    FunctionDeclaration(node) {
      if (node.body) ingestBindingBlock(node.body.body, bindings, localShadows);
    },
    FunctionExpression(node) {
      if (node.body) ingestBindingBlock(node.body.body, bindings, localShadows);
    },
    ArrowFunctionExpression(node) {
      if (node.body.type === 'BlockStatement') {
        ingestBindingBlock(node.body.body, bindings, localShadows);
      }
    },
  });

  return { bindings, localShadows };
}

function memberMethodName(mem: MemberExpression): string | null {
  if (mem.computed) {
    if (mem.property.type === 'Literal' && typeof mem.property.value === 'string') {
      return mem.property.value;
    }
    return null;
  }
  return isIdentifier(mem.property) ? mem.property.name : null;
}

function resolveInlineRequireMember(
  mem: MemberExpression,
): { confidence: Severity; detector: string } | null {
  if (mem.object.type !== 'CallExpression') return null;
  const modSpec = requireModuleArg(mem.object);
  if (!modSpec) return null;
  const mod = moduleKindFromSpecifier(modSpec);
  const method = memberMethodName(mem);
  if (!mod || !method) return null;
  if (mod === 'child_process') return CHILD_RISKY.get(method) ?? null;
  if (mod === 'os' && method === 'system') return OS_RISKY.get('system') ?? null;
  return null;
}

function bindingMatchesExport(binding: Binding, exportName: string): boolean {
  return binding.exportName === '*' || binding.exportName === exportName;
}

function resolveBareCall(
  name: string,
  bindings: Map<string, Binding>,
  localShadows: Set<string>,
): { confidence: Severity; detector: string } | null {
  if (name === 'eval') {
    return { confidence: 'high', detector: 'js-eval' };
  }
  if (localShadows.has(name)) return null;
  const binding = bindings.get(name);
  if (!binding) return null;
  if (binding.kind === 'child_process') {
    const spec = CHILD_RISKY.get(binding.exportName);
    if (spec) return spec;
  }
  if (binding.kind === 'os') {
    const spec = OS_RISKY.get(binding.exportName);
    if (spec) return spec;
  }
  return null;
}

function resolveMemberCall(
  objectName: string,
  method: string,
  bindings: Map<string, Binding>,
): { confidence: Severity; detector: string } | null {
  const binding = bindings.get(objectName);
  if (!binding) return null;
  if (binding.kind === 'child_process' && bindingMatchesExport(binding, method)) {
    return CHILD_RISKY.get(method) ?? null;
  }
  if (binding.kind === 'os' && method === 'system' && bindingMatchesExport(binding, 'system')) {
    return OS_RISKY.get('system') ?? null;
  }
  return null;
}

function stripTypeScript(contents: string, fileName: string): string {
  const out = ts.transpileModule(contents, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: fileName.endsWith('.tsx') ? ts.JsxEmit.React : ts.JsxEmit.None,
    },
    reportDiagnostics: false,
    fileName,
  });
  return out.outputText;
}

function parseProgram(contents: string): acorn.Program | null {
  try {
    return acorn.parse(contents, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
      allowAwaitOutsideFunction: true,
    }) as acorn.Program;
  } catch {
    try {
      return acorn.parse(contents, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowHashBang: true,
        allowReturnOutsideFunction: true,
      }) as acorn.Program;
    } catch {
      return null;
    }
  }
}

/**
 * Parse `contents` and return risky JS call sites. TypeScript sources are
 * stripped to JS first. Returns [] on parse failure.
 */
export function findJavaScriptRiskyCalls(contents: string, fileName?: string): JsCallSite[] {
  // Declaration files (`.d.ts`) are types only — no runtime call sites — and the
  // TS transpiler emits no output for them, which throws. Skip them outright.
  if (fileName && /\.d\.tsx?$/i.test(fileName)) return [];

  let source = contents;
  if (fileName && /\.tsx?$/i.test(fileName)) {
    try {
      source = stripTypeScript(contents, fileName);
    } catch {
      // A file the TS transpiler can't lower must never crash the whole scan
      // (and thus block an unrelated publish). Fall back to the raw source; if it
      // isn't parseable JS, parseProgram returns null and we yield no findings.
      source = contents;
    }
  }

  const program = parseProgram(source);
  if (!program) return [];

  const { bindings, localShadows } = collectBindings(program);
  const out: JsCallSite[] = [];

  walk(program, {
    CallExpression(node) {
      if (isMemberExpression(node.callee)) {
        const inline = resolveInlineRequireMember(node.callee);
        if (inline) {
          const span = nodeSpan(node);
          out.push({
            callee: calleeLabel(node.callee) ?? 'require().call',
            ...span,
            confidence: inline.confidence,
            detector: inline.detector,
          });
          return;
        }

        const method = memberMethodName(node.callee);
        if (method && isIdentifier(node.callee.object)) {
          const member = resolveMemberCall(node.callee.object.name, method, bindings);
          if (member) {
            if (isStaticAllowlistedSpawn(method, node.arguments)) return;
            let confidence = member.confidence;
            let detector = member.detector;
            if ((method === 'spawn' || method === 'spawnSync') && hasShellOption(node.arguments)) {
              confidence = 'high';
              detector = `${member.detector}-shell`;
            }
            const span = nodeSpan(node);
            out.push({
              callee: `${node.callee.object.name}.${method}`,
              ...span,
              confidence,
              detector,
            });
            return;
          }
        }
      }

      const callee = calleeLabel(node.callee);
      if (!callee) return;

      if (!callee.includes('.')) {
        const bare = resolveBareCall(callee, bindings, localShadows);
        if (!bare) return;
        if (isStaticAllowlistedSpawn(callee, node.arguments)) return;
        const span = nodeSpan(node);
        out.push({ callee, ...span, confidence: bare.confidence, detector: bare.detector });
        return;
      }

      const dot = callee.lastIndexOf('.');
      const objectName = callee.slice(0, dot);
      const method = callee.slice(dot + 1);
      const objectBase = objectName.includes('.') ? objectName.slice(0, objectName.indexOf('.')) : objectName;
      const member = resolveMemberCall(objectBase, method, bindings);
      if (!member) return;
      if (isStaticAllowlistedSpawn(method, node.arguments)) return;

      let confidence = member.confidence;
      let detector = member.detector;
      if ((method === 'spawn' || method === 'spawnSync') && hasShellOption(node.arguments)) {
        confidence = 'high';
        detector = `${member.detector}-shell`;
      }

      const span = nodeSpan(node);
      out.push({ callee, ...span, confidence, detector });
    },
    NewExpression(node: NewExpression) {
      if (isIdentifier(node.callee) && node.callee.name === 'Function') {
        const span = nodeSpan(node);
        out.push({
          callee: 'Function',
          ...span,
          confidence: 'high',
          detector: 'js-new-function',
        });
      }
    },
  });

  return out;
}

export function jsCallSnippet(contents: string, offset: number, length: number): {
  lineStart: number;
  lineEnd: number;
  snippet: string;
} {
  const lineStart = lineNumber(contents, offset);
  const lineEnd = lineNumber(contents, offset + length);
  return { lineStart, lineEnd, snippet: snippetAround(contents, offset, length) };
}
