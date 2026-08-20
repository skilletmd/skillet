import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// Hard ban on hardcoding the registry API version prefix in the core/CLI surface.
// Every caller builds registry URLs off REGISTRY_API (packages/core/src/registry-api.ts,
// re-exported from @skillet/core) so a future v1->v2 bump is one edit. A bare
// `/api/v1` literal in a URL is exactly the drift that silently broke avatar
// upload when the registry moved /v1 -> /api/v1.
//
// Comment lines and the definition file itself are exempt.
const PREFIX_LITERAL = /\/api\/v1/;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [
  { label: "core", dir: join(HERE, "..", "src"), allow: new Set(["registry-api.ts"]) },
  { label: "cli", dir: join(HERE, "..", "..", "cli", "src"), allow: new Set<string>() },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__")
        continue;
      out.push(...sourceFiles(full));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** A match inside a line comment or a block-comment/doc line is not a real URL. */
function isCommentMatch(line: string): boolean {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return true;
  // Neutralize scheme separators first so a URL's `://` isn't mistaken for a line
  // comment — a hardcoded `https://host/api/v1/…` literal must still be caught.
  // The replacement is the same length, so column positions stay accurate.
  const code = line.replace(/:\/\//g, ":  ");
  const slashSlash = code.indexOf("//");
  const match = code.search(PREFIX_LITERAL);
  return slashSlash !== -1 && slashSlash < match;
}

describe("registry API prefix (core/CLI)", () => {
  it("is sourced from REGISTRY_API, never a hardcoded /api/v1 literal", () => {
    const violations: string[] = [];
    for (const { dir, allow } of ROOTS) {
      for (const file of sourceFiles(dir)) {
        const rel = relative(dir, file);
        if (allow.has(rel)) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (PREFIX_LITERAL.test(line) && !isCommentMatch(line)) {
              violations.push(`${relative(HERE, file)}:${i + 1}`);
            }
          });
      }
    }
    expect(
      violations,
      `Build registry URLs from REGISTRY_API (@skillet/core), not a raw /api/v1:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
