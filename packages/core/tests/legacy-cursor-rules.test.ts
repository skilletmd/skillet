/**
 * The sweep that removes the `.cursor/rules/*.mdc` rules the OLD Cursor adapter
 * wrote, now that Cursor reads the `.agents/skills` baseline directly.
 * Recognition-gated: only Skillet-named rules that still carry the generated
 * header go, with the supporting-file dir that sat beside them. Everything else
 * in the user's rules dir stays.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupLegacyCursorRules } from "../src/commands/sync.js";

// Byte-exact shape of what the old adapter generated.
const OURS =
  '---\ndescription: "Does something useful"\nglobs: ["**/*"]\nalwaysApply: false\n---\n\n# heading\n\nbody text.\n';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("cleanupLegacyCursorRules", () => {
  let repo: string;
  let rules: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "skillet-cursor-sweep-"));
    rules = join(repo, ".cursor", "rules");
    await mkdir(rules, { recursive: true });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("removes the rules the old adapter wrote, plus their supporting-file dirs, from a nested cwd", async () => {
    await writeFile(join(rules, "@alice--my-skill.mdc"), OURS);
    await mkdir(join(rules, "@alice--my-skill", "references"), { recursive: true });
    await writeFile(join(rules, "@alice--my-skill", "references", "notes.md"), "ref\n");
    await writeFile(join(rules, "_local--draft.mdc"), OURS);
    const nested = join(repo, "src", "deep");
    await mkdir(nested, { recursive: true });

    await cleanupLegacyCursorRules(nested);

    expect(await exists(join(rules, "@alice--my-skill.mdc"))).toBe(false);
    expect(await exists(join(rules, "@alice--my-skill"))).toBe(false);
    expect(await exists(join(rules, "_local--draft.mdc"))).toBe(false);
    // The rules dir itself belongs to the user.
    expect(await exists(rules)).toBe(true);
  });

  it("leaves what it cannot prove it wrote: user names, user frontmatter, an edited header", async () => {
    // A user rule that happens to share our header shape: not a Skillet name.
    await writeFile(join(rules, "house-style.mdc"), OURS);
    // A Skillet name with the user's own frontmatter.
    await writeFile(
      join(rules, "@alice--my-skill.mdc"),
      "---\ndescription: mine\nalwaysApply: true\n---\nbody\n",
    );
    // Our name, our shape, but the user flipped alwaysApply: the header no longer matches.
    await writeFile(join(rules, "@bob--other.mdc"), OURS.replace("alwaysApply: false", "alwaysApply: true"));
    await mkdir(join(rules, "@bob--other"), { recursive: true });

    await cleanupLegacyCursorRules(repo);

    expect(await exists(join(rules, "house-style.mdc"))).toBe(true);
    expect(await exists(join(rules, "@alice--my-skill.mdc"))).toBe(true);
    expect(await exists(join(rules, "@bob--other.mdc"))).toBe(true);
    expect(await exists(join(rules, "@bob--other"))).toBe(true);
  });

  it("stops at the nearest .cursor/rules and never reaches past it", async () => {
    await writeFile(join(rules, "@alice--outer.mdc"), OURS);
    const inner = join(repo, "pkg");
    const innerRules = join(inner, ".cursor", "rules");
    await mkdir(innerRules, { recursive: true });
    await writeFile(join(innerRules, "@alice--inner.mdc"), OURS);

    await cleanupLegacyCursorRules(join(inner, "src"));

    expect(await exists(join(innerRules, "@alice--inner.mdc"))).toBe(false);
    expect(await exists(join(rules, "@alice--outer.mdc"))).toBe(true);
  });

  it("is a no-op when no ancestor has .cursor/rules", async () => {
    const bare = await mkdtemp(join(tmpdir(), "skillet-cursor-none-"));
    try {
      await expect(cleanupLegacyCursorRules(join(bare, "a", "b"))).resolves.toBeUndefined();
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});
