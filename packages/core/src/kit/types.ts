import type { ScanManifestInfo, SignedDelegation, ArtifactSchemaVersion } from "@skillet/protocol";
import type { Signature } from "../signing/envelope.js";

export interface SkillEntry {
  slug: string;
  /** Author handle without leading `@`. Absent for unowned local imports. */
  owner?: string | null;
  name: string;
  description: string;
  version: number;
  /**
   * Semver display label ("X.Y.Z") for `version`, as served by the registry.
   * Display only — never used for ordering, pinning, or approval; the integer
   * `version` stays authoritative. Absent for locally-imported skills and for
   * entries synced from servers predating the field.
   */
  versionLabel?: string;
  /** Canonical bundle content hash, `sha256:`-prefixed (§2.2). */
  hash: string;
  /**
   * The hash sync LAST SUCCESSFULLY MATERIALIZED to this machine's adapters
   * (set only after a materialize write lands). This — not `hash` — is the drift
   * baseline: `hash` is advanced by the pull phase before materialize, so if a
   * pull persists a new version but the subsequent materialize fails/declines
   * (degrade-never-delete), `hash` records a version that never reached disk.
   * Comparing on-disk bytes against `hash` would then misread the still-current
   * author bytes as a hand edit and wrongly customize the skill forever (F1).
   * `materialized_hash` records what's actually on disk, so a persisted-but-
   * unmaterialized version RE-MATERIALIZES (converges) instead of customizing.
   * Absent for entries never materialized on this machine and for legacy state.
   */
  materialized_hash?: string;
  source: "local" | "registry";
  /**
   * Which trust source class this skill belongs to, driving the two
   * independent global update-trust defaults:
   *   - "own-kit":  came from the user's own kit / a team kit they belong to
   *                 (the authenticated union manifest).
   *   - "external": added from a stranger (`skillet add @them/skill`).
   * Absent for locally-imported skills and for legacy entries written before
   * trust policy; the policy resolver treats absent as "external" (the safer,
   * diff-gated default).
   */
  sourceClass?: "own-kit" | "external";
  /**
   * Kit ref this skill was synced under (`@owner/kitname`, the manifest
   * `source_kit`). Drives the per-kit update-trust override so a subscriber can
   * auto-trust or gate a whole kit. Absent for locally-imported skills and for
   * skills not sourced from a kit.
   */
  sourceKit?: string | null;
  /**
   * Stable id of the kit this skill was synced under (the manifest `kit_id`),
   * the identity-safe counterpart to the display-only `sourceKit`. Use this for
   * any kit identity comparison; `sourceKit`'s `@owner/slug-name` is display
   * only and drifts on rename/slug collision. Absent for locally-imported
   * skills, own-profile skills, and entries from servers predating the field.
   */
  sourceKitId?: string | null;
  /**
   * The subscriber's per-kit update-trust preference, set on the web and
   * delivered via the sync manifest ('auto' | 'gate'). Overrides the global
   * default but yields to a local per-skill / per-author / per-kit policy. Null
   * when the subscriber set no web preference.
   */
  subscriberTrust?: "auto" | "gate" | null;
  /**
   * The skill's classified category key (e.g. `frontend`, `design`), delivered
   * via the sync manifest. Public skills only; null/absent when unclassified.
   * Informational — drives generated cover art in clients (desktop tray), no
   * sync/trust logic branches on it.
   */
  category?: string | null;
  /**
   * Context-weight metering carried from the sync manifest (approximate,
   * cross-vendor). `tokenCount` is the headline (ambient + body), `tokenAmbient`
   * the always-loaded name + trigger description, `tokenMethod` the estimator
   * label. Display only — clients render the registry number, never recompute.
   * Absent for locally-imported skills and entries from servers predating the
   * field.
   */
  tokenCount?: number;
  tokenAmbient?: number;
  tokenMethod?: string;
  registryUrl?: string;
  /**
   * Provenance for skills pulled from a remote non-registry source — currently
   * `github:<owner>/<repo>@<ref>[#<subdir>]` for `skillet import owner/repo`
   * Purely informational: these imports are still `source: "local"`
   * (unpublished, self-trusted) and no sync/publish logic branches on it.
   */
  origin?: string;
  /**
   * Hex-encoded Ed25519 public key ID of the skill author.
   * Absent for locally-imported skills (always trusted as self-authored).
   * Set for registry-sourced skills; compared against the user's own key ID
   * to determine whether auto-trust applies.
   */
  authorKeyId?: string;
  /**
   * Base64 of the 32 raw Ed25519 public-key bytes for the author. Persisted
   * alongside `authorKeyId` so verification can run on every sync without a
   * round-trip to the registry — and so a poisoned offline run still fails
   * closed against the locally-pinned key (PROTOCOL §4 + §11).
   */
  authorPubBase64?: string;
  /**
   * Author signature envelope over `content_hash`. Stored at import time
   * (registry response) and re-verified before every materialize so a
   * subsequent registry compromise cannot retroactively swap content.
   */
  signature?: Signature;
  /**
   * Set when the user accepted an author key rotation and this entry may
   * still carry material verified against the old key. A rotation re-signs
   * versions without changing content hashes, so the hash-equality
   * `unchanged` short-circuits in registry pull honor this flag by
   * re-fetching and re-verifying the version — rewriting hash, signature
   * envelope, and author identity together. Cleared on successful re-verify.
   */
  needsKeyReverify?: boolean;
  /**
   * When `signature` was produced by a delegated DEVICE key (its
   * `key_id` is a device key, not the author's primary), this carries the
   * inline SignedDelegation so the chain device_sig ← cert ← pinned primary can
   * be re-verified offline (fresh checkout / CI) without a registry round-trip.
   * Absent for primary-signed versions and locally-imported skills.
   */
  delegation?: SignedDelegation;
  importedAt: string;
  updatedAt: string;
  /**
   * Last-known server-side scan state. Captured from the
   * registry manifest entry at sync time so subsequent runs and `skillet status`
   * can surface quarantined skills without a round-trip. Absent for
   * locally-imported skills and for `clean` registry versions.
   */
  scan?: ScanManifestInfo;
  /**
   * When true, the registry-pull phase of sync MUST NOT change this entry's
   * version/hash — the user explicitly froze it via `skillet add --pin`. Pulling
   * is a no-op for pinned entries; the materialize phase still runs against
   * the pinned bytes already in the local store. Unpinned registry skills
   * pull in interactive sync only (the headless rule, AC 4).
   */
  pinned?: boolean;
  /**
   * Set when the user (or their agent) edited this synced skill's materialized
   * folder (KTD1): the skill is now the user's *customized version*, and this
   * carries its lineage baseline — the signed author origin the edit was made
   * against. While present, sync NEVER materializes over the edit (the edit
   * stays live in place forever) and the author's updates for it are HELD, not
   * applied. Cleared by Take theirs / Restore original. Additive — `readState`
   * is unvalidated JSON, so older state files simply lack it.
   */
  customized_from?: {
    author: string | null;
    slug: string;
    version: number;
    hash: string;
  };
  /**
   * A held author update for a customized skill (KTD3): the freshly-pulled
   * upstream `{version, hash}` that differs from `customized_from.hash` and was
   * NOT materialized over the edit. Surfaced as a quiet, non-blocking signal.
   * `acknowledged` is set by Keep mine so it stops nudging until a NEWER upstream
   * hash appears (which replaces this record, clearing the flag). Absent when the
   * skill is uncustomized or upstream matches the customized baseline.
   */
  held_update?: {
    version: number;
    hash: string;
    acknowledged?: boolean;
    /**
     * Set when a pull observed this held version is now YANKED on the registry
     * (F6). A yanked held update stops nudging (never surfaces as `hasUpdate`)
     * and `takeUpstream` refuses to install it — the author pulled it. Cleared
     * only when a NEWER, un-yanked upstream hash replaces this record.
     */
    yanked?: boolean;
  };
}

export interface KitState {
  /** Local kit state container format. */
  version: 1;
  /** Wire-format version for synced skill entries. */
  artifact_schema_version?: ArtifactSchemaVersion;
  skills: Record<string, SkillEntry>;
  /**
   * Whether the LAST post-sync device report carried a non-empty edited set
   * (KTD2). The registry clears its per-device edit-flags by ABSENCE, so a
   * device that un-customizes its LAST edited skill in a sync that also
   * materializes nothing must STILL send the now-empty edited set — otherwise
   * the stale `device_skill_edits` row never clears and holds that skill's
   * updates out of bulk-approve forever. This marker lets the report fire the
   * clearing case (edited: [] explicitly) on the transition FROM having reported
   * edits TO none, while a device that never had edits stays silent on idle
   * syncs. Additive — older state files simply lack it (treated as false).
   */
  edited_reported?: boolean;
}

export const REGISTRY_URL_DEFAULT = "https://registry.skillet.md";
