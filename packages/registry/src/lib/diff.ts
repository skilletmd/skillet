// Minimal server-side unified diff renderer.
//
// PROTOCOL.md §6.2 ("Graded diff") describes how the CLIENT classifies and
// presents diffs (per-file-type risk grading, opaque-binary surfacing, etc.).
// The server's job is just to emit a deterministic unified diff over the file
// contents; classification is a client concern, so it lives in the CLI.
//
// We could pull in `diff` from npm, but the registry has a single dep policy
// for now (Fastify + node:sqlite). A correct line-LCS unified diff is small.

interface Hunk {
  oldStart: number;
  newStart: number;
  oldLines: string[];
  newLines: string[];
  ops: Array<' ' | '+' | '-'>;
}

// --- Size guard (DoS bound) ------------------------------------------------
//
// lcsTable() allocates an (m+1)*(n+1) number matrix, so the diff is O(m*n) in
// BOTH time and memory. isTextFile() admits bundle entries up to
// MAX_BUNDLE_BYTES (~25 MB), and the public GET /skills/:author/:slug/diff route
// is readable unauthenticated for public skills — so two large versions would
// allocate a ~10^14-entry table and OOM / stall the event loop on an
// unauthenticated request.
//
// We bound BEFORE allocating. Limits are sized for real skill content (SKILL.md
// + scripts / source / config), not generated blobs:
//   - MAX_DIFF_LINES (2000 per side): caps the matrix at 2000*2000 = 4M cells
//     (~32 MB worst case), allocated and traversed in milliseconds.
//   - MAX_DIFF_BYTES (1 MB per side): caps the split/compare/render work and the
//     pathological single-giant-line case the line cap alone would miss (one
//     25 MB line is one "line" but a 25 MB string compare/echo).
// When either side exceeds either bound we return { tooLarge: true } and never
// allocate the table. Callers render this as a deterministic "too large"
// response rather than computing.
export const MAX_DIFF_LINES = 2000;
export const MAX_DIFF_BYTES = 1_000_000;

export type DiffResult = { tooLarge: false; diff: string } | { tooLarge: true };

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const table: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

interface DiffOp {
  op: ' ' | '+' | '-';
  oldLine: number;
  newLine: number;
  text: string;
}

function buildOps(a: string[], b: string[]): DiffOp[] {
  const table = lcsTable(a, b);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ op: ' ', oldLine: i + 1, newLine: j + 1, text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ op: '-', oldLine: i + 1, newLine: j + 1, text: a[i] });
      i++;
    } else {
      ops.push({ op: '+', oldLine: i + 1, newLine: j + 1, text: b[j] });
      j++;
    }
  }
  while (i < a.length) ops.push({ op: '-', oldLine: i + 1, newLine: j + 1, text: a[i++] });
  while (j < b.length) ops.push({ op: '+', oldLine: i + 1, newLine: j + 1, text: b[j++] });
  return ops;
}

const CONTEXT_LINES = 3;

function buildHunks(ops: DiffOp[]): Hunk[] {
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < ops.length) {
    while (i < ops.length && ops[i].op === ' ') i++;
    if (i >= ops.length) break;
    const start = Math.max(0, i - CONTEXT_LINES);
    let end = i;
    let trailing = 0;
    while (end < ops.length && trailing < CONTEXT_LINES) {
      if (ops[end].op === ' ') trailing++;
      else trailing = 0;
      end++;
    }
    const slice = ops.slice(start, end);
    const oldLines: string[] = [];
    const newLines: string[] = [];
    const opMarks: Array<' ' | '+' | '-'> = [];
    for (const o of slice) {
      opMarks.push(o.op);
      if (o.op !== '+') oldLines.push(o.text);
      if (o.op !== '-') newLines.push(o.text);
    }
    hunks.push({
      oldStart: slice[0].oldLine,
      newStart: slice[0].newLine,
      oldLines,
      newLines,
      ops: opMarks,
    });
    i = end;
  }
  return hunks;
}

function splitLines(s: string): string[] {
  if (s === '') return [];
  const lines = s.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function renderUnifiedDiff(
  label: string,
  fromRef: string,
  toRef: string,
  fromContent: string,
  toContent: string
): DiffResult {
  // Bound on raw size before splitting/comparing (cheap, catches giant lines).
  if (fromContent.length > MAX_DIFF_BYTES || toContent.length > MAX_DIFF_BYTES) {
    return { tooLarge: true };
  }
  const a = splitLines(fromContent);
  const b = splitLines(toContent);
  // Bound on line count before lcsTable() allocates the O(m*n) matrix.
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return { tooLarge: true };
  }
  const ops = buildOps(a, b);
  const hunks = buildHunks(ops);

  const out: string[] = [];
  out.push(`--- a/${label}@${fromRef}`);
  out.push(`+++ b/${label}@${toRef}`);
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines.length} +${h.newStart},${h.newLines.length} @@`);
    let oi = 0;
    let ni = 0;
    for (const m of h.ops) {
      if (m === ' ') {
        out.push(' ' + h.oldLines[oi]);
        oi++;
        ni++;
      } else if (m === '-') {
        out.push('-' + h.oldLines[oi]);
        oi++;
      } else {
        out.push('+' + h.newLines[ni]);
        ni++;
      }
    }
  }
  return { tooLarge: false, diff: out.join('\n') + (hunks.length ? '\n' : '') };
}
