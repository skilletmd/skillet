/**
 * Shared "this machine is not paired" failure — the single source for the
 * auth-required copy, the `--json` envelope, and the exit code.
 *
 * Every command that requires pairing (sync, import, add, discovery) imports
 * from here. Reusing the copy must be an import, not a convention — do not
 * restate this guidance at call sites.
 */
import { loadRegistryBearer, type RegistryBearer } from "@skillet/core";
import { webBaseUrl } from "./cli-command-tier.js";
import { ExitCode, exitWith } from "./exit-codes.js";
import { fail, dim, bold, cyan } from "./cli-colors.js";

/** Machine-readable error tag for `--json` consumers (desktop sidecar contract). */
export const AUTH_REQUIRED = "auth_required";

/** Stable exit code for the unpaired failure (CLI reference on skillet.md). */
export const AUTH_REQUIRED_EXIT = ExitCode.AUTH;

/** Human guidance: sign in on the web, get a pair code, run `skillet connect`. */
export function authRequiredMessage(): string {
  const web = webBaseUrl();
  return `This machine is not paired to an account. Sign in on ${web}, get a pair code at ${web}/settings, then run \`skillet connect <code>\`.`;
}

export interface AuthRequiredJson {
  ok: false;
  error: typeof AUTH_REQUIRED;
  code: typeof AUTH_REQUIRED;
  message: string;
}

/** `--json` envelope for unpaired commands. */
export function authRequiredJson(): AuthRequiredJson {
  return {
    ok: false,
    error: AUTH_REQUIRED,
    code: AUTH_REQUIRED,
    message: authRequiredMessage(),
  };
}

/**
 * Print the auth-required failure and exit non-zero.
 *
 * In `--json` mode the envelope MUST go to stdout: the desktop parses stdout
 * and classifies non-JSON output as an approval block and stderr-only failure
 * as offline (packages/desktop/src/main.ts getSurfacesUncached), so a bare
 * text error here would misroute every background tick.
 */
export function failAuthRequired(opts: { json?: boolean } = {}): never {
  if (opts.json === true) {
    process.stdout.write(JSON.stringify(authRequiredJson(), null, 2) + "\n");
  } else {
    // Same facts as authRequiredMessage(), shaped for a person: problem first,
    // URL and command each ending their own line. The first sentence must keep
    // "is not paired to an account" — desktop tray-logic classifies by that
    // prose as a fallback when the code field is absent.
    const web = webBaseUrl();
    console.error(fail("This machine is not paired to an account."));
    console.error(dim("  Sign in and get a pair code at ") + cyan(`${web}/settings`));
    console.error(dim("  Then run ") + bold("skillet connect <code>"));
  }
  exitWith(AUTH_REQUIRED_EXIT);
}

/**
 * Gate a command on pairing, returning the resolved bearer. An unpaired machine
 * (bearer kind 'none') triggers failAuthRequired, which exits non-zero with the
 * correct stdout/stderr envelope — so every gated command shares one check and
 * none can get that contract wrong. Callers past this point have a usable bearer.
 */
export async function requirePaired(
  token?: string,
  opts: { json?: boolean } = {},
): Promise<RegistryBearer> {
  const bearer = await loadRegistryBearer(token);
  if (bearer.kind === "none") failAuthRequired({ json: opts.json === true });
  return bearer;
}
