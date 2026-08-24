/**
 * The discovery capability is optional, and its absence is the loopback contract.
 *
 * `packages/mcp` is shared by the hosted registry server and the local
 * `skillet mcp` loopback server. Summon needs to reach the public registry;
 * loopback must stay offline-capable. So discovery is a separate optional
 * capability rather than a widening of `SkillSource`: when the host supplies
 * none, the summon tools are not advertised at all, instead of being advertised
 * and failing at call time.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@skillet/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skillet/core")>();
  return { ...actual, readState: async () => ({ version: 1, skills: {} }) };
});

import { handleMessage } from "../src/server.js";
import type { DiscoverySource } from "../src/store.js";

const SUMMON_TOOLS = ["summon", "search_public", "author_standing"];

/** Minimal stand-in: presence is what the tool surface keys on, not behavior. */
function stubDiscovery(over: Partial<DiscoverySource> = {}): DiscoverySource {
  return {
    summon: async () => ({ kind: "ok", handle: "x", candidates: [] }),
    searchPublic: async () => [],
    authorStanding: async () => null,
    readPublicSkill: async () => null,
    ...over,
  };
}

async function toolNames(opts: Parameters<typeof handleMessage>[1]) {
  const res = await handleMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    opts,
  );
  return ((res as { result: { tools: { name: string }[] } }).result.tools).map((t) => t.name);
}

describe("the loopback server gains nothing", () => {
  it("advertises no summon tools without a discovery capability", async () => {
    const names = await toolNames({});

    // The exact loopback surface: the three core tools, unchanged.
    expect(names).toEqual(["list_skills", "get_skill", "search_skills"]);
    for (const t of SUMMON_TOOLS) expect(names).not.toContain(t);
  });

  it("refuses a summon call rather than crashing when unsupported", async () => {
    const res = await handleMessage(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "summon", arguments: { handle: "mattpocock" } },
      },
      { httpAuthorized: true },
    );

    // A tool error, not a thrown exception: an unknown tool must not take the
    // connection down for a client that guessed.
    const r = res as { result?: { isError?: boolean }; error?: unknown };
    expect(r.error ?? r.result?.isError).toBeTruthy();
  });
});

describe("the hosted server gains summon", () => {
  it("advertises the summon tools when discovery is supplied", async () => {
    const names = await toolNames({ discovery: stubDiscovery() });

    for (const t of SUMMON_TOOLS) expect(names).toContain(t);
    // Additive: the core three are still there and still first.
    expect(names.slice(0, 3)).toEqual(["list_skills", "get_skill", "search_skills"]);
  });
});

describe("the server says summon exists", () => {
  async function instructions(opts: Parameters<typeof handleMessage>[1]) {
    const res = await handleMessage(
      { jsonrpc: "2.0", id: 9, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      opts,
    );
    return (res as { result: { instructions: string } }).result.instructions;
  }

  it("describes summoning when discovery is present", async () => {
    const text = await instructions({ discovery: stubDiscovery() });

    // A client discovers the capability here or not at all; nobody reads our
    // docs before wiring up a connector.
    expect(text).toMatch(/summon/i);
    expect(text).toMatch(/@/);
  });

  it("says nothing about summoning on loopback", async () => {
    const text = await instructions({});

    // Instructions that describe an unavailable tool are worse than silence.
    expect(text).not.toMatch(/summon/i);
    expect(text).toMatch(/list_skills/);
  });

  it("stays short enough to sit in every session's context", async () => {
    const text = await instructions({ discovery: stubDiscovery() });

    // This text is prepended to every client session. It is allowed to grow
    // for a real capability, not to become documentation.
    expect(text.length).toBeLessThan(1200);
  });
});
