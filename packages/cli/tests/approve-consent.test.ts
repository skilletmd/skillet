// Behavioral guard for the quarantined-`approve` refusal (cross-model P1 +
// testing P1): the non-interactive verb must refuse BEFORE recording the
// approval — a recorded approval hides the entry from every review surface —
// and must write nothing to any agent.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.cjs");

function seedQuarantined(): { env: Record<string, string>; home: string; slug: string } {
  const home = mkdtempSync(join(tmpdir(), "skillet-approve-consent-"));
  const skilletDir = join(home, ".skillet");
  const slug = "spooky-skill";
  const content = "---\nname: spooky\n---\n# spooky\n";
  mkdirSync(join(skilletDir, "skills", slug), { recursive: true });
  writeFileSync(join(skilletDir, "skills", slug, "SKILL.md"), content);
  // canonical hash shape mirrors core: sha256 over "SKILL.md\0<bytes>"-style
  // canonicalization; the exact value doesn't matter for this test since the
  // quarantine refusal fires before any hash verification.
  const hash = "sha256:" + createHash("sha256").update(content).digest("hex");
  const now = new Date().toISOString();
  const state = {
    version: 1,
    skills: {
      [slug]: {
        slug,
        name: slug,
        description: "",
        version: 1,
        hash,
        source: "local",
        sourceKit: "@test/kit",
        importedAt: now,
        updatedAt: now,
        scan: {
          status: "quarantined",
          findings_summary: {
            total: 1,
            counts: { destructive: { high: 1 } },
            topConfidence: "high",
            highlights: [
              { category: "destructive", confidence: "high", file: "x.sh", why: "destructive:rm-rf-root" },
            ],
          },
        },
      },
    },
  };
  writeFileSync(join(skilletDir, "state.json"), JSON.stringify(state));
  const env: Record<string, string> = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    SKILLET_DIR: skilletDir,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
  } as Record<string, string>;
  delete env["SKILLET_TOKEN"];
  delete env["SKILLET_REGISTRY_URL"];
  delete env["SKILLET_WEB_URL"];
  return { env, home, slug };
}

test("approve on a quarantined entry refuses, records nothing, writes nothing", () => {
  const { env, home, slug } = seedQuarantined();
  const res = spawnSync(process.execPath, [CLI, "approve", slug], { encoding: "utf8", env });

  if (process.platform !== "win32") assert.equal(res.status, 1);
  assert.match(res.stderr, /quarantined and was not approved or applied/);
  // Findings summary rendered before the refusal (informed refusal).
  assert.match(res.stdout, /QUARANTINED|destructive/);
  // No approval recorded anywhere under the sandbox: a recorded approval
  // would hide the entry from `pending` and the menu (the stranding bug).
  const lockCandidates = [
    join(home, ".local", "share", "skillet", "skillet.lock"),
    join(home, ".skillet", "skillet.lock"),
  ];
  for (const lock of lockCandidates) {
    if (existsSync(lock)) {
      assert.doesNotMatch(readFileSync(lock, "utf8"), new RegExp(slug));
    }
  }
  // Nothing materialized into any agent dir.
  assert.equal(existsSync(join(home, ".agents", "skills", slug)), false);
  assert.equal(existsSync(join(home, ".claude", "skills", slug)), false);
});

test("source shape: the quarantine refusal precedes approveUpdate", () => {
  const src = readFileSync(join(__dirname, "..", "src", "commands", "pending.ts"), "utf8");
  const refusalIdx = src.indexOf("requiresQuarantineConsent(entryNow.scan)");
  const approveIdx = src.indexOf("await approveUpdate(slug, version");
  assert.ok(refusalIdx >= 0 && approveIdx >= 0 && refusalIdx < approveIdx);
});
