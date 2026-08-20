/**
 * Update-trust policy resolution.
 *
 * Pure unit coverage of the precedence hierarchy and the two independent
 * global defaults:
 *   - AC #1: two independent globals (own-kit auto, external gate), toggle separately.
 *   - AC #2: per-author overrides the global for that author's skills.
 *   - AC #3: per-skill overrides both author and global.
 *   - AC #4: precedence is exactly skill > author > global-by-source-class,
 *            with a case proving each level wins over the one below.
 *
 * The sync-path security boundary is proven in policy-sync.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  resolveTrustMode,
  loadPolicy,
  savePolicy,
  setGlobalDefault,
  setAuthorPolicy,
  setSkillPolicy,
  setKitPolicy,
  DEFAULT_POLICY,
  type TrustPolicyFile,
  type PolicyInput,
} from "../src/trust/policy.js";

const AUTHOR_A = "a".repeat(64);
const AUTHOR_B = "b".repeat(64);
const OWN_KEY = "f".repeat(64);

function policy(overrides: Partial<TrustPolicyFile> = {}): TrustPolicyFile {
  return {
    version: 1,
    globals: { "own-kit": "auto", external: "gate" },
    authors: {},
    skills: {},
    kits: {},
    ...overrides,
  };
}

function regEntry(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    slug: "@taylor/festival-ops",
    authorKeyId: AUTHOR_A,
    source: "registry",
    sourceClass: "external",
    ...over,
  };
}

describe("resolveTrustMode — short-circuits", () => {
  it("local imports always auto-apply regardless of policy", () => {
    const p = policy({ globals: { "own-kit": "gate", external: "gate" } });
    expect(
      resolveTrustMode({ slug: "x", source: "local" }, p, OWN_KEY)
    ).toBe("auto");
  });

  it("self-published (own key) always auto-applies even if author is gated", () => {
    const p = policy({ authors: { [OWN_KEY]: "gate" } });
    expect(
      resolveTrustMode(
        regEntry({ authorKeyId: OWN_KEY, sourceClass: "external" }),
        p,
        OWN_KEY
      )
    ).toBe("auto");
  });
});

describe("two independent global defaults by source class", () => {
  it("ships own-kit=auto and external=gate by default", () => {
    const p = policy();
    expect(resolveTrustMode(regEntry({ sourceClass: "own-kit" }), p, null)).toBe(
      "auto"
    );
    expect(
      resolveTrustMode(regEntry({ sourceClass: "external" }), p, null)
    ).toBe("gate");
  });

  it("the two globals toggle independently", () => {
    // Flip own-kit to gate; external stays gate.
    let p = policy({ globals: { "own-kit": "gate", external: "gate" } });
    expect(resolveTrustMode(regEntry({ sourceClass: "own-kit" }), p, null)).toBe(
      "gate"
    );
    // Flip external to auto; own-kit stays auto.
    p = policy({ globals: { "own-kit": "auto", external: "auto" } });
    expect(
      resolveTrustMode(regEntry({ sourceClass: "external" }), p, null)
    ).toBe("auto");
  });

  it("a missing/unknown source class resolves to the external (safer) default", () => {
    const p = policy();
    expect(
      resolveTrustMode(regEntry({ sourceClass: null }), p, null)
    ).toBe("gate");
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: undefined as unknown as null }),
        p,
        null
      )
    ).toBe("gate");
  });

  it("unpinned registry authors gate even under own-kit auto", () => {
    const p = policy();
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "own-kit", authorPinned: false }),
        p,
        null,
      ),
    ).toBe("gate");
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "own-kit", authorPinned: true }),
        p,
        null,
      ),
    ).toBe("auto");
  });
});

describe("per-author overrides the global default", () => {
  it("auto-applies an external author the user has trusted", () => {
    const p = policy({ authors: { [AUTHOR_A]: "auto" } });
    expect(
      resolveTrustMode(regEntry({ sourceClass: "external" }), p, null)
    ).toBe("auto");
  });

  it("gates an own-kit author the user has explicitly distrusted", () => {
    const p = policy({ authors: { [AUTHOR_A]: "gate" } });
    expect(
      resolveTrustMode(regEntry({ sourceClass: "own-kit" }), p, null)
    ).toBe("gate");
  });

  it("only affects the named author, not others", () => {
    const p = policy({ authors: { [AUTHOR_A]: "auto" } });
    expect(
      resolveTrustMode(
        regEntry({ authorKeyId: AUTHOR_B, sourceClass: "external" }),
        p,
        null
      )
    ).toBe("gate");
  });
});

describe("per-skill overrides author and global", () => {
  it("per-skill auto beats an external global", () => {
    const p = policy({ skills: { "@taylor/festival-ops": "auto" } });
    expect(
      resolveTrustMode(regEntry({ sourceClass: "external" }), p, null)
    ).toBe("auto");
  });

  it("per-skill gate beats an own-kit global", () => {
    const p = policy({ skills: { "@taylor/festival-ops": "gate" } });
    expect(
      resolveTrustMode(regEntry({ sourceClass: "own-kit" }), p, null)
    ).toBe("gate");
  });
});

describe("per-kit overrides the global default for one subscribed kit", () => {
  const KIT = "@taylor/writers-kit";

  it("auto-applies an external kit the subscriber has trusted", () => {
    const p = policy({ kits: { [KIT]: "auto" } });
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "external", sourceKit: KIT }),
        p,
        null
      )
    ).toBe("auto");
  });

  it("gates one kit while another stays on the auto default", () => {
    const p = policy({
      globals: { "own-kit": "auto", external: "auto" },
      kits: { [KIT]: "gate" },
    });
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "external", sourceKit: KIT }),
        p,
        null
      )
    ).toBe("gate");
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "external", sourceKit: "@taylor/other-kit" }),
        p,
        null
      )
    ).toBe("auto");
  });

  it("per-author and per-skill still win over per-kit", () => {
    // kit says auto, but the author inside it is distrusted → gate.
    const byAuthor = policy({
      kits: { [KIT]: "auto" },
      authors: { [AUTHOR_A]: "gate" },
    });
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "external", sourceKit: KIT }),
        byAuthor,
        null
      )
    ).toBe("gate");
    // kit says auto, but one skill inside it is gated → gate.
    const bySkill = policy({
      kits: { [KIT]: "auto" },
      skills: { "@taylor/festival-ops": "gate" },
    });
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "external", sourceKit: KIT }),
        bySkill,
        null
      )
    ).toBe("gate");
  });

  it("kit override is ignored when the skill carries no sourceKit", () => {
    const p = policy({ kits: { [KIT]: "auto" } });
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "external", sourceKit: null }),
        p,
        null
      )
    ).toBe("gate");
  });
});

describe("subscriber trust — the web-set per-kit preference", () => {
  const KIT = "@taylor/writers-kit";

  it("auto beats the external global default", () => {
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "external", subscriberTrust: "auto" }),
        policy(),
        null
      )
    ).toBe("auto");
  });

  it("gate beats an auto global default", () => {
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "own-kit", subscriberTrust: "gate" }),
        policy(),
        null
      )
    ).toBe("gate");
  });

  it("a local per-kit override wins over the web preference", () => {
    // web says auto, local CLI gated this kit → gate.
    const p = policy({ kits: { [KIT]: "gate" } });
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "external", sourceKit: KIT, subscriberTrust: "auto" }),
        p,
        null
      )
    ).toBe("gate");
  });

  it("a local per-author override wins over the web preference", () => {
    const p = policy({ authors: { [AUTHOR_A]: "gate" } });
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "external", subscriberTrust: "auto" }),
        p,
        null
      )
    ).toBe("gate");
  });

  it("falls through to global when no web preference is set", () => {
    expect(
      resolveTrustMode(
        regEntry({ sourceClass: "external", subscriberTrust: null }),
        policy(),
        null
      )
    ).toBe("gate");
  });
});

describe("precedence is exactly skill > author > kit > global", () => {
  it("skill wins over a conflicting author setting", () => {
    // author says auto, skill says gate → gate.
    const p = policy({
      authors: { [AUTHOR_A]: "auto" },
      skills: { "@taylor/festival-ops": "gate" },
    });
    expect(
      resolveTrustMode(regEntry({ sourceClass: "own-kit" }), p, null)
    ).toBe("gate");
  });

  it("author wins over a conflicting global setting", () => {
    // global own-kit says auto, author says gate → gate.
    const p = policy({ authors: { [AUTHOR_A]: "gate" } });
    expect(
      resolveTrustMode(regEntry({ sourceClass: "own-kit" }), p, null)
    ).toBe("gate");
  });

  it("global applies when neither skill nor author is set", () => {
    const p = policy();
    expect(
      resolveTrustMode(regEntry({ sourceClass: "own-kit" }), p, null)
    ).toBe("auto");
  });

  it("full stack: skill > author > global, each level demonstrably wins", () => {
    const base = regEntry({ sourceClass: "external" }); // global = gate
    // global only
    expect(resolveTrustMode(base, policy(), null)).toBe("gate");
    // author beats global
    expect(
      resolveTrustMode(base, policy({ authors: { [AUTHOR_A]: "auto" } }), null)
    ).toBe("auto");
    // skill beats author (and global)
    expect(
      resolveTrustMode(
        base,
        policy({
          authors: { [AUTHOR_A]: "auto" },
          skills: { "@taylor/festival-ops": "gate" },
        }),
        null
      )
    ).toBe("gate");
  });
});

describe("policy file I/O", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skillet-policy-test-"));
    path = join(dir, "trust-policy.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads defaults when the file is absent", async () => {
    const p = await loadPolicy(path);
    expect(p).toEqual(DEFAULT_POLICY);
  });

  it("round-trips a saved policy", async () => {
    const p = policy({ authors: { [AUTHOR_A]: "auto" } });
    await savePolicy(p, path);
    expect(await loadPolicy(path)).toEqual(p);
  });

  it("a corrupt file falls back to safe defaults (never fails open)", async () => {
    await writeFile(path, "{ not json", "utf8");
    expect(await loadPolicy(path)).toEqual(DEFAULT_POLICY);
  });

  it("repairs unknown modes field-by-field against defaults", async () => {
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        globals: { "own-kit": "banana", external: "gate" },
        authors: { [AUTHOR_A]: "nope", [AUTHOR_B]: "auto" },
        skills: {},
      }),
      "utf8"
    );
    const p = await loadPolicy(path);
    // bad own-kit mode → default (auto); bad author dropped; good author kept.
    expect(p.globals["own-kit"]).toBe("auto");
    expect(p.authors[AUTHOR_A]).toBeUndefined();
    expect(p.authors[AUTHOR_B]).toBe("auto");
  });

  it("setters load → mutate → persist atomically", async () => {
    await setGlobalDefault("external", "auto", path);
    await setAuthorPolicy(AUTHOR_A, "gate", path);
    await setSkillPolicy("@x/y", "auto", path);
    await setKitPolicy("@taylor/writers-kit", "gate", path);
    const p = await loadPolicy(path);
    expect(p.globals.external).toBe("auto");
    expect(p.authors[AUTHOR_A]).toBe("gate");
    expect(p.skills["@x/y"]).toBe("auto");
    expect(p.kits["@taylor/writers-kit"]).toBe("gate");

    // mode=null clears.
    await setAuthorPolicy(AUTHOR_A, null, path);
    await setSkillPolicy("@x/y", null, path);
    await setKitPolicy("@taylor/writers-kit", null, path);
    const cleared = await loadPolicy(path);
    expect(cleared.authors[AUTHOR_A]).toBeUndefined();
    expect(cleared.skills["@x/y"]).toBeUndefined();
    expect(cleared.kits["@taylor/writers-kit"]).toBeUndefined();
  });

  it("persisted JSON is human-inspectable (pretty-printed)", async () => {
    await savePolicy(policy(), path);
    const raw = await readFile(path, "utf8");
    expect(raw).toContain('"own-kit": "auto"');
    expect(raw.endsWith("\n")).toBe(true);
  });
});
