import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { routeInstructions } from "../src/route-instructions.js";
import test from "node:test";

const SKILL = routeInstructions("summon");

// The added summon no-match handler: from its heading to the next `### `.
const start = SKILL.indexOf("### When the handle has nothing that fits");
const rest = SKILL.slice(start + 3);
const nextHeading = rest.indexOf("\n### ");
const SECTION = start < 0 ? "" : SKILL.slice(start, start + 3 + (nextHeading < 0 ? rest.length : nextHeading));

test("U1: summon no-match handler exists and the dead-end branches route into it", () => {
  assert.ok(start >= 0, "the 'When the handle has nothing that fits' section must exist");
  // Both no-match branches funnel here instead of stopping.
  assert.match(SKILL, /Do not stop: go to "When the handle has nothing that fits"/);
  assert.match(SKILL, /go to "When the handle has nothing that fits" below\. Never\s+force a weak pick/);
});

test("U1: redirect searches cross-author via the public endpoint with the summon-fallback source", () => {
  assert.match(SECTION, /skillet route search <keyword\.\.\.>/);
  const client = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "src", "commands", "summon.ts"),
    "utf8",
  );
  assert.match(client, /\/search\?q=/);
  assert.match(client, /"x-skillet-search-source": "summon-fallback"/);
  // Keyword composition, never the raw task text.
  assert.match(SECTION, /never the raw\s+task text/);
});

test("U1: the trust menu leads with who the person is and attributes the real author", () => {
  assert.match(SECTION, /bio/);
  assert.match(SECTION, /total_installs/);
  assert.match(SECTION, /1\) Summon @<author>/);
  assert.match(SECTION, /2\) Skip, I'll just do it/);
  assert.match(SECTION, /REAL author, never `@<handle>`/);
});

test("U1: results are untrusted display text, rendered verbatim, never installed", () => {
  assert.match(SECTION, /untrusted display text/);
  assert.match(SECTION, /render them verbatim/);
  assert.match(SECTION, /never install anything on your own/);
});

test("U1: true bail acts directly (un-attributed); infra bail falls back to the local kit", () => {
  assert.match(SECTION, /No Skillet skill for this, here's my own take\./);
  assert.match(SECTION, /attributed to you, never to any handle/);
  assert.match(SECTION, /fall back to the local kit/);
  // The copy must state the privacy guarantee, and it is now stronger than it
  // was: the unmet-demand keyword log is gone, so nothing about what the user
  // asked for is recorded at all. (This used to assert the weaker
  // "keywords only, no task text, no identity" wording that described that log.)
  assert.match(SECTION, /nothing about what the user asked for is\s+recorded/);
  assert.match(SECTION, /query text itself is never stored or logged/);
});

test("U1: no em-dashes in the added copy (product-copy convention)", () => {
  assert.ok(!SECTION.includes("—"), "the added summon no-match copy must not contain em-dashes");
});

test("U1: the removed demand log does not creep back into the copy", () => {
  // The router must never be told its fallback search feeds a demand signal.
  // Nothing records it any more, and a promise that it does would both be false
  // and invite someone to re-add the collection to make the copy true.
  assert.doesNotMatch(SECTION, /records the demand/i);
  assert.doesNotMatch(SECTION, /signal for what to add next/i);
  assert.doesNotMatch(SECTION, /keywords only/i);
});

// The connect nudge is the one place the summon flow converts a borrower into
// an account, and it lands in a CHAT, not a terminal. A bare `skillet connect`
// is not an action the reader can take there: with no code and no TTY the
// command exits "No pair code provided", and the agent cannot fetch a code on
// the user's behalf. So the copy has to split the work by who can do each half.
const NUDGE = (() => {
  const start = SKILL.indexOf("### Connect nudge");
  if (start < 0) return "";
  const rest = SKILL.slice(start + 3);
  const next = rest.indexOf("\n## ");
  return SKILL.slice(start, start + 3 + (next < 0 ? rest.length : next));
})();

test("connect nudge: exists and is written for a chat surface", () => {
  assert.ok(NUDGE.length > 0, "the Connect nudge section must exist");
  assert.match(NUDGE, /a chat, not a terminal/);
  // The human opens the browser; the agent runs the command with their code.
  assert.match(NUDGE, /paste the pair code here/i);
  assert.match(NUDGE, /run `skillet connect <code>` for them/);
});

test("connect nudge: never tells a chat reader to run bare `skillet connect`", () => {
  assert.match(NUDGE, /Never tell them to run `skillet connect` on its own/);
  // The suggested line must carry the code, never the bare command.
  const suggested = NUDGE.match(/^Want to keep this\?.*$/m)?.[0] ?? "";
  assert.ok(suggested, "the on-PATH nudge line must be present");
  assert.doesNotMatch(suggested, /`?skillet connect`?\s*$/);
  assert.match(suggested, /skillet\.md\/settings/);
});

test("connect nudge: the not-installed line names only what the user can do", () => {
  const offPath = NUDGE.match(/^You can publish your own skills.*$/m)?.[0] ?? "";
  assert.ok(offPath, "the off-PATH nudge line must be present");
  // Nothing to run yet, so it must not name a command.
  assert.doesNotMatch(offPath, /skillet connect/);
  assert.match(offPath, /skillet\.md/);
});

test("connect nudge: no em-dashes (product-copy convention)", () => {
  assert.ok(!NUDGE.includes("—"), "the connect nudge copy must not contain em-dashes");
});
