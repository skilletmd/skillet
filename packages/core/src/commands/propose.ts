/**
 * `skillet propose <slug>` — sign and submit a skill update as a pending proposal.
 *
 * Unlike `skillet publish`, propose does NOT touch the live `latest_hash`. The
 * submitted bundle enters a `pending` state and must be approved by the skill
 * owner before a version is minted (SPEC §9).
 *
 * Flow:
 *   1. Load the local identity (no inline minting — must be logged in first).
 *   2. Read the skill bundle from the kit store.
 *   3. Run the privacy scan; HIGH findings hard-block (same gate as publish).
 *   4. Compute the canonical content hash and fetch the manifest to learn base_hash.
 *   5. Sign via the §4 envelope (signEnvelope over the canonical hash string).
 *   6. POST /api/v1/skills/:author/:slug/proposals.
 *   7. Record a `propose` metric event.
 *
 * Two entry points share that machinery:
 *   - `propose(slug)` — the original self-handle path: bundle from the kit
 *     store, target `@<identity.handle>/<slug>`, base from the live manifest.
 *     Byte-compatible for existing callers; `opts.target`/`opts.base` override
 *     the target skill and skip the manifest base fetch.
 *   - `proposeCustomized(slug, adapters)` — R10: bundle from the LIVE on-disk
 *     edit of a customized skill, target its `customized_from` lineage origin,
 *     base the lineage hash (no auto-rebase). Registry 403/409 come back as
 *     TYPED results (`not_authorized` / `base_stale`), never raw throws — both
 *     are honest outcomes the CLI/desktop render, and neither un-customizes the
 *     skill (the edit stays live and private).
 */
import { join } from "node:path";
import { homedir } from "node:os";
import {
  canonicalContentHash,
  encodeBundle,
  type DecodedBundle,
} from "@skillet/protocol";
import { loadIdentity, type Identity } from "../identity/index.js";
import { loadAuthorKeyById } from "../signing/index.js";
import { signEnvelope } from "../signing/envelope.js";
import { readBundleFromSkillStore, readState } from "../kit/store.js";
import { RegistryClient, RegistryError } from "../registry/client.js";
import { recordEvent, detectInitiator } from "../metrics.js";
import { REGISTRY_URL_DEFAULT } from "../kit/types.js";
import type { Adapter } from "../adapter.js";
import { lineageRef, lineageTarget, readLiveCustomizedTree } from "./edits.js";

export type ProposeErrorCode =
  | "not_logged_in"
  | "skill_not_found"
  | "scan_blocked"
  | "stale_base"
  | "not_authorized"
  | "manifest_fetch_failed"
  | "propose_failed"
  | "not_customized"
  | "customized_missing"
  | "local_origin";

export class ProposeError extends Error {
  readonly code: ProposeErrorCode;
  readonly detail: unknown;

  constructor(message: string, code: ProposeErrorCode, detail?: unknown) {
    super(message);
    this.name = "ProposeError";
    this.code = code;
    this.detail = detail;
  }
}

/** Propose against this author/slug instead of the identity's own handle. */
export interface ProposeTarget {
  author: string;
  slug: string;
}

/** An explicit base (e.g. a capture's lineage) — skips the manifest base fetch. */
export interface ProposeBase {
  version: number;
  hash: string;
}

export interface ProposeOptions {
  registryUrl?: string;
  configDir?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  ignorePatterns?: string[];
  target?: ProposeTarget;
  base?: ProposeBase;
}

export interface ProposeResult {
  proposalId: string;
  proposalUrl: string;
  hash: string;
  slug: string;
}

function defaultConfigDir(): string {
  return process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
}

async function loadIdentityOrThrow(): Promise<Identity> {
  const identity = await loadIdentity();
  if (!identity) {
    throw new ProposeError(
      "Proposing an edit needs a local signing identity. Run `skillet login --handle <handle> --name \"<Name>\"` to set one up, then re-propose. (A connected machine syncs and installs, but proposing still needs its own signing key.)",
      "not_logged_in",
    );
  }
  return identity;
}

function buildClient(identity: Identity, opts: ProposeOptions): RegistryClient {
  const registryUrl = (opts.registryUrl ?? identity.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/$/, "");
  const token = opts.token ?? process.env["SKILLET_TOKEN"];
  return new RegistryClient({
    baseUrl: registryUrl,
    ...(token ? { token } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
}

function normalizeHash(hash: string): string {
  return hash.startsWith("sha256:") ? hash : `sha256:${hash}`;
}

export async function propose(
  slug: string,
  opts: ProposeOptions = {},
): Promise<ProposeResult> {
  const configDir = opts.configDir ?? defaultConfigDir();

  const identity = await loadIdentityOrThrow();

  const state = await readState();
  const entry = state.skills[slug];
  if (!entry) {
    throw new ProposeError(
      `Skill "${slug}" not found in kit. Import it with \`skillet import <path>\` first.`,
      "skill_not_found",
    );
  }

  const bundle = await readBundleFromSkillStore(slug);
  // No client-side scan (KTD2): the registry proposal route runs
  // `secretsBlockingScan` at create AND approve (routes/proposals.ts), so a real
  // secret is caught server-side. Placeholders pass its benign-corpus.

  const contentHash = canonicalContentHash(bundle);
  const client = buildClient(identity, opts);

  const targetAuthor = opts.target?.author ?? identity.handle;
  const targetSlug = opts.target?.slug ?? slug;

  let baseHash: string | null = null;
  if (opts.base) {
    // An explicit base (capture lineage) is what the edit was made against —
    // never silently rebased onto the live manifest (R9: no auto-rebase; the
    // server's 409 `base_stale` is the honest answer when upstream moved on).
    baseHash = normalizeHash(opts.base.hash);
  } else {
    try {
      const manifestResult = await client.getSkillManifest(`@${targetAuthor}/${targetSlug}`);
      if (!manifestResult.notModified && manifestResult.value) {
        const remoteHash = manifestResult.value.latest_hash ?? null;
        if (remoteHash) {
          baseHash = normalizeHash(remoteHash);
        }
      }
    } catch (err) {
      if (err instanceof RegistryError && err.status === 404) {
        baseHash = null;
      } else {
        throw new ProposeError(
          `Failed to fetch manifest: ${(err as Error).message}`,
          "manifest_fetch_failed",
        );
      }
    }
  }

  const key = await loadAuthorKeyById(configDir, identity.keyId);
  const signature = signEnvelope(contentHash, key);
  const files = encodeBundle(bundle);

  let proposeResult: { proposal_id: string; proposal_url: string; state: string; proposed_hash: string };
  try {
    proposeResult = await client.proposeSkill({
      author: targetAuthor,
      slug: targetSlug,
      files,
      base_hash: baseHash,
      signature,
    });
  } catch (err) {
    if (err instanceof RegistryError && err.status === 409) {
      throw new ProposeError(
        err.message || "Local is behind remote. Re-fetch the latest version and re-propose.",
        "stale_base",
        (err as RegistryError).body,
      );
    }
    if (err instanceof RegistryError && err.status === 403) {
      throw new ProposeError(
        err.message || "You're not authorized to propose to this skill.",
        "not_authorized",
        (err as RegistryError).body,
      );
    }
    // The proposal secret gate refused a real credential — carry the structured
    // body (reason + findings) so the CLI lists file:line, like publish does.
    if (err instanceof RegistryError && err.code === "scan_blocked") {
      throw new ProposeError(err.message, "scan_blocked", (err as RegistryError).body);
    }
    throw new ProposeError(
      `Registry rejected proposal: ${(err as Error).message}`,
      "propose_failed",
    );
  }

  recordEvent("propose", detectInitiator(), {
    slug,
    hash: contentHash,
    proposalId: proposeResult.proposal_id,
  });

  return {
    proposalId: proposeResult.proposal_id,
    proposalUrl: proposeResult.proposal_url,
    hash: contentHash,
    slug,
  };
}

// ── propose-customized (R10) ──────────────────────────────────────────────────

export interface ProposeCustomizedAccepted {
  status: "proposed";
  /** The lineage origin the proposal targets, `@author/slug`. */
  ref: string;
  proposalId: string;
  proposalUrl: string;
  hash: string;
}

/**
 * The two honest registry refusals, as data instead of throws: the surface
 * renders friendly copy, and the skill stays customized (the edit stays live).
 */
export interface ProposeCustomizedRefused {
  status: "not_authorized" | "base_stale";
  ref: string;
  /** Registry-supplied detail — surfaces render their own copy on top. */
  message: string;
}

export type ProposeCustomizedResult = ProposeCustomizedAccepted | ProposeCustomizedRefused;

/**
 * Propose a customized skill's edit upstream against its `customized_from`
 * lineage origin. The bundle is built from the LIVE on-disk edit (never the
 * skill store — the store holds the author's canonical content, not the edit),
 * the base is the lineage hash (no auto-rebase), and the signing + privacy-scan
 * machinery is exactly propose()'s. Proposing does NOT un-customize the skill:
 * the edit stays live and private until the author accepts (or the user takes
 * theirs).
 */
export async function proposeCustomized(
  slug: string,
  adapters: Adapter[],
  opts: ProposeOptions = {},
): Promise<ProposeCustomizedResult> {
  const configDir = opts.configDir ?? defaultConfigDir();

  const identity = await loadIdentityOrThrow();

  const state = await readState();
  const entry = state.skills[slug];
  if (!entry) {
    throw new ProposeError(`Skill "${slug}" not found in kit.`, "skill_not_found");
  }
  if (!entry.customized_from) {
    throw new ProposeError(
      `Skill "${slug}" is not customized — nothing to propose. Edit it first.`,
      "not_customized",
    );
  }
  const lineage = entry.customized_from;
  const target = lineageTarget(lineage);
  if (!target) {
    throw new ProposeError(
      `Skill "${slug}" has a local-only origin — nothing upstream to propose to.`,
      "local_origin",
    );
  }
  const ref = lineageRef(lineage);

  const tree = await readLiveCustomizedTree(slug, entry.owner ?? null, adapters);
  if (!tree || !tree.has("SKILL.md")) {
    throw new ProposeError(
      `No live edit found on disk for "${slug}" — cannot build a proposal.`,
      "customized_missing",
    );
  }
  const bundle: DecodedBundle = tree;
  // No client-side scan (KTD2) — the registry proposal route is the authority.

  const contentHash = canonicalContentHash(bundle);
  const client = buildClient(identity, opts);

  const key = await loadAuthorKeyById(configDir, identity.keyId);
  const signature = signEnvelope(contentHash, key);
  const files = encodeBundle(bundle);

  let proposeResult: { proposal_id: string; proposal_url: string; state: string; proposed_hash: string };
  try {
    proposeResult = await client.proposeSkill({
      author: target.author,
      slug: target.slug,
      files,
      base_hash: normalizeHash(lineage.hash),
      signature,
    });
  } catch (err) {
    if (err instanceof RegistryError && err.status === 403) {
      return { status: "not_authorized", ref, message: err.message };
    }
    if (err instanceof RegistryError && err.status === 409) {
      return { status: "base_stale", ref, message: err.message };
    }
    if (err instanceof RegistryError && err.code === "scan_blocked") {
      throw new ProposeError(err.message, "scan_blocked", (err as RegistryError).body);
    }
    throw new ProposeError(
      `Registry rejected proposal: ${(err as Error).message}`,
      "propose_failed",
    );
  }

  recordEvent("propose", detectInitiator(), {
    slug: lineage.slug,
    hash: contentHash,
    proposalId: proposeResult.proposal_id,
  });

  return {
    status: "proposed",
    ref,
    proposalId: proposeResult.proposal_id,
    proposalUrl: proposeResult.proposal_url,
    hash: contentHash,
  };
}
