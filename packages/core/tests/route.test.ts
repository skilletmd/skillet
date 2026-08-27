import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const TEST_ROOT = vi.hoisted(() => {
  const osMod = require("node:os") as typeof import("node:os");
  const cryptoMod = require("node:crypto") as typeof import("node:crypto");
  const pathMod = require("node:path") as typeof import("node:path");
  const root = pathMod.join(
    osMod.tmpdir(),
    `skillet-route-test-${cryptoMod.randomBytes(4).toString("hex")}`,
  );
  process.env["HOME"] = root;
  process.env["SKILLET_DIR"] = pathMod.join(root, ".skillet");
  return root;
});

import {
  BUNDLED_ROUTE_SLUG,
  BUNDLED_CREATE_SLUG,
  listRouteManifest,
  resolveRouteBody,
  recordRouteInvocation,
  recordSkillRoute,
  RouteSkillError,
  skillRefFromEntry,
} from "../src/commands/route.js";
import { readState, skillContentPath, upsertSkill } from "../src/kit/store.js";
import type { SkillEntry } from "../src/kit/types.js";

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`;
}

async function seedSkill(
  slug: string,
  entry: Partial<SkillEntry> & Pick<SkillEntry, "name" | "description">,
): Promise<void> {
  const dir = join(TEST_ROOT, ".skillet", "skills", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd(entry.name, entry.description));
  const now = new Date().toISOString();
  await upsertSkill({
    slug,
    name: entry.name,
    description: entry.description,
    version: 1,
    hash: `sha256:${slug}-test`,
    source: entry.source ?? "local",
    importedAt: now,
    updatedAt: now,
    owner: entry.owner,
  });
}

/** A skill materialized into the store with no kit-state entry, as authored skills are. */
async function seedStoreOnlySkill(
  slug: string,
  name: string,
  description: string,
): Promise<void> {
  const dir = join(TEST_ROOT, ".skillet", "skills", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd(name, description));
}

describe("skillRefFromEntry", () => {
  it("builds @owner/slug when owner is set", () => {
    expect(
      skillRefFromEntry({
        slug: "the-lazy-dm",
        owner: "thiago",
        name: "lazy",
        description: "",
        version: 1,
        hash: "x",
        source: "local",
        importedAt: "",
        updatedAt: "",
      }),
    ).toBe("@thiago/the-lazy-dm");
  });
});

describe("listRouteManifest", () => {
  beforeEach(async () => {
    await mkdir(join(TEST_ROOT, ".skillet", "skills"), { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("returns routable kit skills excluding the bundled meta-skill", async () => {
    await seedSkill(BUNDLED_ROUTE_SLUG, {
      name: "skillet",
      description: "meta",
      owner: "skillet",
    });
    await seedSkill("@thiago/the-lazy-dm", {
      name: "The Lazy DM",
      description: "RPG prep",
      owner: "thiago",
    });

    const manifest = await listRouteManifest();
    expect(manifest).toHaveLength(1);
    expect(manifest[0]?.skillRef).toBe("@thiago/the-lazy-dm");
    expect(manifest[0]?.path).toBe(skillContentPath("@thiago/the-lazy-dm"));
  });

  it("covers AE4: empty kit returns an empty manifest", async () => {
    expect(await listRouteManifest()).toEqual([]);
  });

  // U10 / R18. Authored skills are materialized into the store without ever
  // getting a state entry, so a state-only manifest was blind to the user's own
  // work and `/skillet` whiffed to the library while the match sat on disk.
  it("covers AE13: includes a store skill kit state never recorded", async () => {
    await seedStoreOnlySkill("@taylor/gtm-ui", "gtm-ui", "Build sites with Taylor's craft");

    const manifest = await listRouteManifest();
    expect(manifest.map((e) => e.skillRef)).toEqual(["@taylor/gtm-ui"]);
    expect(manifest[0]?.name).toBe("gtm-ui");
    expect(manifest[0]?.description).toBe("Build sites with Taylor's craft");
    expect(manifest[0]?.owner).toBe("taylor");
    expect(manifest[0]?.path).toBe(skillContentPath("@taylor/gtm-ui"));
  });

  it("lists a skill once, preferring kit-state metadata over the store copy", async () => {
    await seedSkill("@thiago/the-lazy-dm", {
      name: "The Lazy DM",
      description: "RPG prep",
      owner: "thiago",
    });

    const manifest = await listRouteManifest();
    expect(manifest).toHaveLength(1);
    expect(manifest[0]?.name).toBe("The Lazy DM");
    expect(manifest[0]?.description).toBe("RPG prep");
  });

  it("still skips a state entry whose content path is missing", async () => {
    await seedSkill("@thiago/the-lazy-dm", {
      name: "The Lazy DM",
      description: "RPG prep",
      owner: "thiago",
    });
    await rm(join(TEST_ROOT, ".skillet", "skills", "@thiago", "the-lazy-dm"), {
      recursive: true,
      force: true,
    });

    expect(await listRouteManifest()).toEqual([]);
  });

  it("excludes both bundled meta-skills found only on disk", async () => {
    await seedStoreOnlySkill(BUNDLED_ROUTE_SLUG, "skillet", "router");
    await seedStoreOnlySkill(BUNDLED_CREATE_SLUG, "skillet-create", "authoring");
    await seedStoreOnlySkill("@taylor/gtm-ui", "gtm-ui", "craft");

    const manifest = await listRouteManifest();
    expect(manifest.map((e) => e.skillRef)).toEqual(["@taylor/gtm-ui"]);
  });

  it("routes an unowned bare-slug store skill", async () => {
    await seedStoreOnlySkill("screenshot-critique", "screenshot-critique", "critique a UI shot");

    const manifest = await listRouteManifest();
    expect(manifest.map((e) => e.skillRef)).toEqual(["screenshot-critique"]);
    expect(manifest[0]?.owner).toBeNull();
  });

  it("keeps a kit of only authored skills out of the empty-kit path", async () => {
    for (const slug of ["@taylor/a-skill", "@taylor/b-skill", "@taylor/c-skill"]) {
      await seedStoreOnlySkill(slug, slug.split("/")[1]!, "authored");
    }

    const manifest = await listRouteManifest();
    expect(manifest).toHaveLength(3);
  });

  it("leaves alphabetical ordering unchanged for skills state already carried", async () => {
    await seedSkill("@thiago/zeta", { name: "Zeta", description: "z", owner: "thiago" });
    await seedSkill("@thiago/alpha", { name: "Alpha", description: "a", owner: "thiago" });

    const manifest = await listRouteManifest();
    expect(manifest.map((e) => e.skillRef)).toEqual(["@thiago/alpha", "@thiago/zeta"]);
  });
});

describe("recordSkillRoute", () => {
  let events: Array<{ name: string; meta?: Record<string, string> }>;

  beforeEach(async () => {
    events = [];
    vi.spyOn(await import("../src/metrics.js"), "recordEvent").mockImplementation(
      (name, _initiator, meta) => {
        events.push({ name, meta: meta as Record<string, string> | undefined });
      },
    );
    await mkdir(join(TEST_ROOT, ".skillet", "skills"), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("uploads skill.route with skill_ref metadata for a registry skill", async () => {
    await seedSkill("@thiago/the-lazy-dm", {
      name: "The Lazy DM",
      description: "RPG prep",
      owner: "thiago",
      source: "registry", // only registry (already-public) skills upload their ref
    });

    const result = await recordSkillRoute("@thiago/the-lazy-dm");
    expect(result.skillRef).toBe("@thiago/the-lazy-dm");
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("skill.route");
    expect(events[0]?.meta?.skill_ref).toBe("@thiago/the-lazy-dm");
    // Rationale is never sent to telemetry — the record is the skill ref only.
    expect(events[0]?.meta?.rationale).toBeUndefined();
  });

  it("does not upload a skill.route event for a local-only skill", async () => {
    await seedSkill("@thiago/private-thing", {
      name: "Private",
      description: "local only",
      owner: "thiago",
      source: "local",
    });
    const result = await recordSkillRoute("@thiago/private-thing");
    expect(result.skillRef).toBe("@thiago/private-thing");
    expect(events.filter((e) => e.name === "skill.route")).toHaveLength(0);
  });

  it("throws skill_not_in_kit for unknown refs", async () => {
    await seedSkill("only-skill", { name: "Only", description: "one" });
    await expect(recordSkillRoute("@missing/skill")).rejects.toMatchObject({
      code: "skill_not_in_kit",
    });
  });

  it("covers AE4: throws kit_empty when the kit has no skills", async () => {
    await expect(recordSkillRoute("@thiago/the-lazy-dm")).rejects.toBeInstanceOf(
      RouteSkillError,
    );
    const state = await readState();
    expect(Object.keys(state.skills)).toHaveLength(0);
  });
});

describe("recordRouteInvocation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records skill.route.invoke with metadata only", async () => {
    const events: Array<{ name: string; meta?: Record<string, string> }> = [];
    vi.spyOn(await import("../src/metrics.js"), "recordEvent").mockImplementation(
      (name, _initiator, meta) => {
        events.push({ name, meta: meta as Record<string, string> | undefined });
      },
    );

    const result = recordRouteInvocation({
      runtime: "Cursor",
      source: "cursor-hook",
      surface: "UserPromptSubmit",
    });

    expect(result.event).toBe("skill.route.invoke");
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("skill.route.invoke");
    expect(events[0]?.meta).toEqual({
      command: "skillet",
      runtime: "cursor",
      source: "cursor-hook",
      surface: "userpromptsubmit",
    });
    expect(JSON.stringify(events[0]?.meta)).not.toContain("dnd");
  });

  it("sanitizes route invocation metadata", async () => {
    const events: Array<{ name: string; meta?: Record<string, string> }> = [];
    vi.spyOn(await import("../src/metrics.js"), "recordEvent").mockImplementation(
      (name, _initiator, meta) => {
        events.push({ name, meta: meta as Record<string, string> | undefined });
      },
    );

    recordRouteInvocation({
      runtime: "Cursor / Prompt!",
      source: "hook with spaces",
    });

    expect(events[0]?.meta?.runtime).toBe("cursor---prompt-");
    expect(events[0]?.meta?.source).toBe("hook-with-spaces");
  });
});

// U5 / R9, R10. The gate is the hash that actually reached disk. `hash`
// advances during pull BEFORE materialize, so comparing on it would report a
// match while the bytes on disk are a different version, and the agent would
// get stale instructions labelled as the author's current skill.
describe("resolveRouteBody — summon path", () => {
  beforeEach(async () => {
    await mkdir(join(TEST_ROOT, ".skillet", "skills"), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("covers AE2: reads locally and makes no body fetch when materialized_hash matches", async () => {
    await seedSkill("@thiago/the-lazy-dm", {
      name: "The Lazy DM",
      description: "RPG prep",
      owner: "thiago",
    });
    await upsertSkill({
      slug: "@thiago/the-lazy-dm",
      name: "The Lazy DM",
      description: "RPG prep",
      version: 1,
      hash: "sha256:current",
      materialized_hash: "sha256:current",
      source: "registry",
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      owner: "thiago",
    } as never);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ files: {} }), { status: 200 }),
    );
    const res = await resolveRouteBody("@thiago/the-lazy-dm", {
      summon: { hash: "sha256:current" },
    });

    expect(res?.body).toContain("The Lazy DM");
    // The marker still fires (author credit), but no body came over the wire.
    const bodyFetches = fetchSpy.mock.calls.filter((c) => !String(c[0]).includes("src=summon"));
    expect(bodyFetches).toHaveLength(0);
  });

  it("fetches when the local copy was persisted but never materialized", async () => {
    await seedSkill("@thiago/the-lazy-dm", {
      name: "The Lazy DM",
      description: "stale on disk",
      owner: "thiago",
    });
    await upsertSkill({
      slug: "@thiago/the-lazy-dm",
      name: "The Lazy DM",
      description: "RPG prep",
      version: 1,
      // `hash` matches the registry, `materialized_hash` does not exist: the
      // pull advanced but materialize never landed.
      hash: "sha256:current",
      source: "registry",
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      owner: "thiago",
    } as never);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ files: { "SKILL.md": { data: "# fetched current" } } }), {
        status: 200,
      }),
    );
    const res = await resolveRouteBody("@thiago/the-lazy-dm", {
      summon: { hash: "sha256:current" },
    });
    expect(res?.body).toBe("# fetched current");
  });
});
