// Well-known developer tool binaries. A subprocess/spawn call whose command is a
// STATIC string literal naming one of these — and which is not shell=True or a
// dynamically-built command — is a capability, not a threat: it runs a known
// tool with fixed arguments. The capability collector still records it; the
// threat detectors suppress the finding so a legit build/deploy/setup script
// doesn't wear a security flag. Anything variable, interpolated, shell=True, or
// naming a non-allowlisted binary keeps its confidence.
export const TOOL_ALLOWLIST = new Set([
  'uv',
  'uvx',
  'npx',
  'npm',
  'pnpm',
  'yarn',
  'node',
  'deno',
  'bun',
  'python',
  'python3',
  'pip',
  'pip3',
  'pipx',
  'poetry',
  'ruby',
  'bundle',
  'go',
  'cargo',
  'rustc',
  'java',
  'javac',
  'gradle',
  'mvn',
  'dotnet',
  'dart',
  'flutter',
  'git',
  'make',
  'cmake',
  'docker',
  'wrangler',
  'terraform',
  'kubectl',
  'helm',
  'aws',
  'gcloud',
  'az',
  'vercel',
  'brew',
  'tsc',
  'tsx',
  'eslint',
  'prettier',
  'pytest',
  'jest',
  'vitest',
]);

/** The basename of a binary path, lowercased — `/usr/bin/python3` → `python3`. */
export function binaryBasename(raw: string): string {
  const trimmed = raw.trim();
  const firstToken = trimmed.split(/\s+/)[0] ?? '';
  const base = firstToken.split('/').pop() ?? firstToken;
  return base.toLowerCase();
}

/** True when `raw` (the first literal command token) names an allowlisted tool. */
export function isAllowlistedBinary(raw: string): boolean {
  return TOOL_ALLOWLIST.has(binaryBasename(raw));
}
