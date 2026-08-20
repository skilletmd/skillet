/**
 * Login: handle validation, key mint+reuse, 201/409 handling, identity persistence.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface MockCall {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(
  responder: (call: MockCall) => { status: number; body: unknown }
): { fetch: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const call: MockCall = {
      url,
      method: init?.method ?? "GET",
      body:
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : null,
    };
    calls.push(call);
    const { status, body } = responder(call);
    const text = body == null ? "" : JSON.stringify(body);
    return new Response(text, {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

describe("login", () => {
  let skilletDir: string;
  let configDir: string;

  beforeEach(async () => {
    skilletDir = await mkdtemp(join(tmpdir(), "skillet-login-skillet-"));
    configDir = await mkdtemp(join(tmpdir(), "skillet-login-cfg-"));
    process.env["SKILLET_DIR"] = skilletDir;
    delete process.env["SKILLET_TOKEN"];
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(skilletDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
    delete process.env["SKILLET_DIR"];
    delete process.env["SKILLET_TOKEN"];
  });

  it("rejects invalid handles before touching the registry", async () => {
    const { login } = await import("../src/commands/login.js");
    const { fetch, calls } = mockFetch(() => ({ status: 500, body: null }));

    await expect(
      login({
        handle: "Has UpperCase",
        name: "X",
        registryUrl: "https://r.test",
        configDir,
        fetchImpl: fetch,
      })
    ).rejects.toThrow(/Invalid handle/);
    expect(calls).toHaveLength(0);
  });

  it("mints a fresh Ed25519 key on first call and posts the new profile", async () => {
    const { login } = await import("../src/commands/login.js");
    const { loadAuthorKey } = await import("../src/signing/index.js");
    const { fetch, calls } = mockFetch((call) => {
      expect(call.url).toMatch(/\/profiles$/);
      expect(call.method).toBe("POST");
      expect(call.body).toMatchObject({ id: "taylor", name: "Taylor" });
      return { status: 201, body: { id: "taylor", name: "Taylor" } };
    });

    const { identity, created } = await login({
      handle: "taylor",
      name: "Taylor",
      registryUrl: "https://r.test",
      configDir,
      fetchImpl: fetch,
    });

    expect(created).toBe(true);
    expect(identity.handle).toBe("taylor");
    expect(identity.keyId).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.registryUrl).toBe("https://r.test");

    const reloaded = await loadAuthorKey(configDir);
    expect(reloaded.keyId).toBe(identity.keyId);
    expect(calls).toHaveLength(1);
  });

  it("reuses an existing key when one is already on disk", async () => {
    const { login } = await import("../src/commands/login.js");
    const { generateAuthorKey, saveAuthorKey } = await import(
      "../src/signing/index.js"
    );
    const seeded = generateAuthorKey();
    await saveAuthorKey(seeded, configDir);

    const { fetch } = mockFetch(() => ({ status: 201, body: { id: "x" } }));
    const { identity } = await login({
      handle: "taylor",
      name: "Taylor",
      registryUrl: "https://r.test",
      configDir,
      fetchImpl: fetch,
    });
    expect(identity.keyId).toBe(seeded.keyId);
  });

  it("accepts 409 only when the local identity already names the same handle (re-login)", async () => {
    const { login } = await import("../src/commands/login.js");
    const { saveIdentity } = await import("../src/identity/index.js");
    const { generateAuthorKey, saveAuthorKey } = await import(
      "../src/signing/index.js"
    );
    const seeded = generateAuthorKey();
    await saveAuthorKey(seeded, configDir);
    await saveIdentity({
      handle: "taylor",
      keyId: seeded.keyId,
      registryUrl: "https://r.test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const { fetch } = mockFetch(() => ({
      status: 409,
      body: { error: "handle_taken", message: "Author 'taylor' already exists" },
    }));
    const { identity, created } = await login({
      handle: "taylor",
      name: "Taylor",
      registryUrl: "https://r.test",
      configDir,
      fetchImpl: fetch,
    });
    expect(created).toBe(false);
    expect(identity.handle).toBe("taylor");
  });

  it("rejects 409 when the local identity does not match (handle is taken by someone else)", async () => {
    const { login } = await import("../src/commands/login.js");

    const { fetch } = mockFetch(() => ({
      status: 409,
      body: { error: "handle_taken", message: "Author 'taylor' already exists" },
    }));

    await expect(
      login({
        handle: "taylor",
        name: "Taylor",
        registryUrl: "https://r.test",
        configDir,
        fetchImpl: fetch,
      })
    ).rejects.toThrow(/already registered/);
  });

  it("surfaces non-2xx, non-409 responses as a RegistryError", async () => {
    const { login } = await import("../src/commands/login.js");
    const { fetch } = mockFetch(() => ({
      status: 500,
      body: { error: "internal_server_error", message: "boom" },
    }));
    await expect(
      login({
        handle: "taylor",
        name: "Taylor",
        registryUrl: "https://r.test",
        configDir,
        fetchImpl: fetch,
      })
    ).rejects.toThrow(/boom/);
  });
});
