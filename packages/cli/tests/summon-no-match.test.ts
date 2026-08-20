import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL = readFileSync(
  join(__dirname, "..", "bundled-skills", "skillet-route", "SKILL.md"),
  "utf8",
);

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
  assert.match(SECTION, /\/api\/v1\/search\?q=<keywords>&types=skills/);
  assert.match(SECTION, /x-skillet-search-source: summon-fallback/);
  // Keyword composition, never the raw task text.
  assert.match(SECTION, /never the raw\s+task text/);
});

test("U1: the trust menu leads with who the person is and attributes the real author", () => {
  assert.match(SECTION, /\/api\/v1\/authors\/\{author\}/);
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
  // Demand is recorded keywords-only, no task text, no identity.
  assert.match(SECTION, /keywords only, no\s+task text, no identity/);
});

test("U1: no em-dashes in the added copy (product-copy convention)", () => {
  assert.ok(!SECTION.includes("—"), "the added summon no-match copy must not contain em-dashes");
});
