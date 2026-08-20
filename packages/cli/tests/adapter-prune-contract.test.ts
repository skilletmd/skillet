// U4 — prune correctness contract.
//
// reconcilePrune trashes only GLOBAL adapter copies, and relies on them being
// written VERBATIM: the on-disk hash must equal what Skillet wrote, or the
// "edited vs unedited" check (and the whole trash decision) is wrong. The signal
// for a non-verbatim adapter is a `transform` method that rewrites the bundle.
//
// Today only Cursor transforms (project-scoped), and prune skips project
// adapters entirely. (Windsurf/Devin Desktop became a global verbatim
// materializer in the June 2026 rebrand — it no longer transforms.) This test
// fails the moment a GLOBAL adapter gains a transform, forcing whoever adds it
// to teach reconcilePrune adapter-aware removal first — rather than silently
// breaking file deletion.
import test from "node:test";
import assert from "node:assert/strict";
import type { Adapter } from "@skillet/core";
import { ALL_ADAPTERS } from "../src/cli-context.js";

function isProject(a: Adapter): boolean {
  return (a.kind ?? "global") === "project";
}

test("every global adapter writes verbatim (no transform)", () => {
  const offenders = ALL_ADAPTERS.filter(
    (a) => !isProject(a) && typeof a.transform === "function",
  ).map((a) => a.name);
  assert.deepEqual(
    offenders,
    [],
    `Global adapters must materialize bundles verbatim so prune's hash check holds. ` +
      `These transform but are global: ${offenders.join(", ")}. Make them project-scoped ` +
      `or teach reconcilePrune adapter-aware removal before shipping.`,
  );
});

test("the contract actually bites — a synthetic global transformer is caught", () => {
  const fake = { name: "fake", kind: "global", transform: () => null } as unknown as Adapter;
  const caught = !isProject(fake) && typeof fake.transform === "function";
  assert.equal(caught, true);
});

test("cursor (the only transforming adapter) is project-scoped (prune skips it)", () => {
  const a = ALL_ADAPTERS.find((x) => x.name === "cursor");
  assert.ok(a, `cursor adapter missing from ALL_ADAPTERS`);
  assert.equal(a!.kind, "project", `cursor must be project-scoped`);
});

test("windsurf/Devin Desktop is now a global verbatim materializer (no transform)", () => {
  const a = ALL_ADAPTERS.find((x) => x.name === "windsurf");
  assert.ok(a, `windsurf adapter missing from ALL_ADAPTERS`);
  assert.notEqual(a!.kind, "project", `windsurf is global since the rebrand`);
  assert.equal(typeof a!.transform, "undefined", `windsurf writes bundles verbatim`);
});
