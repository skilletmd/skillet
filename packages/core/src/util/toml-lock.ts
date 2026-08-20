/**
 * Minimal TOML serializer/parser scoped to the `skillet.lock` schema only
 * (PROTOCOL §11). Deliberately not a general TOML library — accepts and
 * emits exactly the shapes the lockfile uses:
 *
 *   - top-level scalars: `key = "string"` or `key = <integer>`
 *   - array-of-tables headers: `[[skill]]`
 *   - inline tables: `signature = { alg = "ed25519", ... }`
 *
 * Why hand-rolled instead of @iarna/toml:
 *   - No new dependency surface for a single tiny, tightly-controlled schema.
 *   - String values are all URL/hex/base64/RFC3339 — no escape ambiguity.
 *   - Round-trip is property-tested so any drift fails CI before it ships.
 *
 * Strings are emitted as TOML basic-strings; the encoder REFUSES any value
 * containing a control char, backslash, or quote so we never produce
 * ambiguous output. The parser only accepts basic-strings — `'literal'`,
 * multi-line, and `0x` numerics are not supported and not needed.
 */

export type TomlScalar = string | number;
export type TomlInlineTable = Record<string, TomlScalar>;
export type TomlTopValue = TomlScalar | TomlInlineTable;

export interface TomlArrayOfTablesDoc {
  /** Top-level scalars in the order they were emitted/encountered. */
  top: Record<string, TomlTopValue>;
  /** Repeated [[name]] tables; preserves order. */
  tables: Record<string, Array<Record<string, TomlTopValue>>>;
}

// Refuse to emit anything that would need escaping in a TOML basic-string.
// Lockfile values are URLs, hex, base64, RFC3339 — never contain control
// chars, backslashes, or quotes. Refusing is safer than escaping.
function emitString(v: string): string {
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(
        `toml-lock: refusing to emit string with control char U+${code.toString(16).padStart(4, "0")}`
      );
    }
  }
  if (v.includes("\\") || v.includes('"')) {
    throw new Error(
      `toml-lock: refusing to emit string containing backslash or quote: ${JSON.stringify(v)}`
    );
  }
  return `"${v}"`;
}

function emitInteger(v: number): string {
  if (!Number.isInteger(v)) {
    throw new Error(`toml-lock: only integers supported, got ${v}`);
  }
  return String(v);
}

function emitScalar(v: TomlScalar): string {
  if (typeof v === "string") return emitString(v);
  if (typeof v === "number") return emitInteger(v);
  throw new Error(`toml-lock: unsupported scalar ${typeof v}`);
}

function emitInlineTable(v: TomlInlineTable): string {
  const parts = Object.entries(v).map(([k, val]) => `${k} = ${emitScalar(val)}`);
  return `{ ${parts.join(", ")} }`;
}

function emitTopValue(v: TomlTopValue): string {
  if (v !== null && typeof v === "object") return emitInlineTable(v);
  return emitScalar(v);
}

export function encodeLockToml(doc: TomlArrayOfTablesDoc): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(doc.top)) {
    lines.push(`${k} = ${emitTopValue(v)}`);
  }
  for (const [name, entries] of Object.entries(doc.tables)) {
    for (const entry of entries) {
      lines.push("");
      lines.push(`[[${name}]]`);
      for (const [k, v] of Object.entries(entry)) {
        lines.push(`${k} = ${emitTopValue(v)}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

// ── parser ───────────────────────────────────────────────────────────────────

function stripComment(line: string): string {
  // Strings cannot contain unescaped `"` (see encoder), so we can scan once.
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inStr = !inStr;
    else if (c === "#" && !inStr) return line.slice(0, i);
  }
  return line;
}

function parseString(token: string): string {
  if (!token.startsWith('"') || !token.endsWith('"') || token.length < 2) {
    throw new Error(`toml-lock parse: expected basic-string, got ${JSON.stringify(token)}`);
  }
  const body = token.slice(1, -1);
  if (body.includes("\\")) {
    throw new Error(`toml-lock parse: escape sequences not supported in ${JSON.stringify(token)}`);
  }
  if (body.includes('"')) {
    throw new Error(`toml-lock parse: unescaped quote in ${JSON.stringify(token)}`);
  }
  return body;
}

function parseInteger(token: string): number {
  if (!/^-?\d+$/.test(token)) {
    throw new Error(`toml-lock parse: expected integer, got ${JSON.stringify(token)}`);
  }
  const n = Number(token);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`toml-lock parse: integer ${token} out of safe range`);
  }
  return n;
}

function parseScalar(token: string): TomlScalar {
  const t = token.trim();
  if (t.startsWith('"')) return parseString(t);
  return parseInteger(t);
}

function parseInlineTable(token: string): TomlInlineTable {
  const t = token.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) {
    throw new Error(`toml-lock parse: expected inline table, got ${JSON.stringify(token)}`);
  }
  const body = t.slice(1, -1).trim();
  if (body === "") return {};

  // Split on commas that aren't inside strings.
  const pieces: string[] = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') inStr = !inStr;
    if (c === "," && !inStr) {
      pieces.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim() !== "") pieces.push(cur);

  const out: TomlInlineTable = {};
  for (const p of pieces) {
    const eq = p.indexOf("=");
    if (eq < 0) {
      throw new Error(`toml-lock parse: malformed inline-table entry ${JSON.stringify(p)}`);
    }
    const key = p.slice(0, eq).trim();
    const val = p.slice(eq + 1).trim();
    out[key] = parseScalar(val);
  }
  return out;
}

function parseValue(token: string): TomlTopValue {
  const t = token.trim();
  if (t.startsWith("{")) return parseInlineTable(t);
  return parseScalar(t);
}

export function decodeLockToml(input: string): TomlArrayOfTablesDoc {
  const doc: TomlArrayOfTablesDoc = { top: {}, tables: {} };
  let current: Record<string, TomlTopValue> | null = null; // null = top-level
  let currentName: string | null = null;

  const rawLines = input.split(/\r?\n/);
  for (let lineNo = 0; lineNo < rawLines.length; lineNo++) {
    const raw = rawLines[lineNo];
    const line = stripComment(raw).trim();
    if (line === "") continue;

    // Array-of-tables header: [[name]]
    if (line.startsWith("[[") && line.endsWith("]]")) {
      const name = line.slice(2, -2).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
        throw new Error(`toml-lock parse line ${lineNo + 1}: invalid table name ${JSON.stringify(name)}`);
      }
      currentName = name;
      current = {};
      (doc.tables[name] ??= []).push(current);
      continue;
    }

    // Plain `[name]` tables intentionally unsupported — schema doesn't use them.
    if (line.startsWith("[")) {
      throw new Error(`toml-lock parse line ${lineNo + 1}: standard tables not supported (${line})`);
    }

    // key = value
    const eq = line.indexOf("=");
    if (eq < 0) {
      throw new Error(`toml-lock parse line ${lineNo + 1}: expected "key = value", got ${JSON.stringify(line)}`);
    }
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
      throw new Error(`toml-lock parse line ${lineNo + 1}: invalid bare key ${JSON.stringify(key)}`);
    }
    const parsed = parseValue(val);

    if (current === null) {
      if (key in doc.top) {
        throw new Error(`toml-lock parse line ${lineNo + 1}: duplicate top-level key ${key}`);
      }
      doc.top[key] = parsed;
    } else {
      if (key in current) {
        throw new Error(
          `toml-lock parse line ${lineNo + 1}: duplicate key ${key} in [[${currentName}]]`
        );
      }
      current[key] = parsed;
    }
  }
  return doc;
}
