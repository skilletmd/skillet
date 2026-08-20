// Reconcile/prune — skills that left your kits are moved to trash, with the
// safety fences: Skillet-owned only, never your edits (the edit fence is
// PASSIVE per KTD7: a customized/edited skill is kept on disk and converted to
// a plain local skill — never trashed, never forked), authoritative only.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { symlinksAvailable } from "./symlink-support.js";
import { mkdir, mkdtemp, writeFile, rm, readFile, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect SKILLET_DIR BEFORE @skillet/core loads so the skill store's cached
// dir (kit/store.ts captures SKILLET_DIR once at import) lands in an isolated
// temp tree — the F4 localize path writes the live edit into the store, which
// must never touch the real ~/.skillet.
const HOME_ROOT = vi.hoisted(() => {
  const { redirectHome } = require("./helpers/redirect-home.cjs");
  return redirectHome("skillet-prune-reconcile");
});
const HOME_SKILLET = join(HOME_ROOT, ".skillet");

import { canonicalContentHash } from "@skillet/protocol";
import { readBundleFromDir } from "../src/bundle/read.js";
import { reconcilePrune, zeroOutAllowed } from "../src/commands/sync.js";
import { readBundleFromSkillStore } from "../src/kit/store.js";
import type { Adapter } from "../src/adapter.js";
import type { KitState, SkillEntry } from "../src/kit/types.js";

let root: string; // fake adapter root
let home: string; // SKILLET_DIR (trash + skill store land here)

// A verbatim global adapter (Claude-style): on-disk bytes == the bundle.
const adapter = (name = "claude", base = (): string => root): Adapter =>
  ({
    name,
    kind: "global",
    // Real adapters keep every skill dir under targetDir; reconcilePrune's
    // per-adapter TCC park assessment keys on it, so the stub must agree
    // with targetSkillDir (base()), not always the default root.
    targetDir: base(),
    detect: async () => true,
    materialize: async () => [],
    targetSkillDir: (slug: string, opts?: { owner?: string | null }) =>
      join(base(), `${opts?.owner ?? "_local"}--${slug}`),
  }) as unknown as Adapter;

// A project-scoped adapter (Cursor/Windsurf/Devin style). Prune skips these
// entirely — their copies live in the user's repo and are never pruned.
const projectAdapter = (): Adapter =>
  ({
    name: "cursor",
    kind: "project",
    targetDir: ".cursor",
    detect: async () => true,
    materialize: async () => [],
    targetSkillDir: () => {
      throw new Error("cwd is required for project-scoped targetSkillDir");
    },
  }) as unknown as Adapter;

// A GLOBAL adapter whose targetSkillDir throws — must be caught (unverifiable),
// never fatal to the whole sync.
const throwingGlobalAdapter = (): Adapter =>
  ({
    name: "broken",
    kind: "global",
    targetDir: "/broken",
    detect: async () => true,
    materialize: async () => [],
    targetSkillDir: () => {
      throw new Error("boom");
    },
  }) as unknown as Adapter;

/** Write a one-file bundle on disk and return its canonical hash. */
async function writeBundle(dir: string, body: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), body);
  const bundle = await readBundleFromDir(dir);
  return canonicalContentHash(bundle);
}

function entry(over: Partial<SkillEntry>): SkillEntry {
  return {
    slug: "x",
    name: "x",
    description: "",
    version: 1,
    hash: "sha256:0",
    source: "registry",
    importedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("reconcilePrune", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "skillet-adapters-"));
    // Use the SAME dir the store cached at import (HOME_SKILLET), recreated per
    // test, so the store const and the dynamic skilletDir() (trash) agree.
    home = HOME_SKILLET;
    process.env["SKILLET_DIR"] = home;
    // The TCC policy is macOS-only; force it on so the U2 decoy-Documents
    // scenario parks anywhere.
    process.env["SKILLET_TCC_POLICY"] = "force";
    await rm(home, { recursive: true, force: true });
    await mkdir(home, { recursive: true });
  });
  afterEach(async () => {
    delete process.env["SKILLET_TCC_POLICY"];
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it("trashes a kit skill that left the manifest, keeps one that stayed", async () => {
    const dropHash = await writeBundle(join(root, "alice--drop"), "# drop\nsynced bytes\n");
    await writeBundle(join(root, "alice--keep"), "# keep\n");

    const state: KitState = {
      version: 1,
      skills: {
        "@alice/drop": entry({ slug: "@alice/drop", owner: "alice", sourceKit: "@alice/kit", hash: dropHash }),
        "@alice/keep": entry({ slug: "@alice/keep", owner: "alice", sourceKit: "@alice/kit" }),
      },
    };

    const res = await reconcilePrune(state, new Set(["@alice/keep"]), [adapter()]);

    expect(res.pruned.map((p) => p.slug)).toEqual(["@alice/drop"]);
    expect(state.skills["@alice/drop"]).toBeUndefined();
    expect(state.skills["@alice/keep"]).toBeDefined();
    // moved off the adapter root, into trash
    expect(await exists(join(root, "alice--drop"))).toBe(false);
    expect(res.trashDir).toBeTruthy();
    expect(await exists(join(res.trashDir!, "claude", "alice--drop", "SKILL.md"))).toBe(true);
    // a restorable ledger is written
    const ledger = JSON.parse(await readFile(join(res.trashDir!, "manifest.json"), "utf8"));
    expect(ledger.items[0].slug).toBe("@alice/drop");
  });

  it("prunes a registry-sourced bare-key ghost whose tail no served ref matches", async () => {
    // The ghost-twin shape: import → upload converts the entry to registry
    // source but a bare key survives (or import re-creates it); upstream is
    // later deleted. No manifest ref will ever match a bare key, so without
    // the tail check the ghost lives forever.
    const ghostHash = await writeBundle(join(root, "alice--ghost-skill"), "# ghost\nsynced bytes\n");

    const state: KitState = {
      version: 1,
      skills: {
        "ghost-skill": entry({ slug: "ghost-skill", owner: "alice", sourceKit: "@alice/kit", hash: ghostHash }),
        "@alice/keep": entry({ slug: "@alice/keep", owner: "alice", sourceKit: "@alice/kit" }),
      },
    };

    const res = await reconcilePrune(state, new Set(["@alice/keep"]), [adapter()]);

    expect(res.pruned.map((p) => p.slug)).toEqual(["ghost-skill"]);
    expect(state.skills["ghost-skill"]).toBeUndefined();
    expect(await exists(join(root, "alice--ghost-skill"))).toBe(false);
  })

  it("keeps a bare-key alias whose canonical ref is still served", async () => {
    await writeBundle(join(root, "aliased"), "# aliased\n");

    const state: KitState = {
      version: 1,
      skills: {
        aliased: entry({ slug: "aliased", owner: "alice", sourceKit: "@alice/kit" }),
        "@alice/aliased": entry({ slug: "@alice/aliased", owner: "alice", sourceKit: "@alice/kit" }),
      },
    };

    const res = await reconcilePrune(state, new Set(["@alice/aliased"]), [adapter()]);

    expect(res.pruned).toEqual([]);
    expect(state.skills["aliased"]).toBeDefined();
    expect(await exists(join(root, "aliased", "SKILL.md"))).toBe(true);
  })

  it("R5: holds a manifest-absent skill whose kit-removal is undecided on the web", async () => {
    const dropHash = await writeBundle(join(root, "alice--drop"), "# drop\nsynced bytes\n");

    const state: KitState = {
      version: 1,
      skills: {
        "@alice/drop": entry({ slug: "@alice/drop", owner: "alice", sourceKit: "@alice/kit", hash: dropHash }),
        "@alice/keep": entry({ slug: "@alice/keep", owner: "alice", sourceKit: "@alice/kit" }),
      },
    };

    const res = await reconcilePrune(state, new Set(["@alice/keep"]), [adapter()], {
      holdRefs: new Set(["@alice/drop"]),
    });

    // Nothing pruned, nothing localized: the skill stays in state and on disk
    // until the user decides Remove vs Keep on the web.
    expect(res.pruned).toEqual([]);
    expect(res.localized).toEqual([]);
    expect(state.skills["@alice/drop"]).toBeDefined();
    expect(await exists(join(root, "alice--drop", "SKILL.md"))).toBe(true);
    expect(res.trashDir).toBeNull();
  });

  it("never deletes an edited copy — keeps the bytes and converts it to a plain local skill (KTD7)", async () => {
    await writeBundle(join(root, "bob--edited"), "# edited by the user locally\n");
    const state: KitState = {
      version: 1,
      skills: {
        // entry.hash deliberately ≠ the on-disk hash → looks edited
        "@bob/edited": entry({ slug: "@bob/edited", owner: "bob", sourceKit: "@bob/kit", hash: "sha256:stale" }),
      },
    };

    // Non-empty manifest (some other kit still synced) so the mass-removal
    // guard doesn't short-circuit; @bob/edited just isn't in it.
    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter()]);

    expect(res.pruned).toEqual([]);
    expect(res.localized.map((k) => k.slug)).toEqual(["@bob/edited"]);
    // The entry STAYS but is now a plain local skill — subscription linkage
    // dropped, bytes untouched, never trashed.
    const kept = state.skills["@bob/edited"];
    expect(kept).toBeDefined();
    expect(kept!.source).toBe("local");
    expect(kept!.sourceKit).toBeUndefined();
    expect(kept!.customized_from).toBeUndefined();
    expect(kept!.held_update).toBeUndefined();
    expect(await readFile(join(root, "bob--edited", "SKILL.md"), "utf8")).toBe(
      "# edited by the user locally\n",
    );
  });

  it("a customized skill that unsubscribes is kept on disk as a local skill (no edit needed on the disk copy)", async () => {
    // The on-disk copy matches entry.hash (not itself edited), but the entry is
    // flagged customized_from — leaving the manifest still localizes it.
    const h = await writeBundle(join(root, "bob--fav"), "# a customized skill\n");
    const state: KitState = {
      version: 1,
      skills: {
        "@bob/fav": entry({
          slug: "@bob/fav",
          owner: "bob",
          sourceKit: "@bob/kit",
          hash: h,
          customized_from: { author: "bob", slug: "@bob/fav", version: 1, hash: "sha256:base" },
          held_update: { version: 2, hash: "sha256:new" },
        }),
      },
    };

    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter()]);

    expect(res.pruned).toEqual([]);
    expect(res.localized.map((k) => k.slug)).toEqual(["@bob/fav"]);
    const kept = state.skills["@bob/fav"];
    expect(kept!.source).toBe("local");
    expect(kept!.customized_from).toBeUndefined();
    expect(kept!.held_update).toBeUndefined();
    expect(await exists(join(root, "bob--fav"))).toBe(true);
  });

  it("F1-prune: an unsubscribe racing an update PRUNES, does not localize a phantom local skill", async () => {
    // A pull persisted a NEW hash (entry.hash) but its materialize never landed,
    // so disk still holds the OLD author bytes we last materialized. The drift
    // baseline is materialized_hash (what's on disk), NOT entry.hash — so the
    // still-current author bytes are seen as clean/movable and the skill prunes
    // instead of localizing into a phantom local skill.
    const onDiskHash = await writeBundle(join(root, "eve--race"), "# last materialized author bytes\n");
    const state: KitState = {
      version: 1,
      skills: {
        "@eve/race": entry({
          slug: "@eve/race",
          owner: "eve",
          sourceKit: "@eve/kit",
          hash: "sha256:persisted-but-unmaterialized", // pull advanced this
          materialized_hash: onDiskHash, // what actually landed on disk
        }),
      },
    };

    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter()]);

    // Pruned (trashed), NOT localized — no phantom local skill.
    expect(res.localized).toEqual([]);
    expect(res.pruned.map((p) => p.slug)).toEqual(["@eve/race"]);
    expect(state.skills["@eve/race"]).toBeUndefined();
    expect(await exists(join(root, "eve--race"))).toBe(false);
  });

  it("RF5: a LEGACY entry (no materialized_hash) racing an update prunes via the pre-pull snapshot, not localize", async () => {
    // Same race as F1-prune, but the entry predates materialized_hash. Without the
    // pre-pull-snapshot fallback the baseline would be the just-advanced entry.hash,
    // so the last-materialized author bytes read as an "edit" and localize a phantom
    // local skill. Threading prePullSnapshots baselines on what was actually on disk.
    const onDiskHash = await writeBundle(join(root, "eve--legacy"), "# last materialized author bytes\n");
    const state: KitState = {
      version: 1,
      skills: {
        "@eve/legacy": entry({
          slug: "@eve/legacy",
          owner: "eve",
          sourceKit: "@eve/kit",
          hash: "sha256:persisted-but-unmaterialized", // pull advanced this
          // NOTE: no materialized_hash — a legacy entry.
        }),
      },
    };
    const prePullSnapshots = new Map([["@eve/legacy", { hash: onDiskHash, version: 1 }]]);

    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter()], {
      prePullSnapshots,
    });

    // Pruned (trashed), NOT localized — the pre-pull snapshot made the on-disk
    // bytes read as clean/movable.
    expect(res.localized).toEqual([]);
    expect(res.pruned.map((p) => p.slug)).toEqual(["@eve/legacy"]);
    expect(state.skills["@eve/legacy"]).toBeUndefined();
    expect(await exists(join(root, "eve--legacy"))).toBe(false);
  });

  it("RF5: without the pre-pull snapshot the SAME legacy entry would localize a phantom (proves the fallback matters)", async () => {
    const onDiskHash = await writeBundle(join(root, "eve--legacy2"), "# last materialized author bytes\n");
    void onDiskHash;
    const state: KitState = {
      version: 1,
      skills: {
        "@eve/legacy2": entry({
          slug: "@eve/legacy2",
          owner: "eve",
          sourceKit: "@eve/kit",
          hash: "sha256:persisted-but-unmaterialized",
        }),
      },
    };

    // No prePullSnapshots → baseline falls to entry.hash → on-disk mismatches → edited → localize.
    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter()]);

    expect(res.pruned).toEqual([]);
    expect(res.localized.map((k) => k.slug)).toEqual(["@eve/legacy2"]);
  });

  it("F4: localizing an edited skill imports the live edited bytes into the store + updates hash", async () => {
    const editedBody =
      "---\nname: renamed-by-user\ndescription: user desc\n---\n# edited synced copy\n";
    await writeBundle(join(root, "bob--edited"), editedBody);
    const editedHash = canonicalContentHash(
      await readBundleFromDir(join(root, "bob--edited")),
    );
    const state: KitState = {
      version: 1,
      skills: {
        "@bob/edited": entry({
          slug: "@bob/edited",
          owner: "bob",
          sourceKit: "@bob/kit",
          name: "old-name",
          description: "old desc",
          hash: "sha256:stale", // store points at old author bytes
        }),
      },
    };

    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter()]);

    expect(res.localized.map((k) => k.slug)).toEqual(["@bob/edited"]);
    const kept = state.skills["@bob/edited"]!;
    expect(kept.source).toBe("local");
    // hash + name + description are aligned to the imported live edit.
    expect(kept.hash).toBe(editedHash);
    expect(kept.name).toBe("renamed-by-user");
    expect(kept.description).toBe("user desc");
    // The store now holds the edited bytes (not the stale author bytes).
    const stored = await readBundleFromSkillStore("@bob/edited");
    expect(canonicalContentHash(stored)).toBe(editedHash);
  });

  it("F4: a customized skill with NO readable live tree is kept managed, not a phantom local", async () => {
    // customized_from is set but there is no on-disk copy to import → keep the
    // skill managed (unverifiable) rather than mint a phantom local skill whose
    // store points at stale author bytes.
    const state: KitState = {
      version: 1,
      skills: {
        "@bob/ghost": entry({
          slug: "@bob/ghost",
          owner: "bob",
          sourceKit: "@bob/kit",
          hash: "sha256:stale",
          customized_from: { author: "bob", slug: "@bob/ghost", version: 1, hash: "sha256:base" },
        }),
      },
    };

    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter()]);

    expect(res.pruned).toEqual([]);
    expect(res.localized).toEqual([]);
    // Kept managed — still a registry entry, markers intact.
    const kept = state.skills["@bob/ghost"]!;
    expect(kept.source).toBe("registry");
    expect(kept.customized_from).toBeTruthy();
  });

  it("localize with a slug-colliding unrelated local skill — both survive (no clobber)", async () => {
    // An unrelated LOCAL skill whose base name collides with the edited one.
    const localHash = await writeBundle(join(root, "_local--edited"), "# my own unrelated skill\n");
    await writeBundle(join(root, "bob--edited"), "# edited synced copy\n");
    const state: KitState = {
      version: 1,
      skills: {
        edited: entry({ slug: "edited", source: "local", hash: localHash }),
        "@bob/edited": entry({ slug: "@bob/edited", owner: "bob", sourceKit: "@bob/kit", hash: "sha256:stale" }),
      },
    };

    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter()]);

    expect(res.localized.map((k) => k.slug)).toEqual(["@bob/edited"]);
    // The unrelated local skill is untouched — no key collision, no clobber.
    expect(state.skills["edited"]).toBeDefined();
    expect(state.skills["edited"]!.source).toBe("local");
    expect(await readFile(join(root, "_local--edited", "SKILL.md"), "utf8")).toBe(
      "# my own unrelated skill\n",
    );
    // The localized copy also survives on disk, keyed under its @owner/slug key.
    expect(state.skills["@bob/edited"]!.source).toBe("local");
    expect(await exists(join(root, "bob--edited"))).toBe(true);
  });

  it("never touches local, pinned, or directly-added (no sourceKit) skills", async () => {
    const localHash = await writeBundle(join(root, "_local--mine"), "# mine\n");
    const pinnedHash = await writeBundle(join(root, "carol--pinned"), "# pinned\n");
    const directHash = await writeBundle(join(root, "dave--direct"), "# direct\n");

    const state: KitState = {
      version: 1,
      skills: {
        "mine": entry({ slug: "mine", source: "local", hash: localHash }),
        "@carol/pinned": entry({ slug: "@carol/pinned", owner: "carol", sourceKit: "@carol/kit", pinned: true, hash: pinnedHash }),
        "@dave/direct": entry({ slug: "@dave/direct", owner: "dave", hash: directHash }), // no sourceKit
      },
    };

    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter()]);

    expect(res.pruned).toEqual([]);
    expect(res.localized).toEqual([]);
    expect(Object.keys(state.skills).sort()).toEqual(["@carol/pinned", "@dave/direct", "mine"]);
    expect((await readdir(root)).sort()).toEqual(["_local--mine", "carol--pinned", "dave--direct"]);
  });

  it("empty manifest is ignored when zero-out is not allowed (default)", async () => {
    const h = await writeBundle(join(root, "alice--a"), "# a\n");
    const state: KitState = {
      version: 1,
      skills: {
        "@alice/a": entry({ slug: "@alice/a", owner: "alice", sourceKit: "@alice/kit", hash: h }),
      },
    };

    const res = await reconcilePrune(state, new Set(), [adapter()]); // allowZeroOut defaults false

    expect(res.pruned).toEqual([]);
    expect(state.skills["@alice/a"]).toBeDefined();
    expect(await exists(join(root, "alice--a"))).toBe(true);
  });

  it("empty manifest zeroes the machine out for an account-bound caller", async () => {
    const h = await writeBundle(join(root, "alice--a"), "# a\n");
    const state: KitState = {
      version: 1,
      skills: {
        "@alice/a": entry({ slug: "@alice/a", owner: "alice", sourceKit: "@alice/kit", hash: h }),
      },
    };

    // Session token → account-bound → "routed off every kit" is honored.
    const res = await reconcilePrune(state, new Set(), [adapter()], { allowZeroOut: true });

    expect(res.pruned.map((p) => p.slug)).toEqual(["@alice/a"]);
    expect(state.skills["@alice/a"]).toBeUndefined();
    expect(await exists(join(root, "alice--a"))).toBe(false);
    expect(res.trashDir).toBeTruthy();
  });

  it("skips project-scoped adapters entirely — never scans or prunes repo copies", async () => {
    const h = await writeBundle(join(root, "alice--x"), "# x\n");
    const state: KitState = {
      version: 1,
      skills: {
        "@alice/x": entry({ slug: "@alice/x", owner: "alice", sourceKit: "@alice/kit", hash: h }),
      },
    };

    // The project adapter (whose targetSkillDir throws) must never be called, so
    // it neither crashes nor blocks pruning of the global copy.
    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter(), projectAdapter()]);

    expect(res.pruned.map((p) => p.slug)).toEqual(["@alice/x"]); // global copy pruned
    expect(state.skills["@alice/x"]).toBeUndefined();
    expect(await exists(join(root, "alice--x"))).toBe(false);
  });

  it("a global adapter that throws on resolve is unverifiable — kept, not fatal", async () => {
    const h = await writeBundle(join(root, "alice--x"), "# x\n");
    const state: KitState = {
      version: 1,
      skills: {
        "@alice/x": entry({ slug: "@alice/x", owner: "alice", sourceKit: "@alice/kit", hash: h }),
      },
    };

    // A clean global copy + a throwing global adapter → unverifiable → keep.
    const res = await reconcilePrune(state, new Set(["@other/keep"]), [adapter(), throwingGlobalAdapter()]);

    expect(res.pruned).toEqual([]);
    expect(state.skills["@alice/x"]).toBeDefined();
    expect(await exists(join(root, "alice--x"))).toBe(true);
  });

  it("an unreadable/transformed adapter copy keeps the skill — no orphaned files", async () => {
    const root2 = await mkdtemp(join(tmpdir(), "skillet-cursor-"));
    try {
      const cleanHash = await writeBundle(join(root, "alice--x"), "# x\n");
      // Cursor-style copy: dir exists but no SKILL.md at root → readBundleFromDir throws.
      await mkdir(join(root2, "alice--x"), { recursive: true });
      await writeFile(join(root2, "alice--x", "x.mdc"), "transformed\n");

      const state: KitState = {
        version: 1,
        skills: {
          "@alice/x": entry({ slug: "@alice/x", owner: "alice", sourceKit: "@alice/kit", hash: cleanHash }),
        },
      };

      const res = await reconcilePrune(
        state,
        new Set(["@other/keep"]),
        [adapter("claude"), adapter("cursor", () => root2)],
      );

      // Unverifiable copy → keep everything. The clean copy is NOT trashed (no orphan).
      expect(res.pruned).toEqual([]);
      expect(state.skills["@alice/x"]).toBeDefined();
      expect(await exists(join(root, "alice--x", "SKILL.md"))).toBe(true);
      expect(await exists(join(root2, "alice--x", "x.mdc"))).toBe(true);
    } finally {
      await rm(root2, { recursive: true, force: true });
    }
  });

  it.skipIf(!symlinksAvailable)("U2: a live copy in a PARKED root (resolves into ~/Documents) is kept, never pruned", async () => {
    // Root symlinked into a decoy Documents under the hermetic HOME. The copy
    // is real and unedited, but the policy forbids reading it — parked maps to
    // present-but-unverifiable, so an unsubscribe must keep the skill whole.
    const { symlink } = await import("node:fs/promises");
    const decoy = join(HOME_ROOT, "Documents", "claude-decoy");
    const dropHash = await writeBundle(join(decoy, "alice--drop"), "# drop\nsynced bytes\n");
    const parkedRoot = join(HOME_ROOT, ".claude-parked");
    await symlink(decoy, parkedRoot);

    const state: KitState = {
      version: 1,
      skills: {
        "@alice/drop": entry({ slug: "@alice/drop", owner: "alice", sourceKit: "@alice/kit", hash: dropHash }),
      },
    };

    const res = await reconcilePrune(
      state,
      new Set(["@alice/keep"]),
      [adapter("claude", () => parkedRoot)],
    );

    expect(res.pruned).toEqual([]);
    expect(res.localized).toEqual([]);
    expect(state.skills["@alice/drop"]).toBeDefined();
    expect(await exists(join(decoy, "alice--drop", "SKILL.md"))).toBe(true);
  });

  it("trashes every copy of a skill present in multiple adapters, then drops state", async () => {
    const root2 = await mkdtemp(join(tmpdir(), "skillet-codex-"));
    try {
      const h = await writeBundle(join(root, "alice--x"), "# x\n");
      await writeBundle(join(root2, "alice--x"), "# x\n"); // same bytes → same hash

      const state: KitState = {
        version: 1,
        skills: {
          "@alice/x": entry({ slug: "@alice/x", owner: "alice", sourceKit: "@alice/kit", hash: h }),
        },
      };

      const res = await reconcilePrune(
        state,
        new Set(["@other/keep"]),
        [adapter("claude"), adapter("codex", () => root2)],
      );

      expect(res.pruned.map((p) => p.slug)).toEqual(["@alice/x"]);
      expect(res.pruned[0].adapters.sort()).toEqual(["claude", "codex"]);
      expect(state.skills["@alice/x"]).toBeUndefined();
      expect(await exists(join(root, "alice--x"))).toBe(false);
      expect(await exists(join(root2, "alice--x"))).toBe(false);
    } finally {
      await rm(root2, { recursive: true, force: true });
    }
  });
});

describe("zeroOutAllowed", () => {
  it("server says 'user' → allowed (a bound device can zero out)", () => {
    expect(zeroOutAllowed("user", "device")).toBe(true);
    expect(zeroOutAllowed("user", "session")).toBe(true);
  });

  it("unrecognized scope → never (fail-safe against older registries)", () => {
    // TS no longer admits 'anonymous', but account_scope is unvalidated JSON:
    // an OLDER self-hosted registry can still send it (or any future string)
    // at runtime. An empty manifest with an unknown scope must never wipe
    // local skills — even with a device token.
    expect(zeroOutAllowed("anonymous", "device")).toBe(false);
    expect(zeroOutAllowed("anonymous", "session")).toBe(false);
    expect(zeroOutAllowed("some-future-scope", "session")).toBe(false);
  });

  it("old server omits the field → session-only fallback", () => {
    expect(zeroOutAllowed(undefined, "session")).toBe(true);
    expect(zeroOutAllowed(undefined, "device")).toBe(false);
    expect(zeroOutAllowed(undefined, "kit")).toBe(false);
  });
});
