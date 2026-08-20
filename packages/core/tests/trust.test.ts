/**
 * Tests for the trust module: auto-trust policy + graded diff engine.
 *
 * Covers:
 *   - computeDiff: identical, added, removed, modified files
 *   - checkLock / recordApproval: read/write/check, stale hash
 *   - TOCTOU: hash mismatch after approval triggers re-approval requirement
 *   - promptApproval: y/n/eof/non-TTY behavior
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Writable, PassThrough } from "node:stream";

import { computeDiff, summarizeInstall, renderUpdateReview } from "../src/trust/diff.js";
import {
  checkLock,
  recordApproval,
  checkRejection,
  recordRejection,
  getLastApprovedVersion,
  type DiffApproval,
  type DiffRejection,
} from "../src/trust/approval-lock.js";
import { promptApproval } from "../src/trust/prompt.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function buf(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "skillet-trust-test-"));
}

class MockWritable extends Writable {
  data = "";
  isTTY: boolean;
  constructor(tty = true) {
    super();
    this.isTTY = tty;
  }
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.data += chunk.toString("utf8");
    cb();
  }
}

function mockInput(text: string): Readable {
  // Push data after a tick so readline has time to attach before data arrives.
  const stream = new Readable({ read() {} });
  process.nextTick(() => {
    if (text) stream.push(text);
    stream.push(null);
  });
  return stream;
}

function mockStreams(input: string, tty = true): { out: MockWritable; inp: Readable } {
  return { out: new MockWritable(tty), inp: mockInput(input) };
}

// ── computeDiff ───────────────────────────────────────────────────────────────

describe("computeDiff", () => {
  it("returns empty string when prev and next are identical", () => {
    const content = buf("# Skill\n\nDoes nothing.\n");
    expect(computeDiff({ "SKILL.md": content }, { "SKILL.md": content })).toBe(
      ""
    );
  });

  it("shows new file when prev is empty", () => {
    const diff = computeDiff(
      {},
      { "SKILL.md": buf("line 1\nline 2\n") }
    );
    expect(diff).toContain("--- /dev/null");
    expect(diff).toContain("+++ b/SKILL.md");
    expect(diff).toContain("+line 1");
    expect(diff).toContain("+line 2");
  });

  it("shows deleted file when next is empty", () => {
    const diff = computeDiff(
      { "SKILL.md": buf("line 1\nline 2\n") },
      {}
    );
    expect(diff).toContain("--- a/SKILL.md");
    expect(diff).toContain("+++ /dev/null");
    expect(diff).toContain("-line 1");
    expect(diff).toContain("-line 2");
  });

  it("shows modifications with removals and additions", () => {
    const prev = buf("# Skill\n\nOld description.\n");
    const next = buf("# Skill\n\nNew description.\n");
    const diff = computeDiff({ "SKILL.md": prev }, { "SKILL.md": next });
    expect(diff).toContain("-Old description.");
    expect(diff).toContain("+New description.");
    expect(diff).toContain("--- a/SKILL.md");
    expect(diff).toContain("+++ b/SKILL.md");
  });

  it("includes context lines around changes", () => {
    const prev = buf(
      "line 1\nline 2\nline 3\nline 4\nline 5\nOLD\nline 7\nline 8\nline 9\n"
    );
    const next = buf(
      "line 1\nline 2\nline 3\nline 4\nline 5\nNEW\nline 7\nline 8\nline 9\n"
    );
    const diff = computeDiff({ "SKILL.md": prev }, { "SKILL.md": next });
    // Context lines should appear around the change
    expect(diff).toContain(" line 3");
    expect(diff).toContain(" line 9");
    expect(diff).toContain("-OLD");
    expect(diff).toContain("+NEW");
  });

  it("includes ANSI color codes when color=true", () => {
    const prev = buf("old line\n");
    const next = buf("new line\n");
    const diff = computeDiff({ "SKILL.md": prev }, { "SKILL.md": next }, true);
    // Should contain ANSI escape sequences
    expect(diff).toContain("\x1b[");
  });

  it("omits ANSI codes when color=false", () => {
    const prev = buf("old line\n");
    const next = buf("new line\n");
    const diff = computeDiff({ "SKILL.md": prev }, { "SKILL.md": next }, false);
    expect(diff).not.toContain("\x1b[");
  });

  it("handles multiple files in lexicographic order", () => {
    const diff = computeDiff(
      { "b.md": buf("old b\n"), "a.md": buf("same\n") },
      { "b.md": buf("new b\n"), "a.md": buf("same\n") }
    );
    // a.md has no changes; b.md has changes
    expect(diff).toContain("a/b.md");
    expect(diff).not.toContain("a/a.md");
  });

  it("hunk header has correct @@ format", () => {
    const prev = buf("only change\n");
    const next = buf("changed line\n");
    const diff = computeDiff({ "SKILL.md": prev }, { "SKILL.md": next });
    expect(diff).toMatch(/@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/);
  });
});

// ── checkLock / recordApproval ────────────────────────────────────────────────

describe("checkLock / recordApproval", () => {
  let dir: string;
  let lockPath: string;

  beforeEach(async () => {
    dir = await tmpDir();
    lockPath = join(dir, "skillet.lock");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns false when the lock file does not exist", async () => {
    const result = await checkLock(lockPath, "my-skill", 1, "sha256:abc123");
    expect(result).toBe(false);
  });

  it("returns false when the skill has not been approved", async () => {
    const approval: DiffApproval = {
      contentHash: "sha256:aaa",
      authorKeyId: "a".repeat(64),
      approvedAt: new Date().toISOString(),
    };
    await recordApproval(lockPath, "other-skill", 1, approval);
    const result = await checkLock(lockPath, "my-skill", 1, "sha256:aaa");
    expect(result).toBe(false);
  });

  it("returns true when contentHash matches the recorded approval", async () => {
    const hash = "sha256:deadbeef";
    await recordApproval(lockPath, "my-skill", 1, {
      contentHash: hash,
      authorKeyId: "b".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    expect(await checkLock(lockPath, "my-skill", 1, hash)).toBe(true);
  });

  it("returns false when contentHash does not match (TOCTOU: content changed)", async () => {
    await recordApproval(lockPath, "my-skill", 1, {
      contentHash: "sha256:original",
      authorKeyId: "c".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    expect(
      await checkLock(lockPath, "my-skill", 1, "sha256:tampered")
    ).toBe(false);
  });

  it("version scoping: approval for v1 does not satisfy v2 check", async () => {
    await recordApproval(lockPath, "my-skill", 1, {
      contentHash: "sha256:v1hash",
      authorKeyId: "d".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    expect(
      await checkLock(lockPath, "my-skill", 2, "sha256:v1hash")
    ).toBe(false);
  });

  it("multiple skills are stored and retrieved independently", async () => {
    const hashA = "sha256:aaa";
    const hashB = "sha256:bbb";
    await recordApproval(lockPath, "skill-a", 1, {
      contentHash: hashA,
      authorKeyId: "e".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    await recordApproval(lockPath, "skill-b", 1, {
      contentHash: hashB,
      authorKeyId: "f".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    expect(await checkLock(lockPath, "skill-a", 1, hashA)).toBe(true);
    expect(await checkLock(lockPath, "skill-b", 1, hashB)).toBe(true);
    expect(await checkLock(lockPath, "skill-a", 1, hashB)).toBe(false);
  });

  it("overwrites an existing approval with a new one", async () => {
    await recordApproval(lockPath, "my-skill", 1, {
      contentHash: "sha256:old",
      authorKeyId: "g".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    await recordApproval(lockPath, "my-skill", 1, {
      contentHash: "sha256:new",
      authorKeyId: "g".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    expect(await checkLock(lockPath, "my-skill", 1, "sha256:new")).toBe(true);
    expect(await checkLock(lockPath, "my-skill", 1, "sha256:old")).toBe(false);
  });

  it("produces valid JSON in the lock file", async () => {
    await recordApproval(lockPath, "my-skill", 1, {
      contentHash: "sha256:test",
      authorKeyId: "h".repeat(64),
      approvedAt: "2026-06-12T00:00:00.000Z",
    });
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { version: number; approvals: unknown };
    expect(parsed.version).toBe(1);
    expect(parsed.approvals).toBeDefined();
  });

  it("is idempotent: re-recording same hash returns true", async () => {
    const hash = "sha256:same";
    for (let i = 0; i < 3; i++) {
      await recordApproval(lockPath, "my-skill", 1, {
        contentHash: hash,
        authorKeyId: "i".repeat(64),
        approvedAt: new Date().toISOString(),
      });
    }
    expect(await checkLock(lockPath, "my-skill", 1, hash)).toBe(true);
  });
});

// ── checkRejection / recordRejection ─────────────────────────────────────────

describe("checkRejection / recordRejection", () => {
  let dir: string;
  let lockPath: string;

  beforeEach(async () => {
    dir = await tmpDir();
    lockPath = join(dir, "skillet.lock");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns false when no rejection exists", async () => {
    expect(await checkRejection(lockPath, "my-skill", 1)).toBe(false);
  });

  it("returns true after recording a rejection", async () => {
    const rej: DiffRejection = {
      authorKeyId: "a".repeat(64),
      rejectedAt: new Date().toISOString(),
    };
    await recordRejection(lockPath, "my-skill", 1, rej);
    expect(await checkRejection(lockPath, "my-skill", 1)).toBe(true);
  });

  it("version-scoped: rejection at v1 does not affect v2", async () => {
    await recordRejection(lockPath, "my-skill", 1, {
      authorKeyId: "b".repeat(64),
      rejectedAt: new Date().toISOString(),
    });
    expect(await checkRejection(lockPath, "my-skill", 2)).toBe(false);
  });

  it("slug-scoped: rejection for skill-a does not affect skill-b", async () => {
    await recordRejection(lockPath, "skill-a", 1, {
      authorKeyId: "c".repeat(64),
      rejectedAt: new Date().toISOString(),
    });
    expect(await checkRejection(lockPath, "skill-b", 1)).toBe(false);
  });

  it("coexists with approvals in the same lock file", async () => {
    await recordApproval(lockPath, "skill-a", 1, {
      contentHash: "sha256:aaa",
      authorKeyId: "d".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    await recordRejection(lockPath, "skill-b", 1, {
      authorKeyId: "d".repeat(64),
      rejectedAt: new Date().toISOString(),
    });
    expect(await checkLock(lockPath, "skill-a", 1, "sha256:aaa")).toBe(true);
    expect(await checkRejection(lockPath, "skill-b", 1)).toBe(true);
    expect(await checkRejection(lockPath, "skill-a", 1)).toBe(false);
    expect(await checkLock(lockPath, "skill-b", 1, "sha256:aaa")).toBe(false);
  });

  it("produces valid JSON in the lock file", async () => {
    await recordRejection(lockPath, "my-skill", 1, {
      authorKeyId: "e".repeat(64),
      rejectedAt: "2026-06-13T00:00:00.000Z",
    });
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { version: number; rejections: unknown };
    expect(parsed.version).toBe(1);
    expect(parsed.rejections).toBeDefined();
  });

  it("approve-then-reject for same key: rejection wins, approval cleared", async () => {
    const hash = "sha256:v1hash";
    await recordApproval(lockPath, "skill-a", 1, {
      contentHash: hash,
      authorKeyId: "f".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    expect(await checkLock(lockPath, "skill-a", 1, hash)).toBe(true);
    await recordRejection(lockPath, "skill-a", 1, {
      authorKeyId: "f".repeat(64),
      rejectedAt: new Date().toISOString(),
    });
    expect(await checkLock(lockPath, "skill-a", 1, hash)).toBe(false);
    expect(await checkRejection(lockPath, "skill-a", 1)).toBe(true);
  });

  it("reject-then-approve for same key: approval wins, rejection cleared", async () => {
    const hash = "sha256:v1hash";
    await recordRejection(lockPath, "skill-a", 1, {
      authorKeyId: "f".repeat(64),
      rejectedAt: new Date().toISOString(),
    });
    expect(await checkRejection(lockPath, "skill-a", 1)).toBe(true);
    await recordApproval(lockPath, "skill-a", 1, {
      contentHash: hash,
      authorKeyId: "f".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    expect(await checkRejection(lockPath, "skill-a", 1)).toBe(false);
    expect(await checkLock(lockPath, "skill-a", 1, hash)).toBe(true);
  });
});

// ── getLastApprovedVersion ────────────────────────────────────────────────────

describe("getLastApprovedVersion", () => {
  let dir: string;
  let lockPath: string;

  beforeEach(async () => {
    dir = await tmpDir();
    lockPath = join(dir, "skillet.lock");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when no approvals exist", async () => {
    expect(await getLastApprovedVersion(lockPath, "my-skill")).toBeNull();
  });

  it("returns the single approved version", async () => {
    await recordApproval(lockPath, "my-skill", 3, {
      contentHash: "sha256:v3",
      authorKeyId: "a".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    expect(await getLastApprovedVersion(lockPath, "my-skill")).toBe(3);
  });

  it("returns the highest approved version among multiple", async () => {
    for (const v of [1, 3, 2]) {
      await recordApproval(lockPath, "my-skill", v, {
        contentHash: `sha256:v${v}`,
        authorKeyId: "b".repeat(64),
        approvedAt: new Date().toISOString(),
      });
    }
    expect(await getLastApprovedVersion(lockPath, "my-skill")).toBe(3);
  });

  it("slug-scoped: does not mix with other skills", async () => {
    await recordApproval(lockPath, "skill-a", 5, {
      contentHash: "sha256:v5",
      authorKeyId: "c".repeat(64),
      approvedAt: new Date().toISOString(),
    });
    expect(await getLastApprovedVersion(lockPath, "skill-b")).toBeNull();
  });
});

// ── promptApproval ────────────────────────────────────────────────────────────

describe("promptApproval", () => {
  it("returns true when user answers 'y'", async () => {
    const { out, inp } = mockStreams("y\n");
    const result = await promptApproval("--- diff ---", out, inp);
    expect(result).toBe(true);
  });

  it("returns true when user answers 'yes'", async () => {
    const { out, inp } = mockStreams("yes\n");
    const result = await promptApproval("--- diff ---", out, inp);
    expect(result).toBe(true);
  });

  it("returns true case-insensitively (Y, YES)", async () => {
    const { out: o1, inp: i1 } = mockStreams("Y\n");
    expect(await promptApproval("diff", o1, i1)).toBe(true);

    const { out: o2, inp: i2 } = mockStreams("YES\n");
    expect(await promptApproval("diff", o2, i2)).toBe(true);
  });

  it("returns false on 'n'", async () => {
    const { out, inp } = mockStreams("n\n");
    expect(await promptApproval("diff", out, inp)).toBe(false);
  });

  it("returns false on empty input (default deny)", async () => {
    const { out, inp } = mockStreams("\n");
    expect(await promptApproval("diff", out, inp)).toBe(false);
  });

  it("returns false on EOF without a line", async () => {
    const { out } = mockStreams("");
    const inp = new PassThrough();
    inp.end(); // immediate EOF, no data
    expect(await promptApproval("diff", out, inp)).toBe(false);
  });

  it("returns false and prints non-interactive message when not a TTY", async () => {
    const { out, inp } = mockStreams("y\n", false); // tty=false
    const result = await promptApproval("the diff", out, inp);
    expect(result).toBe(false);
    expect(out.data).toContain("Non-interactive terminal");
  });

  it("always prints the diff before prompting", async () => {
    const { out, inp } = mockStreams("y\n");
    await promptApproval("important diff content", out, inp);
    expect(out.data).toContain("important diff content");
  });

  it("uses install wording for first-time materialization", async () => {
    const { out, inp } = mockStreams("y\n");
    await promptApproval("Install @alice/foo:", out, inp, "install");
    expect(out.data).toContain("Install this skill?");
    expect(out.data).not.toContain("Approve this skill update?");
  });
});

describe("summarizeInstall", () => {
  it("lists bundle paths without dumping file bodies", () => {
    const summary = summarizeInstall("@alice/foo", {
      "cursor/SKILL.md": Buffer.from("line one\nline two\n"),
    });
    expect(summary).toContain("Install @alice/foo:");
    expect(summary).toContain("SKILL.md (3 lines)");
    expect(summary).not.toContain("line one");
  });

  it("deduplicates adapter-prefixed paths and excludes backup files", () => {
    const summary = summarizeInstall("@alice/foo", {
      "cursor/SKILL.md": Buffer.from("a\n"),
      "claude-code/SKILL.md": Buffer.from("a\n"),
      "codex/SKILL.md": Buffer.from("a\n"),
      "cursor/SKILL.md.skillet-backup": Buffer.from("old\n"),
    });
    const skillLines = summary.split("\n").filter((l) => l.includes("SKILL.md"));
    expect(skillLines).toHaveLength(1);
    expect(skillLines[0]).toContain("SKILL.md (2 lines)");
    expect(summary).not.toContain("skillet-backup");
  });

  it("folds large bundles into a totals line instead of listing every file", () => {
    const next: Record<string, Buffer> = {};
    for (let i = 0; i < 30; i++) {
      next[`cursor/pages/page-${String(i).padStart(2, "0")}/SKILL.md`] = Buffer.from("a\nb\n");
    }
    const summary = summarizeInstall("@tay/marketing-skills", next);
    const fileLines = summary.split("\n").filter((l) => l.includes("SKILL.md"));
    expect(fileLines.length).toBeLessThanOrEqual(8);
    expect(summary).toContain("…and 22 more files");
    expect(summary).toContain("lines)");
  });

  it("small bundles still list every file with no fold line", () => {
    const summary = summarizeInstall("@alice/foo", {
      "cursor/SKILL.md": Buffer.from("a\n"),
      "cursor/reference.md": Buffer.from("b\n"),
    });
    expect(summary).toContain("SKILL.md (2 lines)");
    expect(summary).toContain("reference.md (2 lines)");
    expect(summary).not.toContain("more files");
  });
});

describe("renderUpdateReview", () => {
  const NEXT = { "SKILL.md": Buffer.from("hello\nnew line\n") };

  it("shows one diff however many agents hold copies, with an applies-to header", () => {
    const review = renderUpdateReview({
      prev: {
        "claude-code/SKILL.md": Buffer.from("hello\nold line\n"),
        "codex/SKILL.md": Buffer.from("hello\nold line\n"),
      },
      next: NEXT,
      adapterNames: ["claude-code", "codex", "cursor"],
    });
    expect(review).toContain("Updates claude-code, codex · first install for cursor");
    // The change appears exactly once, not once per agent.
    expect(review.split("\n").filter((l) => l === "+new line")).toHaveLength(1);
    expect(review.split("\n").filter((l) => l === "-old line")).toHaveLength(1);
    // No misleading full-content "new file" wall for the agent without a copy.
    expect(review).not.toContain("/dev/null");
  });

  it("names the copy shown when agents' on-disk bytes disagree", () => {
    const review = renderUpdateReview({
      prev: {
        "claude-code/SKILL.md": Buffer.from("hello\nold line\n"),
        "codex/SKILL.md": Buffer.from("hello\ndrifted line\n"),
      },
      next: NEXT,
      adapterNames: ["claude-code", "codex"],
    });
    expect(review).toContain("Local copies differ between agents");
    expect(review).toMatch(/diff shown against (claude-code|codex)\./);
  });

  it("a first install summarizes files instead of dumping full source", () => {
    const review = renderUpdateReview({
      prev: {},
      next: {
        "SKILL.md": Buffer.from("---\nname: x\n---\nsecret sauce line\n"),
        "commands/build.md": Buffer.from("a\nb\nc\n"),
      },
      adapterNames: ["claude-code"],
    });
    expect(review).toContain("SKILL.md (5 lines)");
    expect(review).toContain("commands/build.md (4 lines)");
    // The body itself never appears — reviewing a new skill means seeing its
    // shape, not scrolling its source.
    expect(review).not.toContain("secret sauce line");
    expect(review).not.toContain("+++");
  });

  it("stays quiet about agents when identical, and diffs bundle-relative paths", () => {
    const review = renderUpdateReview({
      prev: { "claude-code/SKILL.md": Buffer.from("hello\nold line\n") },
      next: NEXT,
      adapterNames: ["claude-code"],
    });
    expect(review).toContain("Updates claude-code");
    expect(review).not.toContain("Local copies differ");
    expect(review).toContain("SKILL.md");
    expect(review).not.toContain("claude-code/SKILL.md");
  });
});
