import { describe, it, expect } from "vitest";
import {
  isValidToken,
  tokenFromHeader,
  visibleSkills,
  authorizeBearerToken,
} from "../src/auth.js";
import type { SkillEntry } from "../src/store.js";

const skills = [{ slug: "a" }, { slug: "b" }] as unknown as SkillEntry[];

describe("isValidToken", () => {
  it("accepts the recognised skillet bearer prefixes", () => {
    expect(isValidToken("skillet_k_abc")).toBe(true);
    expect(isValidToken("skillet_s_abc")).toBe(true);
    expect(isValidToken("skillet_d_abc")).toBe(true);
  });

  it("rejects empty, unknown-prefix, and loopback tokens", () => {
    expect(isValidToken(null)).toBe(false);
    expect(isValidToken(undefined)).toBe(false);
    expect(isValidToken("")).toBe(false);
    expect(isValidToken("skillet_")).toBe(false);
    expect(isValidToken("skillet_m_hosted")).toBe(false); // MCP-link is not a bearer here
    expect(isValidToken("bearer-garbage")).toBe(false);
  });
});

describe("visibleSkills (fail-closed)", () => {
  it("returns all skills for a valid token", () => {
    expect(visibleSkills(skills, "skillet_s_ok")).toHaveLength(2);
  });
  it("returns nothing without a valid token — local skills are private", () => {
    expect(visibleSkills(skills, null)).toEqual([]);
    expect(visibleSkills(skills, "not-a-token")).toEqual([]);
  });
});

describe("tokenFromHeader", () => {
  it("extracts a Bearer token, case-insensitive on the scheme", () => {
    expect(tokenFromHeader("Bearer skillet_s_x")).toBe("skillet_s_x");
    expect(tokenFromHeader("bearer skillet_s_x")).toBe("skillet_s_x");
    expect(tokenFromHeader("  Bearer   skillet_s_x  ")).toBe("skillet_s_x");
  });
  it("returns null for a missing or non-Bearer header", () => {
    expect(tokenFromHeader(null)).toBeNull();
    expect(tokenFromHeader(undefined)).toBeNull();
    expect(tokenFromHeader("")).toBeNull();
    expect(tokenFromHeader("Basic abc")).toBeNull();
    expect(tokenFromHeader("Bearer")).toBeNull();
    expect(tokenFromHeader("Bearer a b")).toBeNull(); // second token is not \S+
  });
});

describe("authorizeBearerToken (loopback: secret-only, #469)", () => {
  it("accepts the exact loopback secret", async () => {
    const ok = await authorizeBearerToken("loop-secret", {
      loopbackSecret: "loop-secret",
    });
    expect(ok).toBe(true);
  });

  it("rejects a skillet_loop_* token that is not the active loopback secret", async () => {
    const ok = await authorizeBearerToken("skillet_loop_stale", {
      loopbackSecret: "loop-secret",
    });
    expect(ok).toBe(false);
  });

  // #469: a valid registry token is NOT accepted on the loopback transport.
  // On a shared host a second local user's own token must not read this
  // machine's private local store — only the 0600 loopback secret gates it.
  it("rejects any registry token, even a valid one, on loopback", async () => {
    expect(
      await authorizeBearerToken("skillet_s_x", { loopbackSecret: "loop-secret" }),
    ).toBe(false);
  });

  it("fails closed on a null or malformed token, or a missing secret", async () => {
    expect(await authorizeBearerToken(null, { loopbackSecret: "loop-secret" })).toBe(false);
    expect(await authorizeBearerToken("garbage", { loopbackSecret: "loop-secret" })).toBe(false);
    expect(await authorizeBearerToken("loop-secret", { loopbackSecret: null })).toBe(false);
  });
});
