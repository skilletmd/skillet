// Secrets must never reach CLI stdout/stderr.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatScanFinding } from "../src/sanitize-output.js";
import { safeAuthConnectJson } from "../src/commands/auth.js";

describe("formatScanFinding", () => {
  it("shows location + category but never the matched secret", () => {
    const line = formatScanFinding({ file: "config.yml", lineStart: 42, category: "aws-key" });
    assert.ok(line.includes("config.yml:42"));
    assert.ok(line.includes("[aws-key]"));
    assert.ok(line.includes("redacted"));
  });

  it("does not interpolate a snippet field even if present on the object", () => {
    const f = { file: "a.sh", lineStart: 1, category: "bearer", snippet: "Bearer sk_live_SECRET" };
    assert.ok(!formatScanFinding(f).includes("sk_live_SECRET"));
  });
});

describe("safeAuthConnectJson", () => {
  it("omits device_token / session_token from the JSON", () => {
    const json = safeAuthConnectJson({
      device_id: "dev_123",
      ...({ device_token: "skillet_d_SECRET", session_token: "skillet_s_SECRET" } as object),
    } as { device_id: string });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    assert.equal(parsed.device_id, "dev_123");
    assert.equal(parsed.device_token, undefined);
    assert.equal(parsed.session_token, undefined);
    assert.ok(!json.includes("SECRET"));
  });
});
