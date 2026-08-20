/**
 * Identity store: roundtrip, permissions, missing-file handling.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, chmod, lstat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enforcesUnixFilePermissions } from "../src/util/unix-perms.js";

async function freshSkilletDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "skillet-identity-test-"));
  process.env["SKILLET_DIR"] = dir;
  vi.resetModules();
  return dir;
}

describe("identity store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await freshSkilletDir();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env["SKILLET_DIR"];
  });

  it("returns null when no identity file exists", async () => {
    const { loadIdentity } = await import("../src/identity/index.js");
    expect(await loadIdentity()).toBeNull();
  });

  it("round-trips an identity record", async () => {
    const { saveIdentity, loadIdentity, identityPath } = await import(
      "../src/identity/index.js"
    );
    const id = {
      handle: "taylor",
      keyId: "a".repeat(64),
      registryUrl: "https://registry.example.test",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await saveIdentity(id);
    expect(identityPath()).toBe(join(dir, "identity.json"));
    const loaded = await loadIdentity();
    expect(loaded).toEqual(id);
  });

  it.skipIf(!enforcesUnixFilePermissions())("writes identity.json at mode 0600", async () => {
    const { saveIdentity, identityPath } = await import(
      "../src/identity/index.js"
    );
    await saveIdentity({
      handle: "taylor",
      keyId: "b".repeat(64),
      registryUrl: "https://registry.example.test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const info = await lstat(identityPath());
    expect(info.mode & 0o777).toBe(0o600);
  });

  it.skipIf(!enforcesUnixFilePermissions())("writes identity.json at mode 0600 even with umask 0", async () => {
    const { saveIdentity, identityPath } = await import(
      "../src/identity/index.js"
    );
    const prev = process.umask(0);
    try {
      await saveIdentity({
        handle: "umasktest",
        keyId: "d".repeat(64),
        registryUrl: "https://registry.example.test",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const info = await lstat(identityPath());
      expect(info.mode & 0o777).toBe(0o600);
    } finally {
      process.umask(prev);
    }
  });

  it.skipIf(!enforcesUnixFilePermissions())("refuses to load a world-readable identity file", async () => {
    const { saveIdentity, loadIdentity, identityPath } = await import(
      "../src/identity/index.js"
    );
    await saveIdentity({
      handle: "taylor",
      keyId: "c".repeat(64),
      registryUrl: "https://registry.example.test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await chmod(identityPath(), 0o644);
    await expect(loadIdentity()).rejects.toThrow(/insecure permissions/);
  });

  it.skipIf(process.platform === "win32")("refuses to load identity.json when it is a symlink", async () => {
    const { saveIdentity, loadIdentity, identityPath } = await import(
      "../src/identity/index.js"
    );
    // Write a real identity file to a separate path
    const realFile = join(dir, "identity-real.json");
    await writeFile(realFile, JSON.stringify({
      handle: "symlinktest",
      keyId: "e".repeat(64),
      registryUrl: "https://registry.example.test",
      createdAt: "2026-01-01T00:00:00.000Z",
    }, null, 2) + "\n", { mode: 0o600 });

    // Plant a symlink at the expected identity path
    await symlink(realFile, identityPath());
    await expect(loadIdentity()).rejects.toThrow(/symlink/);
  });

  it.skipIf(!enforcesUnixFilePermissions())("creates SKILLET_DIR at mode 0700", async () => {
    const { saveIdentity } = await import("../src/identity/index.js");
    await saveIdentity({
      handle: "dirtest",
      keyId: "f".repeat(64),
      registryUrl: "https://registry.example.test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const info = await lstat(dir);
    expect(info.mode & 0o777).toBe(0o700);
  });
});
