/**
 * uploadLocalSkills — publish-only upload to the profile kit.
 *
 * Selection modes (omitted → local-unpublished expansion; explicit slugs →
 * resolve bare + promoted keys, forward to publish), visibility pass-through,
 * no kit endpoints, partial-failure aggregation, auth gate, idempotency.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalContentHash } from "@skillet/protocol";

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

const SKILL_BODY = (name: string) => `---
name: ${name}
description: A test skill.
---

# ${name}

Does something useful.
`;

async function seedLocalSkill(slug: string): Promise<string> {
  const { upsertSkill, skillContentDir, skillContentPath } = await import("../src/kit/store.js");
  const content = SKILL_BODY(slug);
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

/** A skill that already published and was re-keyed by sync to @owner/slug. */
async function seedPromotedSkill(owner: string, bare: string): Promise<string> {
  const { upsertSkill, skillContentDir, skillContentPath } = await import("../src/kit/store.js");
  const key = `@${owner}/${bare}`;
  const content = SKILL_BODY(bare);
  await mkdir(skillContentDir(key), { recursive: true });
  await writeFile(skillContentPath(key), content, "utf8");
  const bundle = new Map([["SKILL.md", Buffer.from(content, "utf8")]]);
  const hash = canonicalContentHash(bundle);
  await upsertSkill({
    slug: key,
    name: bare,
    description: "",
    version: 1,
    hash,
    source: "registry",
    owner,
    importedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  return hash;
}

async function seedSessionToken(token: string): Promise<void> {
  const { sessionFilePath } = await import("../src/session-token.js");
  await writeFile(sessionFilePath(), JSON.stringify({ session_token: token }), "utf8");
}

/** Registry mock: whoami as taylor, no prior manifest, publish 201. */
function registryResponder(call: MockCall): { status: number; body: unknown } {
  if (call.url.includes("/whoami")) {
    return { status: 200, body: { handle: "taylor", author_key_id: null } };
  }
  if (call.url.endsWith("/manifest")) {
    return { status: 404, body: { error: "not_found" } };
  }
  if (call.url.endsWith("/skills") && call.method === "POST") {
    const body = call.body as { slug: string };
    return {
      status: 201,
      body: {
        hash: "sha256:deadbeef",
        skill_id: `taylor:${body.slug}`,
        version_url: `/api/v1/skills/taylor/${body.slug}/versions/sha256:deadbeef`,
        already_exists: false,
      },
    };
  }
  return { status: 500, body: { error: `unexpected ${call.method} ${call.url}` } };
}

const publishPosts = (calls: MockCall[]): MockCall[] =>
  calls.filter((c) => c.method === "POST" && c.url.endsWith("/skills"));

describe("uploadLocalSkills", () => {
  let skilletDir: string;

  beforeEach(async () => {
    skilletDir = await mkdtemp(join(tmpdir(), "skillet-upload-"));
    process.env["SKILLET_DIR"] = skilletDir;
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(skilletDir, { recursive: true, force: true });
    delete process.env["SKILLET_DIR"];
  });

  it("publishes exactly the selected slugs; others untouched (AE1)", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    const { readState } = await import("../src/kit/store.js");
    for (const s of ["alpha", "bravo", "charlie", "delta", "echo"]) await seedLocalSkill(s);
    await seedSessionToken("skillet_s_tok");
    const { fetch, calls } = mockFetch(registryResponder);

    const res = await uploadLocalSkills({
      slugs: ["alpha", "bravo"],
      registryUrl: "https://r.test",
      fetchImpl: fetch,
    });

    expect(res.ok).toBe(true);
    expect(res.owner).toBe("taylor");
    expect(res.published.map((p) => p.slug).sort()).toEqual(["alpha", "bravo"]);
    expect(publishPosts(calls)).toHaveLength(2);
    const state = await readState();
    expect(state.skills["charlie"]!.source).toBe("local");
    expect(state.skills["alpha"]!.source).toBe("registry");
  });

  it("forwards an explicitly named promoted skill so a visibility flip POSTs (AE2)", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedPromotedSkill("taylor", "flippy");
    await seedSessionToken("skillet_s_tok");
    const { fetch, calls } = mockFetch((call) => {
      if (call.url.includes("/whoami")) {
        return { status: 200, body: { handle: "taylor", author_key_id: null } };
      }
      if (call.url.endsWith("/manifest")) {
        return { status: 200, body: { latest_hash: "sha256:mismatch-forces-post" } };
      }
      return registryResponder(call);
    });

    const res = await uploadLocalSkills({
      slugs: ["flippy"],
      visibility: "public",
      registryUrl: "https://r.test",
      fetchImpl: fetch,
    });

    expect(res.ok).toBe(true);
    const posts = publishPosts(calls);
    expect(posts).toHaveLength(1);
    expect((posts[0]!.body as { slug: string; visibility: string }).slug).toBe("flippy");
    expect((posts[0]!.body as { visibility: string }).visibility).toBe("public");
  });

  it("visibility defaults to private and passes through when public", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedLocalSkill("quiet");
    await seedSessionToken("skillet_s_tok");
    const { fetch, calls } = mockFetch(registryResponder);

    await uploadLocalSkills({ slugs: ["quiet"], registryUrl: "https://r.test", fetchImpl: fetch });
    expect((publishPosts(calls)[0]!.body as { visibility: string }).visibility).toBe("private");
  });

  // Registry verdict responders (U4): the registry is the single scan authority.
  // `flagged` publishes with non-blocking findings; `scan_blocked` refuses.
  const flaggedResponder = (call: MockCall): { status: number; body: unknown } => {
    if (call.url.includes("/whoami")) return { status: 200, body: { handle: "taylor", author_key_id: null } };
    if (call.url.endsWith("/manifest")) return { status: 404, body: { error: "not_found" } };
    if (call.url.endsWith("/skills") && call.method === "POST") {
      const body = call.body as { slug: string };
      return {
        status: 201,
        body: {
          hash: "sha256:deadbeef",
          skill_id: `taylor:${body.slug}`,
          version_url: `/api/v1/skills/taylor/${body.slug}/versions/sha256:deadbeef`,
          already_exists: false,
          scan: {
            status: "flagged",
            findings: [
              { category: "obfuscation", confidence: "medium", file: "SKILL.md", lineStart: 6, lineEnd: 6, why: "base64" },
            ],
          },
        },
      };
    }
    return { status: 500, body: { error: `unexpected ${call.method} ${call.url}` } };
  };
  const blockedResponder = (call: MockCall): { status: number; body: unknown } => {
    if (call.url.includes("/whoami")) return { status: 200, body: { handle: "taylor", author_key_id: null } };
    if (call.url.endsWith("/manifest")) return { status: 404, body: { error: "not_found" } };
    if (call.url.endsWith("/skills") && call.method === "POST") {
      return {
        status: 422,
        body: {
          error: "scan_blocked",
          reason: "secret",
          status: "quarantined",
          message: "Publish blocked: a credential was detected.",
          findings: [
            { category: "github-pat", confidence: "high", file: "SKILL.md", lineStart: 3, lineEnd: 3, why: "token" },
          ],
        },
      };
    }
    return { status: 500, body: { error: `unexpected ${call.method} ${call.url}` } };
  };

  it("a registry `flagged` verdict records non-blocking warnings and still POSTs (U4/R3)", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedLocalSkill("noisy");
    await seedSessionToken("skillet_s_tok");
    const { fetch, calls } = mockFetch(flaggedResponder);

    const res = await uploadLocalSkills({ slugs: ["noisy"], registryUrl: "https://r.test", fetchImpl: fetch });
    expect(res.ok).toBe(true);
    expect(res.warnings?.[0]?.slug).toBe("noisy");
    const finding = res.warnings![0]!.findings[0]!;
    // Flattened from the registry wire shape: lineStart → line.
    expect(finding).toMatchObject({ file: "SKILL.md", line: 6, category: "obfuscation" });
    expect(publishPosts(calls).length).toBe(1);
  });

  it("a registry `scan_blocked` refusal carries error string + structured findings on failed[] (U4/R3/R5)", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedLocalSkill("leaky");
    await seedSessionToken("skillet_s_tok");
    const { fetch } = mockFetch(blockedResponder);

    const res = await uploadLocalSkills({
      slugs: ["leaky"],
      visibility: "public",
      registryUrl: "https://r.test",
      fetchImpl: fetch,
    });
    expect(res.ok).toBe(false);
    expect(res.failed[0]!.slug).toBe("leaky");
    expect(typeof res.failed[0]!.error).toBe("string");
    expect(res.failed[0]!.findings![0]).toMatchObject({ file: "SKILL.md", line: 3, category: "github-pat" });
  });

  it("upload envelope round-trips findings; a clean upload has no warnings/findings key (U2/KTD5)", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedLocalSkill("noisy");
    await seedLocalSkill("clean");
    await seedSessionToken("skillet_s_tok");

    const flagged = mockFetch(flaggedResponder);
    const flaggedRes = await uploadLocalSkills({ slugs: ["noisy"], registryUrl: "https://r.test", fetchImpl: flagged.fetch });
    const roundTripped = JSON.parse(JSON.stringify(flaggedRes));
    expect(roundTripped.warnings[0].findings[0].category).toBe("obfuscation");

    const clean = mockFetch(registryResponder);
    const cleanRes = await uploadLocalSkills({ slugs: ["clean"], registryUrl: "https://r.test", fetchImpl: clean.fetch });
    expect("warnings" in cleanRes).toBe(false);
    const serialized = JSON.stringify(cleanRes);
    expect(serialized.includes("warnings")).toBe(false);
    expect(serialized.includes("findings")).toBe(false);
  });

  it("drops unknown slugs; someone else's promoted skill fails, not publishes", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedLocalSkill("mine");
    await seedPromotedSkill("vercel", "deploy-to-vercel");
    await seedSessionToken("skillet_s_tok");
    const { fetch, calls } = mockFetch(registryResponder);

    const res = await uploadLocalSkills({
      slugs: ["mine", "ghost-slug", "@vercel/deploy-to-vercel"],
      registryUrl: "https://r.test",
      fetchImpl: fetch,
    });

    // Unknown slug silently dropped; foreign promoted entry surfaces as failed.
    expect(res.published.map((p) => p.slug)).toEqual(["mine"]);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]!.slug).toBe("@vercel/deploy-to-vercel");
    expect(res.failed[0]!.error).toMatch(/own skills/i);
    // Only "mine" reached the registry as a publish POST.
    expect(publishPosts(calls)).toHaveLength(1);
  });

  it("omitted slugs expand to local-unpublished only; no kit endpoints are called", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedLocalSkill("one");
    await seedLocalSkill("two");
    await seedPromotedSkill("taylor", "already-up");
    await seedSessionToken("skillet_s_tok");
    const { fetch, calls } = mockFetch(registryResponder);

    const res = await uploadLocalSkills({ registryUrl: "https://r.test", fetchImpl: fetch });

    expect(res.published.map((p) => p.slug).sort()).toEqual(["one", "two"]);
    expect(calls.some((c) => c.url.includes("/kits"))).toBe(false);
  });

  it("returns empty when nothing resolves", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedSessionToken("skillet_s_tok");
    const { fetch, calls } = mockFetch(registryResponder);

    const res = await uploadLocalSkills({
      slugs: ["nope"],
      registryUrl: "https://r.test",
      fetchImpl: fetch,
    });
    expect(res).toMatchObject({ ok: false, empty: true, published: [], failed: [] });
    expect(calls).toHaveLength(0);
  });

  it("no token → every publish fails, nothing POSTs", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedLocalSkill("lonely");
    const { fetch, calls } = mockFetch(registryResponder);

    const res = await uploadLocalSkills({
      slugs: ["lonely"],
      registryUrl: "https://r.test",
      fetchImpl: fetch,
    });
    expect(res.ok).toBe(false);
    expect(res.failed[0]!.slug).toBe("lonely");
    expect(publishPosts(calls)).toHaveLength(0);
  });

  it("partial failure: first 500s, second succeeds → ok with failed entry", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedLocalSkill("bad");
    await seedLocalSkill("good");
    await seedSessionToken("skillet_s_tok");
    const { fetch } = mockFetch((call) => {
      if (call.method === "POST" && call.url.endsWith("/skills")) {
        const slug = (call.body as { slug: string }).slug;
        if (slug === "bad") return { status: 500, body: { error: "boom" } };
      }
      return registryResponder(call);
    });

    const res = await uploadLocalSkills({
      slugs: ["bad", "good"],
      registryUrl: "https://r.test",
      fetchImpl: fetch,
    });
    expect(res.ok).toBe(true);
    expect(res.published.map((p) => p.slug)).toEqual(["good"]);
    expect(res.failed.map((f) => f.slug)).toEqual(["bad"]);
  });

  it("onProgress fires start, done, and fail in selection order", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedLocalSkill("bad");
    await seedLocalSkill("good");
    await seedSessionToken("skillet_s_tok");
    const { fetch } = mockFetch((call) => {
      if (call.method === "POST" && call.url.endsWith("/skills")) {
        const slug = (call.body as { slug: string }).slug;
        if (slug === "bad") return { status: 500, body: { error: "boom" } };
      }
      return registryResponder(call);
    });

    const events: import("../src/commands/upload-skills.js").UploadProgressEvent[] = [];
    await uploadLocalSkills({
      slugs: ["bad", "good"],
      registryUrl: "https://r.test",
      fetchImpl: fetch,
      onProgress: (e) => events.push(e),
    });

    expect(events.map((e) => e.phase)).toEqual(["start", "fail", "start", "done"]);
    expect(events[0]).toMatchObject({ phase: "start", slug: "bad", index: 0, total: 2 });
    expect(events[1]).toMatchObject({ phase: "fail", slug: "bad" });
    expect(events[3]).toMatchObject({ phase: "done", slug: "good", owner: "taylor" });
  });

  it("omits onProgress when callback not provided (regression)", async () => {
    const { uploadLocalSkills } = await import("../src/commands/upload-skills.js");
    await seedLocalSkill("solo");
    await seedSessionToken("skillet_s_tok");
    const { fetch } = mockFetch(registryResponder);

    await expect(
      uploadLocalSkills({ slugs: ["solo"], registryUrl: "https://r.test", fetchImpl: fetch }),
    ).resolves.toMatchObject({ ok: true });
  });
});
