import assert from "node:assert/strict";
import test from "node:test";
import { configureAddPresent } from "../src/cli-add-present.js";
import {
  displaySlug,
  renderUploadProgress,
  summarizeUploadResult,
} from "../src/commands/upload-cmd.js";

test("displaySlug strips promoted registry keys", () => {
  assert.equal(displaySlug("deploy-ritual"), "deploy-ritual");
  assert.equal(displaySlug("@thiago/deploy-ritual"), "deploy-ritual");
});

test("summarizeUploadResult splits published vs unchanged", () => {
  const line = summarizeUploadResult(
    {
      ok: true,
      owner: "thiago",
      published: [
        { slug: "a", alreadyExists: false },
        { slug: "b", alreadyExists: true },
      ],
      failed: [],
      empty: false,
    },
    "private",
  );
  assert.match(line, /1 published, 1 unchanged on @thiago \(private\)/);
});

test("renderUploadProgress emits stepped lines", () => {
  configureAddPresent({ json: false, color: false });
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    renderUploadProgress({ phase: "start", slug: "alpha", index: 0, total: 1 });
    renderUploadProgress({
      phase: "done",
      slug: "alpha",
      alreadyExists: false,
      owner: "thiago",
    });
    renderUploadProgress({ phase: "fail", slug: "bad", error: "boom" });
    renderUploadProgress({
      phase: "done",
      slug: "@thiago/skip",
      alreadyExists: true,
      owner: "thiago",
    });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assert.match(lines[0]!, /Uploading alpha/);
  assert.match(lines[1]!, /alpha → @thiago\/alpha/);
  assert.match(lines[2]!, /bad: boom/);
  assert.match(lines[3]!, /skip unchanged on profile/);
});
