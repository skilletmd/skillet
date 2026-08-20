import assert from "node:assert/strict";
import test from "node:test";
import { webBaseUrl } from "../src/cli-command-tier.js";

test("webBaseUrl honors SKILLET_WEB_URL", () => {
  const prev = process.env["SKILLET_WEB_URL"];
  process.env["SKILLET_WEB_URL"] = "https://staging.skillet.md/";
  try {
    assert.equal(webBaseUrl(), "https://staging.skillet.md");
  } finally {
    if (prev === undefined) delete process.env["SKILLET_WEB_URL"];
    else process.env["SKILLET_WEB_URL"] = prev;
  }
});
