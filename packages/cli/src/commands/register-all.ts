import type { Command } from "commander";
import { legacyManagementEnabled } from "../cli-routing.js";
import { registerAddCommand } from "./add-cmd.js";
import { registerAuthCommands, registerSessionAliasCommands } from "./auth.js";
import { registerAvatarCommand } from "./avatar.js";
import { registerConnectCommand } from "./connect.js";
import { registerCreateCommand } from "./create-cmd.js";
import { registerDoctorCommand } from "./doctor.js";
import { registerEditsCommand } from "./edits.js";
import { registerEvalCommand } from "./eval.js";
import { registerExportCommand } from "./export.js";
import { registerImportCommand } from "./import-cmd.js";
import { registerInitCommand } from "./init.js";
import { registerListCommand } from "./list.js";
import { registerMcpCommand } from "./mcp.js";
import { registerPendingCommands } from "./pending.js";
import { registerRouteCommand } from "./route-cmd.js";
import { registerManagementCommands } from "./register-management-commands.js";
import { registerRestoreCommand } from "./restore.js";
import { registerStatusCommand } from "./status.js";
import { registerSweepCommand } from "./sweep.js";
import { registerSyncCommand } from "./sync.js";
import { registerRuntimesCommand } from "./runtimes.js";
import { registerSearchCommand } from "./search.js";
import { registerUsageCommand } from "./usage.js";
import { registerActivityCommand } from "./activity.js";
import { registerTrustCommands } from "./trust.js";
import { registerPinCommands } from "./pin.js";
import { registerUpdateModeCommand } from "./update-mode.js";
import { registerUploadCommand } from "./upload-cmd.js";
import { registerWebCommand } from "./web-cmd.js";

/**
 * Canonical CLI verb taxonomy (pre-launch naming contract):
 * - import — ingest local/runtime/GitHub skills into the kit
 * - add — install or subscribe so skills materialize on this machine
 * - upload — share local kit skills to the account profile (device tier)
 * - scan — harm-scan safety state for kit skills
 * Legacy aliases (status, publish, …) remain callable with deprecation hints.
 */

export interface RegisterCommandsOptions {
  /** Register hidden management verbs (default: SKILLET_LEGACY_CLI=1). */
  legacyManagement?: boolean;
}

export function registerAllCommands(program: Command, options?: RegisterCommandsOptions): void {
  registerSyncCommand(program);
  // Pure-local agent detection for the desktop tray — no registry, so it survives
  // a failing sync (deleted skill, DB reset, offline). Device-tier: always on.
  registerRuntimesCommand(program);
  // Local-only usage dashboard: reads the route-history store, no
  // registry — works offline and for anonymous users, like `runtimes`.
  registerUsageCommand(program);
  // Data rights + consent surface: view/export/delete recorded data and
  // toggle the two consent tiers. Always registered — a user's ability to see and
  // delete what's recorded about them must never depend on SKILLET_LEGACY_CLI
  // (same footing as `edits`/`restore`/`pending`).
  registerActivityCommand(program);
  registerRestoreCommand(program);
  // ALWAYS registered (R10): a captured edit must never need SKILLET_LEGACY_CLI
  // to be reviewed, kept, proposed, or discarded — same footing as `restore`.
  registerEditsCommand(program);
  registerSweepCommand(program);
  registerListCommand(program);
  // Public, anonymous registry search — read-only, no pairing. The @skillet/route
  // fall-through shells out to this on a whiff; also usable standalone. Device-tier:
  // always registered so the bundled router can rely on it being present.
  registerSearchCommand(program);
  // `skillet init` — install the /skillet router skill into detected agents with
  // no account/pairing (the Summon tier's front door). Anonymous, like search.
  registerInitCommand(program);
  registerStatusCommand(program);
  registerDoctorCommand(program);
  registerAuthCommands(program);
  // Top-level `logout` / `disconnect` aliases for the `auth` verbs — sign-out is
  // a first-reach command, so it earns a root verb instead of only `auth logout`.
  registerSessionAliasCommands(program);
  registerAvatarCommand(program);
  registerConnectCommand(program);
  registerWebCommand(program);
  // `skillet create` — scaffold a new skill on disk. Anonymous and local: it
  // writes files and stops, so it works with no account, like `init`/`search`.
  registerCreateCommand(program);
  // `skillet eval` — static fixture check against a kit skill. Reads the local
  // store and touches no registry, so it sits at the device tier next to
  // `usage`/`runtimes`. It was management-tier, which made the authoring loop
  // (`create` → edit → `eval` → `upload`) cite a command that did not exist on
  // a default install; the bundled @skillet/create playbook depends on it.
  registerEvalCommand(program);
  registerAddCommand(program);
  registerImportCommand(program);
  registerExportCommand(program);
  registerUploadCommand(program);
  registerTrustCommands(program);
  registerPinCommands(program);
  registerUpdateModeCommand(program);
  registerMcpCommand(program);
  registerRouteCommand(program);
  // Update approval is a DEVICE concern, not a management verb: it gates this
  // machine's sync, and the desktop tray drives it (`pending`/`approve`/`reject`
  // --json). Hiding it behind SKILLET_LEGACY_CLI broke the tray's badge and the
  // web-approval → lock-file reconcile, leaving sync approval-blocked forever.
  registerPendingCommands(program);

  const legacy = options?.legacyManagement ?? legacyManagementEnabled();
  if (legacy) {
    registerManagementCommands(program);
  }
}
