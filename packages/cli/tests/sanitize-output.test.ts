// Terminal control-char stripping for untrusted output.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripControlChars } from "../src/sanitize-output.js";

describe("stripControlChars", () => {
  it("removes an OSC sequence (clipboard/title injection)", () => {
    const out = stripControlChars("file\x1b]52;c;cGF3bmVk\x07.txt");
    assert.ok(!out.includes("\x1b"));
    assert.equal(out, "file.txt");
  });

  it("removes a CSI sequence (clear screen / cursor move)", () => {
    const out = stripControlChars("before\x1b[2Jafter");
    assert.ok(!out.includes("\x1b"));
    assert.equal(out, "beforeafter");
  });

  it("removes bare C0/C1 control chars but keeps tabs and visible text", () => {
    const out = stripControlChars("a\x07b\tc\x9fd");
    assert.equal(out, "ab\tcd");
  });

  it("leaves plain text untouched", () => {
    assert.equal(stripControlChars("- removed line\n+ added line"), "- removed line\n+ added line");
  });
});
