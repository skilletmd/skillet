import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const directoryFsyncPaths: string[] = [];

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    async open(
      path: string,
      flags?: Parameters<typeof actual.open>[1],
      mode?: Parameters<typeof actual.open>[2],
    ) {
      const handle = await actual.open(path, flags, mode);
      if (flags === "r") {
        const originalSync = handle.sync.bind(handle);
        handle.sync = async () => {
          directoryFsyncPaths.push(String(path));
          return originalSync();
        };
      }
      return handle;
    },
  };
});

import { atomicWrite } from "../src/util/atomic.js";

describe("util/atomic directory fsync", () => {
  let dir: string;

  beforeEach(() => {
    directoryFsyncPaths.length = 0;
    dir = join(tmpdir(), `skillet-atomic-dir-fsync-${randomBytes(4).toString("hex")}`);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fsyncs the parent directory after rename", async () => {
    await mkdir(dir, { recursive: true });
    const dest = join(dir, "test.md");

    await atomicWrite(dest, "hello world");

    if (process.platform === "win32") {
      expect(directoryFsyncPaths).toEqual([]);
    } else {
      expect(directoryFsyncPaths).toEqual([dir]);
    }
    expect(await readFile(dest, "utf8")).toBe("hello world");
  });
});
