/**
 * U3/R10 — propose-customized: a customized skill's LIVE on-disk edit pipes into
 * the existing proposal machinery against its `customized_from` lineage origin,
 * with the on-disk tree as the bundle and the lineage hash as the base (no
 * auto-rebase).
 *
 *   - authorized: POST targets the origin author/slug with the lineage base
 *     hash; the skill STAYS customized (the edit is still live, still private).
 *   - 403 not_authorized / 409 base_stale: TYPED results, never raw throws.
 *   - not_customized / local origin: typed errors before any network call.
 *   - self-handle propose() regression: existing callers unchanged.
 *
 * Conventions mirror propose.test.ts (mockFetch + SKILLET_DIR isolation).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalContentHash } from "@skillet/protocol";
import type { Adapter } from "../src/adapter.js";
import type { KitState, SkillEntry } from "../src/kit/types.js";

interface MockCall {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(
  responder: (call: MockCall) => { status: number; body: unknown },
): { fetch: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const call: MockCall = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const { status, body } = responder(call);
    const text = body == null ? "" : JSON.stringify(body);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

const EDITED_SKILL = `---
name: foo
description: An edited test skill.
---

# foo

This copy was hand-edited on this machine.
`;

const CLEAN_SKILL = `---
name: my-skill
description: A test skill.
---

# my-skill

This skill does something useful.
`;

const LINEAGE_BASE_HASH = `sha256:${"a".repeat(64)}`;

let root: string; // SKILLET_DIR (state + store)
let adapterRoot: string; // where the live edit lives on disk
let configDir: string;

async function seedIdentityAndKey(registryUrl = "https://r.test"): Promise<{ keyId: string }> {
  const { generateAuthorKey, saveAuthorKey } = await import("../src/signing/index.js");
  const { saveIdentity } = await import("../src/identity/index.js");
  const key = generateAuthorKey();
  await saveAuthorKey(key, configDir);
  await saveIdentity({
    handle: "taylor",
    keyId: key.keyId,
    registryUrl,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  return { keyId: key.keyId };
}

async function seedSkill(slug: string, content: string): Promise<string> {
  const { upsertSkill, skillContentDir, skillContentPath } = await import("../src/kit/store.js");
  await mkdir(skillContentDir(slug), { recursive: true });
  await writeFile(skillContentPath(slug), content, "utf8");
  const bundle = new Map([["SKILL.md", Buffer.from(content, "utf8")]]);
  const hash = canonicalContentHash(bundle);
  await upsertSkill({
    slug,
    name: slug,
    description: "",
    version: 1,
    hash,
    source: "local",
    importedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  return hash;
}

/** A stub global adapter whose targetSkillDir maps a bare slug under adapterRoot. */
function stubAdapter(): Adapter {
  return {
    name: "claude-code",
    kind: "global",
    targetDir: adapterRoot,
    detect: async () => true,
    materialize: async () => [],
    targetSkillDir: (slug: string) => join(adapterRoot, slug),
  } as unknown as Adapter;
}

/**
 * Seed a CUSTOMIZED registry skill: a state entry with `customized_from`, and
 * the live edited bytes on disk in the adapter dir.
 */
async function seedCustomized(over: Partial<SkillEntry> = {}): Promise<void> {
  const { writeState } = await import("../src/kit/store.js");
  const editDir = join(adapterRoot, "foo");
  await mkdir(editDir, { recursive: true });
  await writeFile(join(editDir, "SKILL.md"), EDITED_SKILL, "utf8");
  const now = "2026-01-01T00:00:00.000Z";
  const state: KitState = {
    version: 1,
    skills: {
      "@alice/foo": {
        slug: "@alice/foo",
        name: "foo",
        description: "",
        version: 3,
        hash: LINEAGE_BASE_HASH,
        source: "registry",
        sourceKit: "@alice/kit",
        owner: "alice",
        importedAt: now,
        updatedAt: now,
        customized_from: { author: "alice", slug: "@alice/foo", version: 3, hash: LINEAGE_BASE_HASH },
        ...over,
      } as SkillEntry,
    },
  };
  await writeState(state);
}

describe("proposeCustomized", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "skillet-propcust-home-"));
    adapterRoot = await mkdtemp(join(tmpdir(), "skillet-propcust-adapters-"));
    configDir = await mkdtemp(join(tmpdir(), "skillet-propcust-cfg-"));
    process.env["SKILLET_DIR"] = root;
    delete process.env["SKILLET_TOKEN"];
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(adapterRoot, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
    delete process.env["SKILLET_DIR"];
  });

  it("authorized: proposal targets the origin author/slug with the lineage base hash; skill stays customized", async () => {
    const { proposeCustomized } = await import("../src/commands/propose.js");
    const { listCustomized } = await import("../src/commands/edits.js");
    const { keyId } = await seedIdentityAndKey();
    await seedCustomized();
    const editedHash = canonicalContentHash(new Map([["SKILL.md", Buffer.from(EDITED_SKILL, "utf8")]]));

    const { fetch, calls } = mockFetch((call) => {
      // The bundle comes from the LIVE on-disk edit and the base from lineage —
      // no manifest fetch, no skill-store read, no auto-rebase.
      expect(call.url).toBe("https://r.test/api/v1/skills/alice/foo/proposals");
      expect(call.method).toBe("POST");
      const body = call.body as {
        files: Record<string, { content: string }>;
        base_hash: string | null;
        signature: { alg: string; key_id: string; sig: string };
      };
      expect(body.base_hash).toBe(LINEAGE_BASE_HASH);
      expect(body.signature.key_id).toBe(keyId);
      expect(body.files["SKILL.md"]).toBeDefined();
      return {
        status: 201,
        body: {
          proposal_id: "prop-cust-1",
          state: "pending",
          proposed_hash: editedHash,
          proposal_url: "/api/v1/skills/alice/foo/proposals/prop-cust-1",
          scan: { status: "pending" },
        },
      };
    });

    const result = await proposeCustomized("@alice/foo", [stubAdapter()], { configDir, fetchImpl: fetch });

    expect(result.status).toBe("proposed");
    if (result.status !== "proposed") throw new Error("unreachable");
    expect(result.ref).toBe("@alice/foo");
    expect(result.proposalId).toBe("prop-cust-1");
    expect(result.hash).toBe(editedHash);
    expect(calls).toHaveLength(1);

    // Proposing does NOT un-customize the skill — the edit stays live.
    const customized = await listCustomized();
    expect(customized.map((c) => c.slug)).toEqual(["@alice/foo"]);
  });

  it("403 → typed not_authorized result; the skill stays customized", async () => {
    const { proposeCustomized } = await import("../src/commands/propose.js");
    const { listCustomized } = await import("../src/commands/edits.js");
    await seedIdentityAndKey();
    await seedCustomized();

    const { fetch } = mockFetch(() => ({
      status: 403,
      body: { error: "not_authorized", message: "Only the owner or team may propose." },
    }));

    const result = await proposeCustomized("@alice/foo", [stubAdapter()], { configDir, fetchImpl: fetch });

    expect(result).toMatchObject({
      status: "not_authorized",
      ref: "@alice/foo",
      message: "Only the owner or team may propose.",
    });
    expect((await listCustomized()).map((c) => c.slug)).toEqual(["@alice/foo"]);
  });

  it("409 base_stale → typed base_stale result; the skill stays customized", async () => {
    const { proposeCustomized } = await import("../src/commands/propose.js");
    const { listCustomized } = await import("../src/commands/edits.js");
    await seedIdentityAndKey();
    await seedCustomized();

    const { fetch } = mockFetch(() => ({
      status: 409,
      body: {
        error: "base_stale",
        message: "Proposal base_hash no longer matches the skill's current latest_hash.",
      },
    }));

    const result = await proposeCustomized("@alice/foo", [stubAdapter()], { configDir, fetchImpl: fetch });

    expect(result).toMatchObject({ status: "base_stale", ref: "@alice/foo" });
    expect((await listCustomized()).map((c) => c.slug)).toEqual(["@alice/foo"]);
  });

  it("an uncustomized skill is refused before any network call", async () => {
    const { proposeCustomized } = await import("../src/commands/propose.js");
    await seedIdentityAndKey();
    await seedSkill("my-skill", CLEAN_SKILL); // plain local skill, no customized_from
    const { fetch, calls } = mockFetch(() => ({ status: 500, body: null }));

    await expect(
      proposeCustomized("my-skill", [stubAdapter()], { configDir, fetchImpl: fetch }),
    ).rejects.toMatchObject({ name: "ProposeError", code: "not_customized" });
    expect(calls).toHaveLength(0);
  });

  it("a local-only origin (author null) cannot be proposed — typed local_origin error", async () => {
    const { proposeCustomized } = await import("../src/commands/propose.js");
    await seedIdentityAndKey();
    await seedCustomized({
      customized_from: { author: null, slug: "local-foo", version: 1, hash: LINEAGE_BASE_HASH },
    });
    const { fetch, calls } = mockFetch(() => ({ status: 500, body: null }));

    await expect(
      proposeCustomized("@alice/foo", [stubAdapter()], { configDir, fetchImpl: fetch }),
    ).rejects.toMatchObject({ name: "ProposeError", code: "local_origin" });
    expect(calls).toHaveLength(0);
  });
});

describe("propose() self-handle default path (regression) and explicit target/base", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "skillet-propcust-home-"));
    configDir = await mkdtemp(join(tmpdir(), "skillet-propcust-cfg-"));
    process.env["SKILLET_DIR"] = root;
    delete process.env["SKILLET_TOKEN"];
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
    delete process.env["SKILLET_DIR"];
  });

  it("without target/base, propose() still fetches the SELF-handle manifest and posts to it", async () => {
    const { propose } = await import("../src/commands/propose.js");
    await seedIdentityAndKey();
    const contentHash = await seedSkill("my-skill", CLEAN_SKILL);

    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return { status: 404, body: { error: "not_found" } };
      }
      const body = call.body as { base_hash: string | null };
      expect(body.base_hash).toBeNull();
      return {
        status: 201,
        body: {
          proposal_id: "prop-self-1",
          state: "pending",
          proposed_hash: contentHash,
          proposal_url: "/api/v1/skills/taylor/my-skill/proposals/prop-self-1",
          scan: { status: "pending" },
        },
      };
    });

    const result = await propose("my-skill", { configDir, fetchImpl: fetch });

    expect(result.proposalId).toBe("prop-self-1");
    expect(calls.map((c) => c.url)).toEqual([
      "https://r.test/api/v1/skills/taylor/my-skill/manifest",
      "https://r.test/api/v1/skills/taylor/my-skill/proposals",
    ]);
  });

  it("with target + base, propose() posts to the target and skips the manifest fetch", async () => {
    const { propose } = await import("../src/commands/propose.js");
    await seedIdentityAndKey();
    await seedSkill("my-skill", CLEAN_SKILL);
    const baseHash = `sha256:${"b".repeat(64)}`;

    const { fetch, calls } = mockFetch((call) => {
      expect(call.url).toBe("https://r.test/api/v1/skills/alice/foo/proposals");
      const body = call.body as { base_hash: string | null };
      expect(body.base_hash).toBe(baseHash);
      return {
        status: 201,
        body: {
          proposal_id: "prop-target-1",
          state: "pending",
          proposed_hash: "sha256:whatever",
          proposal_url: "/api/v1/skills/alice/foo/proposals/prop-target-1",
          scan: { status: "pending" },
        },
      };
    });

    const result = await propose("my-skill", {
      configDir,
      fetchImpl: fetch,
      target: { author: "alice", slug: "foo" },
      base: { version: 3, hash: baseHash },
    });

    expect(result.proposalId).toBe("prop-target-1");
    expect(calls).toHaveLength(1);
  });

  it("403 on propose() maps to a typed not_authorized ProposeError, not a raw throw", async () => {
    const { propose } = await import("../src/commands/propose.js");
    await seedIdentityAndKey();
    await seedSkill("my-skill", CLEAN_SKILL);

    const { fetch } = mockFetch((call) => {
      if (call.url.endsWith("/manifest")) {
        return { status: 404, body: { error: "not_found" } };
      }
      return {
        status: 403,
        body: { error: "not_authorized", message: "Only the owner or team may propose." },
      };
    });

    await expect(propose("my-skill", { configDir, fetchImpl: fetch })).rejects.toMatchObject({
      name: "ProposeError",
      code: "not_authorized",
      message: "Only the owner or team may propose.",
    });
  });
});
