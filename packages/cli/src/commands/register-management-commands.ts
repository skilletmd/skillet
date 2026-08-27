import type { Command } from "commander";
import { registerLegacyAuthCommands } from "./auth.js";
import { registerPairCommand } from "./pair.js";
import { registerKitCommands } from "./kit/index.js";
import { registerLoginLegacyCommands } from "./login-legacy.js";
import { registerProposeCommands } from "./propose.js";
import { registerPublishCommand } from "./publish.js";
import { registerTeamCommands } from "./team/index.js";
import { registerLegacyTrustCommands } from "./trust.js";

/** Registry management verbs — opt in with SKILLET_LEGACY_CLI=1. */
export function registerManagementCommands(program: Command): void {
  registerPairCommand(program);
  registerLoginLegacyCommands(program);
  registerPublishCommand(program);
  registerProposeCommands(program);
  registerKitCommands(program);
  registerTeamCommands(program);
  registerLegacyAuthCommands(program);
  registerLegacyTrustCommands(program);
}
