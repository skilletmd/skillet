/**
 * Contract tests for the Skillet MCP server transport.
 *
 * Covers:
 *   - list_skills / get_skill / search_skills correctness
 *   - Auth enforcement: no token → empty result (fail-closed);
 *     valid token prefix → all skills visible
 *   - version_hash in responses matches the hash stored in kit state
 *   - Path-escape rejection on resource URIs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";

// ── Isolate the canonical store from the real ~/.skillet ────────────────────────
// Override SKILLET_DIR before any module under test loads it.

let tmpSkilletDir: string;

vi.mock("@skillet/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skillet/core")>();
  return {
    ...actual,
    get SKILLET_DIR() {
      return tmpSkilletDir;
    },
    readState: async () => {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      try {
        const raw = await readFile(join(tmpSkilletDir, "state.json"), "utf8");
        return JSON.parse(raw);
      } catch {
        return { version: 1, skills: {} };
      }
    },
    skillContentDir: (slug: string) => {
      return join(tmpSkilletDir, "skills", slug);
    },
  };
});

import { handleMessage } from "../src/server.js";
import { isValidToken, tokenFromHeader, visibleSkills, LOOPBACK_HOSTS, createRegistryValidator } from "../src/auth.js";
import { startHttpTransport, readBody, BodyTooLargeError, MAX_BODY_BYTES } from "../src/transport/http.js";
import { buildUri, parseUri } from "../src/resources.js";
import type { SkillSource } from "../src/store.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function writeState(skills: object): Promise<void> {
  await mkdir(tmpSkilletDir, { recursive: true });
  await writeFile(
    join(tmpSkilletDir, "state.json"),
    JSON.stringify({ version: 1, skills }),
  );
}

async function writeSkillFile(slug: string, path: string, content: string): Promise<void> {
  const dir = join(tmpSkilletDir, "skills", slug, ...path.split("/").slice(0, -1));
  await mkdir(dir, { recursive: true });
  await writeFile(join(tmpSkilletDir, "skills", slug, ...path.split("/")), content);
}

function req(id: number, method: string, params?: unknown) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

const VALID_TOKEN = "skillet_k_testtoken";
const VALID_HASH = "sha256:" + "a".repeat(64);

// ── Kit fixture ───────────────────────────────────────────────────────────────

const LOCAL_SKILL = {
  slug: "my-local-skill",
  name: "My Local Skill",
  description: "A locally imported skill",
  version: 1,
  hash: VALID_HASH,
  source: "local" as const,
  owner: null,
  importedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const REGISTRY_SKILL = {
  slug: "registry-skill",
  name: "Registry Skill",
  description: "A skill from the registry",
  version: 2,
  versionLabel: "2.1.0",
  hash: "sha256:" + "b".repeat(64),
  source: "registry" as const,
  owner: "taylor",
  importedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// Registry skills are keyed by their canonical `@owner/slug` in state — the
// exact string list_skills/search_skills return. get_skill must accept it
// verbatim (the `@` owner sigil once broke the slug-safety validator).
const OWNER_QUALIFIED_SKILL = {
  slug: "@taylor/owned-skill",
  name: "Owned Skill",
  description: "An owner-qualified registry skill",
  version: 1,
  versionLabel: "1.0.0",
  hash: "sha256:" + "c".repeat(64),
  source: "registry" as const,
  owner: "taylor",
  importedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(async () => {
  tmpSkilletDir = join(tmpdir(), `skillet-mcp-test-${randomBytes(4).toString("hex")}`);
  await mkdir(tmpSkilletDir, { recursive: true });

  await writeState({
    [LOCAL_SKILL.slug]: LOCAL_SKILL,
    [REGISTRY_SKILL.slug]: REGISTRY_SKILL,
    [OWNER_QUALIFIED_SKILL.slug]: OWNER_QUALIFIED_SKILL,
  });

  await writeSkillFile(
    LOCAL_SKILL.slug,
    "SKILL.md",
    "---\nname: My Local Skill\n---\n\nLocal skill content.",
  );
  await writeSkillFile(
    LOCAL_SKILL.slug,
    "references/guide.md",
    "# Guide\nReference material.",
  );
  await writeSkillFile(
    REGISTRY_SKILL.slug,
    "SKILL.md",
    "---\nname: Registry Skill\n---\n\nRegistry content.",
  );
  await writeSkillFile(
    OWNER_QUALIFIED_SKILL.slug,
    "SKILL.md",
    "---\nname: Owned Skill\n---\n\nOwned content.",
  );
});

afterEach(async () => {
  await rm(tmpSkilletDir, { recursive: true, force: true });
});

// ── initialize ────────────────────────────────────────────────────────────────

describe("initialize", () => {
  it("returns server info and capabilities", async () => {
    const res = await handleMessage(req(1, "initialize", { protocolVersion: "2025-03-26" }));
    expect(res).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "skillet-mcp" },
        capabilities: { tools: expect.anything(), resources: expect.anything() },
      },
    });
  });

  it("echoes the client's protocol version when it is one we support", async () => {
    const res = await handleMessage(req(1, "initialize", { protocolVersion: "2025-06-18" }));
    expect((res as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      "2025-06-18",
    );
  });

  it("falls back to our latest version for an unsupported (e.g. stateless RC) request", async () => {
    const res = await handleMessage(req(1, "initialize", { protocolVersion: "2026-07-28" }));
    // Not in SUPPORTED_PROTOCOL_VERSIONS → we answer with our latest and let the
    // client decide whether to proceed.
    expect((res as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      "2025-11-25",
    );
  });

  it("uses our latest version when the client omits one", async () => {
    const res = await handleMessage(req(1, "initialize", {}));
    expect((res as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      "2025-11-25",
    );
  });
});

// ── tools/list ────────────────────────────────────────────────────────────────

describe("tools/list", () => {
  it("returns the three fixed declarative tools", async () => {
    const res = await handleMessage(req(2, "tools/list"));
    expect(res).toMatchObject({ result: { tools: expect.any(Array) } });
    const tools = (res as { result: { tools: Array<{ name: string }> } }).result.tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_skill", "list_skills", "search_skills"]);
  });

  it("tools have inputSchema with type 'object'", async () => {
    const res = await handleMessage(req(2, "tools/list"));
    const tools = (res as { result: { tools: Array<{ inputSchema: { type: string } }> } }).result.tools;
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("every tool declares an outputSchema of type 'object' (2025-06-18)", async () => {
    const res = await handleMessage(req(2, "tools/list"));
    const tools = (res as { result: { tools: Array<{ outputSchema?: { type: string } }> } })
      .result.tools;
    for (const tool of tools) {
      expect(tool.outputSchema?.type).toBe("object");
    }
  });

  it("every tool is annotated read-only so clients don't gate calls as destructive", async () => {
    const res = await handleMessage(req(2, "tools/list"));
    const tools = (
      res as {
        result: { tools: Array<{ annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }> }
      }
    ).result.tools;
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
  });
});

// ── list_skills ───────────────────────────────────────────────────────────────

describe("list_skills", () => {
  it("with valid token: returns all skills in the kit", async () => {
    const res = await handleMessage(req(3, "tools/call", {
      name: "list_skills",
      arguments: {},
    }), { token: VALID_TOKEN });
    expect(res).toMatchObject({ result: { content: [{ type: "text" }] } });
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const manifest = JSON.parse(text) as Array<{ slug: string }>;
    const slugs = manifest.map((s) => s.slug).sort();
    expect(slugs).toContain(LOCAL_SKILL.slug);
    expect(slugs).toContain(REGISTRY_SKILL.slug);
  });

  it("without token: no skills are visible (fail-closed)", async () => {
    const res = await handleMessage(req(3, "tools/call", {
      name: "list_skills",
      arguments: {},
    }));
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const manifest = JSON.parse(text) as Array<{ slug: string }>;
    expect(manifest).toHaveLength(0);
  });

  it("manifest entries include version_hash matching the stored hash", async () => {
    const res = await handleMessage(req(3, "tools/call", {
      name: "list_skills",
      arguments: {},
    }), { token: VALID_TOKEN });
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const manifest = JSON.parse(text) as Array<{ slug: string; version_hash: string }>;
    const local = manifest.find((s) => s.slug === LOCAL_SKILL.slug);
    expect(local?.version_hash).toBe(LOCAL_SKILL.hash);
    const reg = manifest.find((s) => s.slug === REGISTRY_SKILL.slug);
    expect(reg?.version_hash).toBe(REGISTRY_SKILL.hash);
  });

  it("manifest entries include version_label: the label string when present, null when absent", async () => {
    const res = await handleMessage(req(3, "tools/call", {
      name: "list_skills",
      arguments: {},
    }), { token: VALID_TOKEN });
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const manifest = JSON.parse(text) as Array<{ slug: string; version_label: string | null }>;
    const local = manifest.find((s) => s.slug === LOCAL_SKILL.slug);
    expect(local?.version_label).toBeNull();
    const reg = manifest.find((s) => s.slug === REGISTRY_SKILL.slug);
    expect(reg?.version_label).toBe(REGISTRY_SKILL.versionLabel);
  });

  it("returns structuredContent { skills } mirroring the text block (2025-06-18)", async () => {
    const res = await handleMessage(req(3, "tools/call", {
      name: "list_skills",
      arguments: {},
    }), { token: VALID_TOKEN });
    const result = (
      res as {
        result: { content: Array<{ text: string }>; structuredContent?: { skills?: unknown[] } };
      }
    ).result;
    // Structured payload is an object (spec requires object), wrapping the array.
    expect(Array.isArray(result.structuredContent?.skills)).toBe(true);
    // …and carries the same data the text block serializes.
    expect(result.structuredContent?.skills).toEqual(JSON.parse(result.content[0].text));
  });
});

// ── get_skill ─────────────────────────────────────────────────────────────────

describe("get_skill", () => {
  it("returns SKILL.md body and resource list for a visible skill (with token)", async () => {
    const res = await handleMessage(req(4, "tools/call", {
      name: "get_skill",
      arguments: { slug: LOCAL_SKILL.slug },
    }), { token: VALID_TOKEN });
    expect(res).toMatchObject({ result: { content: [{ type: "text" }] } });
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const detail = JSON.parse(text) as {
      slug: string;
      skill_md: string;
      resources: string[];
    };
    expect(detail.slug).toBe(LOCAL_SKILL.slug);
    expect(detail.skill_md).toContain("Local skill content.");
    expect(detail.resources).toEqual(
      expect.arrayContaining(["skillet://_local/my-local-skill/SKILL.md"]),
    );
  });

  it("resolves an owner-qualified @owner/slug returned by list_skills (with token)", async () => {
    const res = await handleMessage(req(4, "tools/call", {
      name: "get_skill",
      arguments: { slug: OWNER_QUALIFIED_SKILL.slug },
    }), { token: VALID_TOKEN });
    const result = (res as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
    expect(result.isError).toBeFalsy();
    const detail = JSON.parse(result.content[0].text) as { slug: string; skill_md: string };
    expect(detail.slug).toBe(OWNER_QUALIFIED_SKILL.slug);
    expect(detail.skill_md).toContain("Owned content.");
  });

  it("still rejects a path-traversal slug (with token)", async () => {
    const res = await handleMessage(req(4, "tools/call", {
      name: "get_skill",
      arguments: { slug: "../../etc/passwd" },
    }), { token: VALID_TOKEN });
    // Traversal is rejected before lookup — a JSON-RPC error, not tool content.
    expect((res as { error?: { message: string } }).error?.message ?? "").toMatch(/unsafe skill slug/i);
  });

  it("returns error content for a skill not in the visible set (no token)", async () => {
    // No token → nothing is visible (fail-closed), including local skills
    const res = await handleMessage(req(4, "tools/call", {
      name: "get_skill",
      arguments: { slug: LOCAL_SKILL.slug },
    }));
    const result = (res as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found/i);
  });

  it("version_hash in result matches the stored hash (with token)", async () => {
    const res = await handleMessage(req(4, "tools/call", {
      name: "get_skill",
      arguments: { slug: LOCAL_SKILL.slug },
    }), { token: VALID_TOKEN });
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const detail = JSON.parse(text) as { version_hash: string };
    expect(detail.version_hash).toBe(LOCAL_SKILL.hash);
  });

  it("returns structuredContent equal to the parsed text block (2025-06-18)", async () => {
    const res = await handleMessage(req(4, "tools/call", {
      name: "get_skill",
      arguments: { slug: LOCAL_SKILL.slug },
    }), { token: VALID_TOKEN });
    const result = (
      res as { result: { content: Array<{ text: string }>; structuredContent?: unknown } }
    ).result;
    expect(result.structuredContent).toEqual(JSON.parse(result.content[0].text));
  });

  it("version_label is null for a skill with no versionLabel (with token)", async () => {
    const res = await handleMessage(req(4, "tools/call", {
      name: "get_skill",
      arguments: { slug: LOCAL_SKILL.slug },
    }), { token: VALID_TOKEN });
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const detail = JSON.parse(text) as { version_label: string | null };
    expect(detail.version_label).toBeNull();
  });

  it("version_label is the label string for a skill with versionLabel set (with token)", async () => {
    const res = await handleMessage(req(4, "tools/call", {
      name: "get_skill",
      arguments: { slug: REGISTRY_SKILL.slug },
    }), { token: VALID_TOKEN });
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const detail = JSON.parse(text) as { version_label: string | null };
    expect(detail.version_label).toBe(REGISTRY_SKILL.versionLabel);
  });
});

// ── search_skills ─────────────────────────────────────────────────────────────

describe("search_skills", () => {
  it("returns matching skills by keyword (with token)", async () => {
    const res = await handleMessage(req(5, "tools/call", {
      name: "search_skills",
      arguments: { query: "local" },
    }), { token: VALID_TOKEN });
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const results = JSON.parse(text) as Array<{ slug: string }>;
    expect(results.some((s) => s.slug === LOCAL_SKILL.slug)).toBe(true);
  });

  it("without token: search returns empty (fail-closed, no skills visible)", async () => {
    const res = await handleMessage(req(5, "tools/call", {
      name: "search_skills",
      arguments: { query: "local" },
    }));
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const results = JSON.parse(text) as Array<{ slug: string }>;
    expect(results).toHaveLength(0);
  });

  it("with token: search sees all skills", async () => {
    const res = await handleMessage(req(5, "tools/call", {
      name: "search_skills",
      arguments: { query: "registry" },
    }), { token: VALID_TOKEN });
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const results = JSON.parse(text) as Array<{ slug: string }>;
    expect(results.some((s) => s.slug === REGISTRY_SKILL.slug)).toBe(true);
  });
});

// ── resources/list ────────────────────────────────────────────────────────────

describe("resources/list", () => {
  it("without token: lists no resources (fail-closed)", async () => {
    const res = await handleMessage(req(6, "resources/list"));
    const resources = (res as { result: { resources: Array<{ uri: string }> } }).result.resources;
    expect(resources).toHaveLength(0);
  });

  it("with token: lists all skill resources", async () => {
    const res = await handleMessage(req(6, "resources/list"), { token: VALID_TOKEN });
    const resources = (res as { result: { resources: Array<{ uri: string }> } }).result.resources;
    const uris = resources.map((r) => r.uri);
    expect(uris.some((u) => u.includes(REGISTRY_SKILL.slug))).toBe(true);
  });

  it("resource URIs use the skillet:// scheme", async () => {
    const res = await handleMessage(req(6, "resources/list"), { token: VALID_TOKEN });
    const resources = (res as { result: { resources: Array<{ uri: string }> } }).result.resources;
    for (const r of resources) {
      expect(r.uri.startsWith("skillet://")).toBe(true);
    }
  });
});

// ── resources/read ────────────────────────────────────────────────────────────

describe("resources/read", () => {
  it("reads a visible skill file (with token)", async () => {
    const uri = buildUri(null, LOCAL_SKILL.slug, "SKILL.md");
    const res = await handleMessage(req(7, "resources/read", { uri }), { token: VALID_TOKEN });
    const contents = (res as { result: { contents: Array<{ uri: string; text?: string }> } }).result.contents;
    expect(contents[0].uri).toBe(uri);
    expect(contents[0].text).toContain("Local skill content.");
  });

  it("returns error for a non-existent resource (with token)", async () => {
    const res = await handleMessage(req(7, "resources/read", { uri: "skillet://_local/my-local-skill/nonexistent.md" }), { token: VALID_TOKEN });
    expect("error" in (res as object)).toBe(true);
  });

  it("returns error for an invisible registry skill resource (no token)", async () => {
    const uri = buildUri(REGISTRY_SKILL.owner, REGISTRY_SKILL.slug, "SKILL.md");
    const res = await handleMessage(req(7, "resources/read", { uri }));
    expect("error" in (res as object)).toBe(true);
  });

  it("reads a registry skill resource with a valid token", async () => {
    const uri = buildUri(REGISTRY_SKILL.owner, REGISTRY_SKILL.slug, "SKILL.md");
    const res = await handleMessage(req(7, "resources/read", { uri }), { token: VALID_TOKEN });
    const contents = (res as { result: { contents: Array<{ text?: string }> } }).result.contents;
    expect(contents[0].text).toContain("Registry content.");
  });
});

// ── Path-escape rejection ─────────────────────────────────────────────────────

describe("path-escape rejection", () => {
  it("parseUri rejects path traversal in resource URI", () => {
    expect(() => parseUri("skillet://_local/my-skill/../../../etc/passwd")).toThrow();
  });

  it("parseUri rejects null-byte in URI", () => {
    expect(() => parseUri("skillet://_local/my-skill/SKILL\x00evil.md")).toThrow();
  });

  it("parseUri rejects absolute path in resource path segment", () => {
    expect(() => parseUri("skillet://_local/my-skill//etc/passwd")).toThrow();
  });

  it("resources/read with traversal URI returns error", async () => {
    const res = await handleMessage(req(8, "resources/read", {
      uri: "skillet://_local/my-local-skill/../../../etc/passwd",
    }));
    expect("error" in (res as object)).toBe(true);
  });
});

// ── Auth helpers ──────────────────────────────────────────────────────────────

describe("auth helpers", () => {
  it("isValidToken accepts skillet_k_ prefix", () => {
    expect(isValidToken("skillet_k_abc123")).toBe(true);
  });

  it("isValidToken accepts skillet_s_ prefix", () => {
    expect(isValidToken("skillet_s_abc123")).toBe(true);
  });

  it("isValidToken accepts skillet_d_ prefix", () => {
    expect(isValidToken("skillet_d_abc123")).toBe(true);
  });

  it("isValidToken rejects null", () => {
    expect(isValidToken(null)).toBe(false);
  });

  it("isValidToken rejects empty string", () => {
    expect(isValidToken("")).toBe(false);
  });

  it("isValidToken rejects unknown prefix", () => {
    expect(isValidToken("bearer_abc123")).toBe(false);
  });

  it("tokenFromHeader extracts token from Bearer header", () => {
    expect(tokenFromHeader("Bearer skillet_k_abc123")).toBe("skillet_k_abc123");
  });

  it("tokenFromHeader returns null for non-Bearer headers", () => {
    expect(tokenFromHeader("Basic dXNlcjpwYXNz")).toBe(null);
  });

  it("tokenFromHeader returns null for null input", () => {
    expect(tokenFromHeader(null)).toBe(null);
  });

  it("visibleSkills returns empty list without token (fail-closed)", () => {
    const skills = [LOCAL_SKILL, REGISTRY_SKILL];
    const visible = visibleSkills(skills, null);
    expect(visible).toHaveLength(0);
  });

  it("visibleSkills returns all skills with a valid token", () => {
    const skills = [LOCAL_SKILL, REGISTRY_SKILL];
    const visible = visibleSkills(skills, VALID_TOKEN);
    expect(visible).toHaveLength(2);
  });
});

// ── HTTP transport security (loopback + CORS) ─────────────────────────────────

describe("HTTP transport security", () => {
  it("LOOPBACK_HOSTS includes 127.0.0.1, ::1, and localhost", () => {
    expect(LOOPBACK_HOSTS.has("127.0.0.1")).toBe(true);
    expect(LOOPBACK_HOSTS.has("::1")).toBe(true);
    expect(LOOPBACK_HOSTS.has("localhost")).toBe(true);
  });

  it("startHttpTransport rejects a non-loopback host synchronously", async () => {
    await expect(startHttpTransport({ port: 9999, host: "0.0.0.0" })).rejects.toThrow(
      /loopback-only/i,
    );
  });

  it("startHttpTransport rejects a public IP synchronously", async () => {
    await expect(startHttpTransport({ port: 9999, host: "192.168.1.1" })).rejects.toThrow(
      /loopback-only/i,
    );
  });

  it("readBody aborts mid-stream once the byte cap is exceeded", async () => {
    const { EventEmitter } = await import("node:events");
    const fake = new EventEmitter() as EventEmitter & { destroy: () => void };
    let destroyed = false;
    fake.destroy = () => {
      destroyed = true;
    };
    const p = readBody(fake as unknown as Parameters<typeof readBody>[0], 1024);
    // Emit two 1 KB chunks — the second pushes past the 1 KB cap.
    fake.emit("data", Buffer.alloc(1024, 0x78));
    fake.emit("data", Buffer.alloc(1024, 0x78));
    await expect(p).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(destroyed).toBe(true);
  });

  it("readBody resolves a body under the cap", async () => {
    const { EventEmitter } = await import("node:events");
    const fake = new EventEmitter() as EventEmitter & { destroy: () => void };
    fake.destroy = () => {};
    const p = readBody(fake as unknown as Parameters<typeof readBody>[0], 1024);
    fake.emit("data", Buffer.from("hello"));
    fake.emit("end");
    expect(await p).toBe("hello");
  });

  it("MAX_BODY_BYTES is a sane finite cap", () => {
    expect(Number.isFinite(MAX_BODY_BYTES)).toBe(true);
    expect(MAX_BODY_BYTES).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});

// ── Unknown method ────────────────────────────────────────────────────────────

describe("unknown method", () => {
  it("returns method_not_found error", async () => {
    const res = await handleMessage(req(9, "nonexistent/method"));
    expect(res).toMatchObject({ error: { code: -32601 } });
  });
});

// ── Notification ──────────────────────────────────────────────────────────────

describe("notifications", () => {
  it("returns null for initialized notification (no response needed)", async () => {
    const notification = { jsonrpc: "2.0" as const, method: "notifications/initialized" };
    const res = await handleMessage(notification);
    expect(res).toBeNull();
  });
});

// ── createRegistryValidator ───────────────────────────────────────────────────

describe("createRegistryValidator", () => {
  function makeFetch(status: number): typeof fetch {
    return async () =>
      new Response(JSON.stringify({ skills: [] }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
  }

  it("returns true when registry responds 200", async () => {
    const validator = createRegistryValidator({
      registryUrl: "https://registry.example.com",
      fetchImpl: makeFetch(200),
    });
    expect(await validator.validate("skillet_k_abc")).toBe(true);
  });

  it("returns false when registry responds 401", async () => {
    const validator = createRegistryValidator({
      registryUrl: "https://registry.example.com",
      fetchImpl: makeFetch(401),
    });
    expect(await validator.validate("skillet_k_bad")).toBe(false);
  });

  it("returns false when registry responds 403", async () => {
    const validator = createRegistryValidator({
      registryUrl: "https://registry.example.com",
      fetchImpl: makeFetch(403),
    });
    expect(await validator.validate("skillet_k_denied")).toBe(false);
  });

  it("returns false when registry is unreachable (fail closed)", async () => {
    const validator = createRegistryValidator({
      registryUrl: "https://registry.example.com",
      fetchImpl: async () => { throw new Error("Network error"); },
    });
    expect(await validator.validate("skillet_k_abc")).toBe(false);
  });

  it("caches the validation result within TTL — registry called only once per token", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ skills: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const validator = createRegistryValidator({
      registryUrl: "https://registry.example.com",
      fetchImpl,
    });
    await validator.validate("skillet_k_abc");
    await validator.validate("skillet_k_abc");
    expect(calls).toBe(1);
  });

  it("re-validates after positive TTL expires (5 min)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ skills: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const validator = createRegistryValidator({
      registryUrl: "https://registry.example.com",
      fetchImpl,
    });
    await validator.validate("skillet_k_abc");
    expect(calls).toBe(1);
    // Advance past the 5-minute valid TTL
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await validator.validate("skillet_k_abc");
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it("re-validates after negative TTL expires (30 s) — transient outage recovers", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let shouldFail = true;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      if (shouldFail) throw new Error("registry down");
      return new Response(JSON.stringify({ skills: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const validator = createRegistryValidator({
      registryUrl: "https://registry.example.com",
      fetchImpl,
    });
    // First call fails — cached as invalid
    expect(await validator.validate("skillet_k_abc")).toBe(false);
    expect(calls).toBe(1);
    // Within 30 s: still cached false, no new registry call
    vi.advanceTimersByTime(15_000);
    expect(await validator.validate("skillet_k_abc")).toBe(false);
    expect(calls).toBe(1);
    // Registry recovers; advance past the 30-second negative TTL
    shouldFail = false;
    vi.advanceTimersByTime(16_000); // total 31s
    expect(await validator.validate("skillet_k_abc")).toBe(true);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });
});

// ── Hosted HTTP transport (registry-validated auth) ───────────────────────────

/**
 * Helper: spin up a hosted-mode HTTP server and return its base URL + stop fn.
 * The injected fetchImpl controls whether the registry accepts the token.
 */
async function startHostedServer(registryFetch: typeof fetch): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const first = await startHttpTransport({
    port: 0,
    host: "127.0.0.1",
    hosted: {
      registryUrl: "https://registry.example.com",
      allowedOrigins: ["https://chatgpt.com", "https://claude.ai"],
      fetchImpl: registryFetch,
    },
  });
  await first.stop();
  const port = 19870 + Math.floor(Math.random() * 100);
  const handle = await startHttpTransport({
    port,
    host: "127.0.0.1",
    hosted: {
      registryUrl: "https://registry.example.com",
      allowedOrigins: ["https://chatgpt.com", "https://claude.ai"],
      fetchImpl: registryFetch,
    },
  });
  return { baseUrl: `http://127.0.0.1:${port}`, stop: handle.stop };
}

function makeRegistryFetch(status: number): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ skills: [] }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

async function postMcp(
  baseUrl: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("hosted HTTP transport — registry-validated auth", () => {
  it("startHttpTransport with hosted option accepts non-loopback host (no throw)", async () => {
    const handle = await startHttpTransport({
      port: 19780,
      host: "127.0.0.1",
      hosted: {
        registryUrl: "https://registry.example.com",
        allowedOrigins: ["https://chatgpt.com"],
        fetchImpl: makeRegistryFetch(200),
      },
    });
    await handle.stop();
  });

  it("rejects non-loopback host WITHOUT hosted option (existing behaviour preserved)", async () => {
    await expect(startHttpTransport({ port: 9999, host: "0.0.0.0" })).rejects.toThrow(
      /loopback-only/i,
    );
  });

  it("valid token → 200 response from hosted server", async () => {
    const { baseUrl, stop } = await startHostedServer(makeRegistryFetch(200));
    try {
      const res = await postMcp(
        baseUrl,
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
        { Authorization: `Bearer ${VALID_TOKEN}`, Host: "127.0.0.1" },
      );
      expect(res.status).toBe(200);
    } finally {
      await stop();
    }
  });

  it("missing token → 401 from hosted server (fail closed)", async () => {
    const { baseUrl, stop } = await startHostedServer(makeRegistryFetch(200));
    try {
      const res = await postMcp(
        baseUrl,
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { Host: "127.0.0.1" },
      );
      expect(res.status).toBe(401);
    } finally {
      await stop();
    }
  });

  it("invalid token (registry rejects) → 401 from hosted server (fail closed)", async () => {
    const { baseUrl, stop } = await startHostedServer(makeRegistryFetch(401));
    try {
      const res = await postMcp(
        baseUrl,
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { Authorization: "Bearer skillet_k_badtoken", Host: "127.0.0.1" },
      );
      expect(res.status).toBe(401);
    } finally {
      await stop();
    }
  });

  it("registry unreachable → 401 from hosted server (fail closed)", async () => {
    const unreachableFetch: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const { baseUrl, stop } = await startHostedServer(unreachableFetch);
    try {
      const res = await postMcp(
        baseUrl,
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { Authorization: `Bearer ${VALID_TOKEN}`, Host: "127.0.0.1" },
      );
      expect(res.status).toBe(401);
    } finally {
      await stop();
    }
  });

  it("CORS reflects a configured hosted origin", async () => {
    const { baseUrl, stop } = await startHostedServer(makeRegistryFetch(200));
    try {
      const res = await postMcp(
        baseUrl,
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        {
          Authorization: `Bearer ${VALID_TOKEN}`,
          Host: "127.0.0.1",
          Origin: "https://chatgpt.com",
        },
      );
      expect(res.headers.get("access-control-allow-origin")).toBe("https://chatgpt.com");
    } finally {
      await stop();
    }
  });

  it("CORS does NOT reflect an unconfigured origin (no wildcard)", async () => {
    const { baseUrl, stop } = await startHostedServer(makeRegistryFetch(200));
    try {
      const res = await postMcp(
        baseUrl,
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        {
          Authorization: `Bearer ${VALID_TOKEN}`,
          Host: "127.0.0.1",
          Origin: "https://evil.example.com",
        },
      );
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await stop();
    }
  });

  it("Host header not in allowlist → 421 Misdirected Request", async () => {
    // fetch() treats Host as a forbidden header — use raw http.request to
    // override it and verify the DNS-rebinding guard fires.
    const { baseUrl, stop } = await startHostedServer(makeRegistryFetch(200));
    try {
      const url = new URL(`${baseUrl}/`);
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest({
          hostname: url.hostname,
          port: Number(url.port),
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            Authorization: `Bearer ${VALID_TOKEN}`,
            Host: "evil.attacker.com",
          },
        }, (res) => resolve(res.statusCode ?? 0));
        req.on("error", reject);
        req.write(body);
        req.end();
      });
      expect(status).toBe(421);
    } finally {
      await stop();
    }
  });

  // ── serverHosts: Host-header guard is the SERVER's own hostname, not CORS ──
  //
  // Helper: POST with an arbitrary Host header (fetch() forbids overriding Host,
  // so use raw http.request) and resolve the response status code.
  async function postWithHost(baseUrl: string, hostHeader: string): Promise<number> {
    const url = new URL(`${baseUrl}/`);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    return new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: url.hostname,
          port: Number(url.port),
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            Authorization: `Bearer ${VALID_TOKEN}`,
            Host: hostHeader,
          },
        },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  it("serverHosts: matching Host accepted, foreign Host rejected (Host != CORS origins)", async () => {
    const port = 19890 + Math.floor(Math.random() * 50);
    const handle = await startHttpTransport({
      port,
      host: "127.0.0.1",
      hosted: {
        registryUrl: "https://registry.example.com",
        // CORS clients are unrelated to the server's own hostname.
        allowedOrigins: ["https://chatgpt.com", "https://claude.ai"],
        serverHosts: ["mcp.example.com"],
        fetchImpl: makeRegistryFetch(200),
      },
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      // The server's configured public hostname is accepted.
      expect(await postWithHost(baseUrl, "mcp.example.com")).toBe(200);
      // A CORS client origin's hostname is NOT a valid Host (the bug being fixed).
      expect(await postWithHost(baseUrl, "chatgpt.com")).toBe(421);
      // An unrelated host is rejected.
      expect(await postWithHost(baseUrl, "evil.attacker.com")).toBe(421);
    } finally {
      await handle.stop();
    }
  });

  it("serverHosts: loopback Host still accepted in addition to serverHosts", async () => {
    const port = 19940 + Math.floor(Math.random() * 50);
    const handle = await startHttpTransport({
      port,
      host: "127.0.0.1",
      hosted: {
        registryUrl: "https://registry.example.com",
        allowedOrigins: ["https://chatgpt.com"],
        serverHosts: ["mcp.example.com"],
        fetchImpl: makeRegistryFetch(200),
      },
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      expect(await postWithHost(baseUrl, "127.0.0.1")).toBe(200);
    } finally {
      await handle.stop();
    }
  });

  it("back-compat: without serverHosts, Host falls back to allowedOrigins hostnames", async () => {
    const { baseUrl, stop } = await startHostedServer(makeRegistryFetch(200));
    try {
      // Legacy behavior: hostnames are derived from allowedOrigins.
      expect(await postWithHost(baseUrl, "chatgpt.com")).toBe(200);
      expect(await postWithHost(baseUrl, "claude.ai")).toBe(200);
      // Loopback still accepted; unrelated host still rejected.
      expect(await postWithHost(baseUrl, "127.0.0.1")).toBe(200);
      expect(await postWithHost(baseUrl, "evil.attacker.com")).toBe(421);
    } finally {
      await stop();
    }
  });
});

// ── Loopback HTTP transport (per-session token + registry validation) ─────────

describe("loopback HTTP transport", () => {
  it("rejects prefix-only skillet_s_ bearer when registry rejects", async () => {
    const port = 19700 + Math.floor(Math.random() * 50);
    const handle = await startHttpTransport({
      port,
      fetchImpl: makeRegistryFetch(401),
    });
    try {
      const res = await postMcp(
        `http://127.0.0.1:${port}`,
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { Authorization: "Bearer skillet_s_notreal", Host: "127.0.0.1" },
      );
      expect(res.status).toBe(401);
    } finally {
      await handle.stop();
    }
  });

  it("accepts the minted loopback secret bearer", async () => {
    const port = 19650 + Math.floor(Math.random() * 50);
    const handle = await startHttpTransport({ port });
    expect(handle.loopbackToken).toMatch(/^skillet_loop_/);
    try {
      const res = await postMcp(
        `http://127.0.0.1:${port}`,
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
        { Authorization: `Bearer ${handle.loopbackToken}`, Host: "127.0.0.1" },
      );
      expect(res.status).toBe(200);
    } finally {
      await handle.stop();
    }
  });
});

// ── Injectable skill source ───────────────────────────────────────────────────
//
// Every request here runs against a fake in-memory SkillSource while the
// on-disk store dir is wiped empty — any fallback to disk would return
// nothing, so passing results prove the injected source is the only source.

describe("injectable skill source", () => {
  const FAKE_SKILL = {
    slug: "fake-skill",
    name: "Fake Skill",
    description: "A skill that exists only in memory",
    version: 1,
    hash: "sha256:" + "c".repeat(64),
    source: "local" as const,
    owner: null,
    importedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const fakeFiles: Record<string, Record<string, string | Uint8Array>> = {
    [FAKE_SKILL.slug]: {
      "SKILL.md": "---\nname: Fake Skill\n---\n\nServed from memory.",
      // Uint8Array on purpose: sources may return raw bytes or strings.
      "references/notes.md": new TextEncoder().encode("# Notes\nByte-backed reference."),
    },
  };

  const fakeSource: SkillSource = {
    async listEntries() {
      return [FAKE_SKILL];
    },
    async listFiles(slug) {
      return Object.keys(fakeFiles[slug] ?? {}).sort();
    },
    async readFile(slug, path) {
      return fakeFiles[slug]?.[path] ?? null;
    },
  };

  beforeEach(async () => {
    // Empty the store dir the mocked @skillet/core points at: no state.json,
    // no skills/ — the default disk source would see nothing at all.
    await rm(tmpSkilletDir, { recursive: true, force: true });
    await mkdir(tmpSkilletDir, { recursive: true });
  });

  it("list_skills serves entries from the injected source, not disk", async () => {
    const res = await handleMessage(
      req(20, "tools/call", { name: "list_skills", arguments: {} }),
      { token: VALID_TOKEN, source: fakeSource },
    );
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const manifest = JSON.parse(text) as Array<{ slug: string; version_hash: string }>;
    expect(manifest).toHaveLength(1);
    expect(manifest[0].slug).toBe(FAKE_SKILL.slug);
    expect(manifest[0].version_hash).toBe(FAKE_SKILL.hash);
  });

  it("get_skill serves SKILL.md and resource list from the injected source", async () => {
    const res = await handleMessage(
      req(21, "tools/call", { name: "get_skill", arguments: { slug: FAKE_SKILL.slug } }),
      { token: VALID_TOKEN, source: fakeSource },
    );
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const detail = JSON.parse(text) as { skill_md: string; resources: string[] };
    expect(detail.skill_md).toContain("Served from memory.");
    expect(detail.resources).toEqual(
      expect.arrayContaining([
        "skillet://_local/fake-skill/SKILL.md",
        "skillet://_local/fake-skill/references/notes.md",
      ]),
    );
  });

  it("search_skills matches skills from the injected source", async () => {
    const res = await handleMessage(
      req(22, "tools/call", { name: "search_skills", arguments: { query: "memory" } }),
      { token: VALID_TOKEN, source: fakeSource },
    );
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const results = JSON.parse(text) as Array<{ slug: string }>;
    expect(results.some((s) => s.slug === FAKE_SKILL.slug)).toBe(true);
  });

  it("resources/list serves the injected source's files", async () => {
    const res = await handleMessage(req(23, "resources/list"), {
      token: VALID_TOKEN,
      source: fakeSource,
    });
    const resources = (res as { result: { resources: Array<{ uri: string }> } }).result.resources;
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual([
      "skillet://_local/fake-skill/SKILL.md",
      "skillet://_local/fake-skill/references/notes.md",
    ]);
  });

  it("resources/read serves string and Uint8Array data from the injected source", async () => {
    const mdRes = await handleMessage(
      req(24, "resources/read", { uri: buildUri(null, FAKE_SKILL.slug, "SKILL.md") }),
      { token: VALID_TOKEN, source: fakeSource },
    );
    const mdContents = (mdRes as { result: { contents: Array<{ text?: string }> } }).result.contents;
    expect(mdContents[0].text).toContain("Served from memory.");

    const refRes = await handleMessage(
      req(25, "resources/read", { uri: buildUri(null, FAKE_SKILL.slug, "references/notes.md") }),
      { token: VALID_TOKEN, source: fakeSource },
    );
    const refContents = (refRes as { result: { contents: Array<{ text?: string }> } }).result.contents;
    expect(refContents[0].text).toContain("Byte-backed reference.");
  });

  it("path traversal is rejected BEFORE the injected source is read", async () => {
    const readFileSpy = vi.fn(fakeSource.readFile);
    const spiedSource: SkillSource = { ...fakeSource, readFile: readFileSpy };
    const res = await handleMessage(
      req(26, "resources/read", { uri: "skillet://_local/fake-skill/../../../etc/passwd" }),
      { token: VALID_TOKEN, source: spiedSource },
    );
    expect("error" in (res as object)).toBe(true);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("without an injected source, the empty disk store yields no skills (default unchanged)", async () => {
    const res = await handleMessage(
      req(27, "tools/call", { name: "list_skills", arguments: {} }),
      { token: VALID_TOKEN },
    );
    const text = (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    expect(JSON.parse(text)).toHaveLength(0);
  });
});

// ── Deep-research alias tools (AE8 / R15) ─────────────────────────────────────
//
// With `deepResearchAliases: true`, the server advertises the ChatGPT
// deep-research `search`/`fetch` pair on top of the three core tools. With
// default options the surface is byte-identical to before (R15).

describe("deep-research alias tools", () => {
  const OWNED_SKILL = {
    slug: "deep-skill",
    name: "Deep Skill",
    description: "A skill for deep research",
    version: 3,
    versionLabel: "3.0.0",
    hash: "sha256:" + "d".repeat(64),
    source: "registry" as const,
    owner: "taylor",
    importedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const LOCAL_ONLY_SKILL = {
    slug: "mem-local",
    name: "Mem Local",
    description: "An ownerless local skill",
    version: 1,
    hash: "sha256:" + "e".repeat(64),
    source: "local" as const,
    owner: null,
    importedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const SKILL_MD_BODY = "---\nname: Deep Skill\n---\n\nDeep research body content.";

  const drFiles: Record<string, Record<string, string>> = {
    [OWNED_SKILL.slug]: { "SKILL.md": SKILL_MD_BODY },
    [LOCAL_ONLY_SKILL.slug]: { "SKILL.md": "---\nname: Mem Local\n---\n\nLocal body." },
  };

  const drSource: SkillSource = {
    async listEntries() {
      return [OWNED_SKILL, LOCAL_ONLY_SKILL];
    },
    async listFiles(slug) {
      return Object.keys(drFiles[slug] ?? {}).sort();
    },
    async readFile(slug, path) {
      return drFiles[slug]?.[path] ?? null;
    },
  };

  const drOpts = { token: VALID_TOKEN, source: drSource, deepResearchAliases: true };

  function resultText(res: unknown): string {
    return (res as { result: { content: Array<{ text: string }> } }).result.content[0].text;
  }

  it("AE8: tools/list with the flag returns five tools (three core + search/fetch)", async () => {
    const res = await handleMessage(req(30, "tools/list"), drOpts);
    const tools = (res as { result: { tools: Array<{ name: string }> } }).result.tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["fetch", "get_skill", "list_skills", "search", "search_skills"]);
  });

  it("AE8: search returns { results: [{ id, title, url }] }", async () => {
    const res = await handleMessage(
      req(31, "tools/call", { name: "search", arguments: { query: "deep research" } }),
      drOpts,
    );
    const parsed = JSON.parse(resultText(res)) as {
      results: Array<{ id: string; title: string; url: string }>;
    };
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results).toHaveLength(1);
    const hit = parsed.results[0];
    expect(hit).toEqual({
      id: "taylor/deep-skill",
      title: OWNED_SKILL.name,
      url: expect.stringMatching(/^https?:\/\/.+\/taylor\/deep-skill$/),
    });
  });

  it("AE8: search uses _local owner fallback for ownerless skills", async () => {
    const res = await handleMessage(
      req(32, "tools/call", { name: "search", arguments: { query: "ownerless" } }),
      drOpts,
    );
    const parsed = JSON.parse(resultText(res)) as { results: Array<{ id: string }> };
    expect(parsed.results.map((r) => r.id)).toEqual(["_local/mem-local"]);
  });

  it("AE8: fetch round-trips an id from search and returns the document shape", async () => {
    const searchRes = await handleMessage(
      req(33, "tools/call", { name: "search", arguments: { query: "deep" } }),
      drOpts,
    );
    const { results } = JSON.parse(resultText(searchRes)) as {
      results: Array<{ id: string }>;
    };
    expect(results.length).toBeGreaterThan(0);

    const fetchRes = await handleMessage(
      req(34, "tools/call", { name: "fetch", arguments: { id: results[0].id } }),
      drOpts,
    );
    const doc = JSON.parse(resultText(fetchRes)) as {
      id: string;
      title: string;
      text: string;
      url: string;
      metadata: Record<string, unknown>;
    };
    expect(doc.id).toBe(results[0].id);
    expect(doc.title).toBe(OWNED_SKILL.name);
    expect(doc.text).toBe(SKILL_MD_BODY);
    expect(doc.url.length).toBeGreaterThan(0);
    expect(doc.metadata).toMatchObject({
      slug: OWNED_SKILL.slug,
      version_hash: OWNED_SKILL.hash,
      version_label: OWNED_SKILL.versionLabel,
      author: OWNED_SKILL.owner,
    });
  });

  it("fetch with an unknown id returns a JSON-RPC error (no crash)", async () => {
    const res = await handleMessage(
      req(35, "tools/call", { name: "fetch", arguments: { id: "nobody/no-such-skill" } }),
      drOpts,
    );
    expect(res).toMatchObject({
      id: 35,
      error: { code: -32602, message: expect.stringContaining("nobody/no-such-skill") },
    });
    expect("result" in (res as object)).toBe(false);
  });

  it("R15: default options — tools/list is exactly the three core tools", async () => {
    const res = await handleMessage(req(36, "tools/list"), { token: VALID_TOKEN, source: drSource });
    const tools = (res as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_skill",
      "list_skills",
      "search_skills",
    ]);
  });

  it("R15: default options — calling search returns tool-not-found", async () => {
    const res = await handleMessage(
      req(37, "tools/call", { name: "search", arguments: { query: "deep" } }),
      { token: VALID_TOKEN, source: drSource },
    );
    const result = (res as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown tool: search/i);
  });

  it("R15: default options — calling fetch returns tool-not-found", async () => {
    const res = await handleMessage(
      req(38, "tools/call", { name: "fetch", arguments: { id: "taylor/deep-skill" } }),
      { token: VALID_TOKEN, source: drSource },
    );
    const result = (res as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown tool: fetch/i);
  });
});

// ── Skill store symlink refusal ───────────────────────────────────────────────

describe("skill store symlink refusal", () => {
  it.skipIf(process.platform === "win32")("readSkillFile refuses symlinks", async () => {
    const { symlink } = await import("node:fs/promises");
    const secretPath = join(tmpSkilletDir, "secret.txt");
    await writeFile(secretPath, "secret");
    const skillDir = join(tmpSkilletDir, "skills", LOCAL_SKILL.slug);
    await mkdir(skillDir, { recursive: true });
    await symlink(secretPath, join(skillDir, "link.md"));
    const { readSkillFile } = await import("../src/store.js");
    await expect(readSkillFile(LOCAL_SKILL.slug, "link.md")).rejects.toMatchObject({
      code: "symlink_refused",
    });
  });
});
