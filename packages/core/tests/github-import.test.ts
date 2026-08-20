/**
 * Discover + import from a public GitHub repo.
 *
 * fetch is faked from an in-memory repo fixture so the whole flow — repo
 * metadata, recursive tree, raw file bytes, nested-skill bundling, and the
 * write into the kit — runs with no network and no real $HOME.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";

const TEST_ROOT = vi.hoisted(() => {
  const osMod = require("node:os") as typeof import("node:os");
  const cryptoMod = require("node:crypto") as typeof import("node:crypto");
  const pathMod = require("node:path") as typeof import("node:path");
  const root = pathMod.join(
    osMod.tmpdir(),
    `skillet-gh-import-${cryptoMod.randomBytes(4).toString("hex")}`,
  );
  process.env["HOME"] = root;
  process.env["SKILLET_DIR"] = pathMod.join(root, ".skillet");
  return root;
});

import {
  discoverGitHubSkills,
  importGitHubSkill,
} from "../src/commands/import-github.js";
import { GitHubSource, GitHubError } from "../src/github/client.js";
import { readState } from "../src/kit/store.js";

/** A fake repo: default branch + a path→content file map. */
interface FakeRepo {
  defaultBranch: string;
  private?: boolean;
  files: Record<string, string>;
}

/**
 * Build a fetch impl that serves the three GitHub endpoints the source touches
 * from an in-memory `FakeRepo`. Unknown repos 404; a `null` repo simulates a
 * private/nonexistent repo (also 404 on the metadata call).
 */
function fakeFetch(
  repos: Record<string, FakeRepo | null>,
): typeof fetch {
  return (async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    // Repo metadata: GET api.github.com/repos/:owner/:repo
    let m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)$/);
    if (m) {
      const repo = repos[`${m[1]}/${m[2]}`];
      if (!repo) return new Response("Not Found", { status: 404 });
      return Response.json({ default_branch: repo.defaultBranch, private: repo.private === true });
    }

    // Recursive tree: GET api.github.com/repos/:owner/:repo/git/trees/:ref?recursive=1
    m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^?]+)/);
    if (m) {
      const repo = repos[`${m[1]}/${m[2]}`];
      if (!repo) return new Response("Not Found", { status: 404 });
      const tree = Object.entries(repo.files).map(([path, content]) => ({
        path,
        type: "blob",
        size: Buffer.byteLength(content),
      }));
      return Response.json({ tree, truncated: false });
    }

    // Raw file: raw.githubusercontent.com/:owner/:repo/:ref/:path
    m = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+\/(.+)$/);
    if (m) {
      const repo = repos[`${m[1]}/${m[2]}`];
      const path = decodeURIComponent(m[3]);
      const content = repo?.files[path];
      if (content == null) return new Response("Not Found", { status: 404 });
      return new Response(content);
    }

    return new Response("unexpected url: " + url, { status: 500 });
  }) as unknown as typeof fetch;
}

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

afterEach(async () => {
  await rm(join(TEST_ROOT, ".skillet"), { recursive: true, force: true });
});

describe("discoverGitHubSkills", () => {
  it("finds a single root skill and parses its frontmatter", async () => {
    const source = new GitHubSource({
      fetchImpl: fakeFetch({
        "taylor/ops": {
          defaultBranch: "main",
          files: {
            "SKILL.md": skillMd("Festival Ops", "run the festival"),
            "references/runbook.md": "do the thing",
          },
        },
      }),
    });

    const d = await discoverGitHubSkills("taylor/ops", { source });
    expect(d.ref).toBe("main");
    expect(d.skills).toHaveLength(1);
    expect(d.skills[0]).toMatchObject({
      dir: "",
      name: "Festival Ops",
      description: "run the festival",
      slug: "festival-ops",
    });
    expect(d.skills[0].files.map((f) => f.path).sort()).toEqual([
      "SKILL.md",
      "references/runbook.md",
    ]);
  });

  it("finds multiple skills and assigns nested files to the nearest bundle", async () => {
    const source = new GitHubSource({
      fetchImpl: fakeFetch({
        "acme/kit": {
          defaultBranch: "main",
          files: {
            "packs/a/SKILL.md": skillMd("Alpha", "a"),
            "packs/a/refs/x.md": "ax",
            "packs/b/SKILL.md": skillMd("Beta", "b"),
            "README.md": "top-level, belongs to nobody",
          },
        },
      }),
    });

    const d = await discoverGitHubSkills("acme/kit", { source });
    expect(d.skills.map((s) => s.slug).sort()).toEqual(["alpha", "beta"]);
    const alpha = d.skills.find((s) => s.slug === "alpha")!;
    expect(alpha.files.map((f) => f.path).sort()).toEqual([
      "packs/a/SKILL.md",
      "packs/a/refs/x.md",
    ]);
    // README.md is under no skill dir → dropped from every bundle.
    expect(d.skills.flatMap((s) => s.files.map((f) => f.path))).not.toContain("README.md");
  });

  it("returns an empty list for a repo with no SKILL.md (clean, not an error)", async () => {
    const source = new GitHubSource({
      fetchImpl: fakeFetch({
        "acme/empty": { defaultBranch: "main", files: { "README.md": "hi" } },
      }),
    });
    const d = await discoverGitHubSkills("acme/empty", { source });
    expect(d.skills).toEqual([]);
  });

  it("scopes discovery to a subdir", async () => {
    const source = new GitHubSource({
      fetchImpl: fakeFetch({
        "acme/kit": {
          defaultBranch: "main",
          files: {
            "packs/a/SKILL.md": skillMd("Alpha", "a"),
            "other/b/SKILL.md": skillMd("Beta", "b"),
          },
        },
      }),
    });
    const d = await discoverGitHubSkills("acme/kit/packs", { source });
    expect(d.skills.map((s) => s.slug)).toEqual(["alpha"]);
  });

  it("gives a clear error for a private/nonexistent repo", async () => {
    const source = new GitHubSource({
      fetchImpl: fakeFetch({ "acme/secret": null }),
    });
    await expect(discoverGitHubSkills("acme/secret", { source })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("disambiguates colliding slugs", async () => {
    const source = new GitHubSource({
      fetchImpl: fakeFetch({
        "acme/kit": {
          defaultBranch: "main",
          files: {
            "x/SKILL.md": skillMd("Ops", "one"),
            "y/SKILL.md": skillMd("Ops", "two"),
          },
        },
      }),
    });
    const d = await discoverGitHubSkills("acme/kit", { source });
    expect(d.skills.map((s) => s.slug).sort()).toEqual(["ops", "ops-2"]);
  });
});

describe("importGitHubSkill", () => {
  it("imports a chosen skill into the kit (private/local, with origin)", async () => {
    const source = new GitHubSource({
      fetchImpl: fakeFetch({
        "taylor/ops": {
          defaultBranch: "main",
          files: {
            "SKILL.md": skillMd("Festival Ops", "run the festival"),
            "references/runbook.md": "do the thing",
          },
        },
      }),
    });

    const d = await discoverGitHubSkills("taylor/ops", { source });
    const entry = await importGitHubSkill(d, d.skills[0], { source });

    expect(entry).toMatchObject({
      slug: "festival-ops",
      name: "Festival Ops",
      source: "local",
      version: 1,
      origin: "github:taylor/ops@main",
    });
    expect(entry.hash).toMatch(/^sha256:/);

    // It is in the kit state...
    const state = await readState();
    expect(state.skills["festival-ops"]).toBeTruthy();

    // ...and the full bundle tree is on disk.
    const base = join(process.env["SKILLET_DIR"] as string, "skills", "festival-ops");
    expect(await readFile(join(base, "SKILL.md"), "utf8")).toContain("Festival Ops");
    expect(await readFile(join(base, "references", "runbook.md"), "utf8")).toBe("do the thing");
  });

  it("re-roots a nested skill's paths at the skill dir", async () => {
    const source = new GitHubSource({
      fetchImpl: fakeFetch({
        "acme/kit": {
          defaultBranch: "main",
          files: {
            "packs/a/SKILL.md": skillMd("Alpha", "a"),
            "packs/a/refs/x.md": "ax",
          },
        },
      }),
    });
    const d = await discoverGitHubSkills("acme/kit", { source });
    const entry = await importGitHubSkill(d, d.skills[0], { source });
    expect(entry.origin).toBe("github:acme/kit@main#packs/a");
    const base = join(process.env["SKILLET_DIR"] as string, "skills", "alpha");
    expect(await readFile(join(base, "SKILL.md"), "utf8")).toContain("Alpha");
    expect(await readFile(join(base, "refs", "x.md"), "utf8")).toBe("ax");
  });
});

describe("GitHubSource error mapping", () => {
  it("maps an anonymous rate-limit 403 to a friendly error", async () => {
    const fetchImpl = (async () =>
      new Response("rate limited", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      })) as unknown as typeof fetch;
    const source = new GitHubSource({ fetchImpl });
    await expect(source.getRepoMeta("a", "b")).rejects.toBeInstanceOf(GitHubError);
    await expect(source.getRepoMeta("a", "b")).rejects.toMatchObject({ code: "rate_limited" });
  });
});
