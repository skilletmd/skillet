import { describe, it, expect } from "vitest";
import {
  BUNDLED_ROUTE_SLUG,
  BUNDLED_ROUTE_MATERIALIZE_DIR,
  BUNDLED_CREATE_SLUG,
  BUNDLED_CREATE_MATERIALIZE_DIR,
} from "../src/commands/route.js";
import {
  materializeOptsForIdentity,
  skillMaterializeIdentity,
} from "../src/kit/materialize-identity.js";

describe("skillMaterializeIdentity", () => {
  it("maps bundled route to flat skillet dir for slash commands", () => {
    expect(skillMaterializeIdentity(BUNDLED_ROUTE_SLUG, "skillet")).toEqual({
      adapterSlug: "route",
      owner: "skillet",
      dirName: BUNDLED_ROUTE_MATERIALIZE_DIR,
    });
  });

  it("passes dirName through materialize opts", () => {
    const identity = skillMaterializeIdentity(BUNDLED_ROUTE_SLUG, "skillet");
    expect(materializeOptsForIdentity(identity, "/tmp/proj")).toEqual({
      owner: "skillet",
      cwd: "/tmp/proj",
      dirName: "skillet",
    });
  });
});

describe("bundled create playbook identity", () => {
  it("materializes as `skillet-create`, not `skillet--create`", () => {
    expect(skillMaterializeIdentity(BUNDLED_CREATE_SLUG, "skillet")).toEqual({
      adapterSlug: "create",
      owner: "skillet",
      dirName: BUNDLED_CREATE_MATERIALIZE_DIR,
    });
  });
});
