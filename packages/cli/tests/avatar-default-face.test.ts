import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { DEFAULT_AVATAR_COUNT, defaultAvatarPath } from "../src/commands/avatar.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, "..", "..", "web");

/**
 * The web assigns every person a default illustrated face client-side and never
 * persists it, so `avatar_url` is null for anyone without an uploaded photo.
 * `skillet avatar` derives the same path for the desktop tray — which only works
 * while both sides agree on the hash, the count, and the path shape. These
 * guards fail loudly if one side moves. See packages/web/src/lib/avatar-color.ts.
 */

test("face count matches the web's constant", () => {
  const src = readFileSync(join(WEB, "src", "lib", "avatar-color.ts"), "utf8");
  const m = /DEFAULT_AVATAR_COUNT\s*=\s*(\d+)/.exec(src);
  assert.ok(m, "could not read DEFAULT_AVATAR_COUNT from the web's avatar-color.ts");
  assert.equal(
    Number(m[1]),
    DEFAULT_AVATAR_COUNT,
    "the CLI and web disagree on how many default faces exist — a handle would resolve to a different face on each surface",
  );
});

test("face count matches the files actually on disk", () => {
  const files = readdirSync(join(WEB, "public", "avatars", "default")).filter((f) =>
    /^face-\d+\.svg$/.test(f),
  );
  assert.equal(
    files.length,
    DEFAULT_AVATAR_COUNT,
    "face-NN.svg files were added or removed without bumping DEFAULT_AVATAR_COUNT",
  );
});

test("derived path is the web's shape and lands in range", () => {
  // Golden value from the web's algorithm (djb2 over the bare handle, % count).
  assert.equal(defaultAvatarPath("taylor"), "/avatars/default/face-35.svg");
  // Zero-padded to two digits, matching the files on disk.
  assert.match(defaultAvatarPath("a"), /^\/avatars\/default\/face-\d{2}\.svg$/);
  for (const handle of ["", "a", "taylor", "grace-reviews", "maya-writes", "ünïcode"]) {
    const n = Number(/face-(\d+)\.svg$/.exec(defaultAvatarPath(handle))![1]);
    assert.ok(n >= 1 && n <= DEFAULT_AVATAR_COUNT, `${handle} resolved out of range: ${n}`);
  }
});

test("the same handle always resolves to the same face", () => {
  assert.equal(defaultAvatarPath("taylor"), defaultAvatarPath("taylor"));
  // The bare handle is the key — an "@" prefix would silently pick another face
  // than the web shows for the same person.
  assert.notEqual(defaultAvatarPath("taylor"), defaultAvatarPath("@taylor"));
});
