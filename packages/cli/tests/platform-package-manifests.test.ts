import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { NATIVE_TARGETS } from "../scripts/native-targets.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function manifest(key: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(repoRoot, "packages", `cli-${key}`, "package.json"), "utf8"),
  );
}

// A platform package's os/cpu/libc are what npm matches against before it
// installs the optional dependency. When they disagree with the triple the
// binary was actually built for, npm installs a binary that cannot run:
// cli-linux-x64 is a -linux-gnu build with no libc field, so npm handed it to
// Alpine, where exec failed with ENOENT (the glibc loader is absent, and Linux
// reports a missing interpreter as ENOENT on the executable). The bin shim had
// already committed to the native path by then, so the JS fallback never ran.
test("each platform package declares the os/cpu/libc its triple was built for", () => {
  for (const [key, spec] of Object.entries(NATIVE_TARGETS)) {
    const m = manifest(key);
    const [os, cpu] = key.split("-");
    assert.deepEqual(m["os"], [os], `${key}: os`);
    assert.deepEqual(m["cpu"], [cpu], `${key}: cpu`);

    if (os === "linux") {
      const expected = spec.triple.includes("-musl") ? "musl" : "glibc";
      assert.deepEqual(
        m["libc"],
        [expected],
        `${key}: triple ${spec.triple} needs libc ["${expected}"], or npm will install it on the wrong libc`,
      );
    } else {
      assert.equal(m["libc"], undefined, `${key}: libc applies to linux only`);
    }
  }
});

// packages/cli-win32-x64 listed files: ["bin/skillet"] while staging writes
// bin/skillet.exe, so npm packed a 452-byte tarball with no binary at all.
test("each platform package packs whatever staging writes into bin", () => {
  for (const key of Object.keys(NATIVE_TARGETS)) {
    assert.deepEqual(
      manifest(key)["files"],
      ["bin"],
      `${key}: files must be ["bin"] so it packs the staged binary whatever it is named`,
    );
  }
});

// The set of platforms is stated in three places that cannot import each other:
// the target table, one packages/cli-<key>/ directory per platform, and the
// publish matrix (GitHub needs that one literal). Adding a platform and
// updating two of the three is the failure this catches. It has not bitten yet;
// it is the shape of bug that arrives with the first new platform.
test("target table, platform package directories, and publish matrix agree", () => {
  const expected = Object.keys(NATIVE_TARGETS).sort();

  const dirs = readdirSync(join(repoRoot, "packages"))
    .filter((d) => d.startsWith("cli-"))
    .map((d) => d.slice("cli-".length))
    .sort();
  assert.deepEqual(dirs, expected, "packages/cli-*/ directories vs target table");

  const workflow = readFileSync(
    join(repoRoot, ".github", "workflows", "cli-publish.yml"),
    "utf8",
  );
  const matrix = [...workflow.matchAll(/^\s*-\s*target:\s*(\S+)\s*$/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(matrix, expected, "cli-publish.yml matrix vs target table");
});
