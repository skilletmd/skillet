/** True when argv has no subcommand or flags — only then do we run the onboarding wizard. */
export function shouldRunOnboardingWizard(argv: string[] = process.argv): boolean {
  return argv.slice(2).length === 0;
}

/** Opt-in registry management verbs for CI, desktop, and dogfood scripts. */
export function legacyManagementEnabled(): boolean {
  return process.env["SKILLET_LEGACY_CLI"] === "1";
}
