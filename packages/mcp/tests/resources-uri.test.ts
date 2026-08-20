import { describe, it, expect } from "vitest";
import { ownerSegment, buildUri, parseUri } from "../src/resources.js";

describe("ownerSegment", () => {
  it("normalises null/undefined to _local and strips a leading @", () => {
    expect(ownerSegment(null)).toBe("_local");
    expect(ownerSegment(undefined)).toBe("_local");
    expect(ownerSegment("")).toBe("_local");
    expect(ownerSegment("@taylor")).toBe("taylor");
    expect(ownerSegment("taylor")).toBe("taylor");
  });
});

describe("buildUri / parseUri round-trip", () => {
  it("round-trips an owned skill file", () => {
    const uri = buildUri("@taylor", "my-skill", "references/policy.md");
    expect(uri).toBe("skillet://taylor/my-skill/references/policy.md");
    expect(parseUri(uri)).toEqual({
      owner: "taylor",
      slug: "my-skill",
      path: "references/policy.md",
    });
  });

  it("round-trips a local (unowned) skill file", () => {
    const uri = buildUri(null, "scratch", "SKILL.md");
    expect(uri).toBe("skillet://_local/scratch/SKILL.md");
    expect(parseUri(uri)).toEqual({ owner: "_local", slug: "scratch", path: "SKILL.md" });
  });
});

describe("parseUri validation", () => {
  it("rejects a non-skillet scheme", () => {
    expect(() => parseUri("https://taylor/s/SKILL.md")).toThrow(/scheme/);
  });

  it("rejects missing owner or slug segments", () => {
    expect(() => parseUri("skillet:///slug/SKILL.md")).toThrow(/owner/);
    expect(() => parseUri("skillet://taylor/SKILL.md")).toThrow(/slug/);
  });

  it("rejects path traversal", () => {
    expect(() => parseUri("skillet://taylor/s/../../etc/passwd")).toThrow(/traversal/);
    expect(() => parseUri("skillet://taylor/s/a/./b")).toThrow(/traversal/);
  });

  it("rejects absolute paths and empty segments", () => {
    expect(() => parseUri("skillet://taylor/s//etc/passwd")).toThrow(/Absolute|Empty/);
    expect(() => parseUri("skillet://taylor/s/refs//x.md")).toThrow(/Empty/);
  });

  it("rejects a null byte in the path", () => {
    expect(() => parseUri("skillet://taylor/s/SKILL\x00.md")).toThrow(/Null byte/);
  });

  it("rejects unsafe characters in the owner segment", () => {
    expect(() => parseUri("skillet://ta ylor/s/SKILL.md")).toThrow();
  });
});
