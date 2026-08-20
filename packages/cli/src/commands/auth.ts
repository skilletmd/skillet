import type { Command } from "commander";
import {
  authLogout,
  authDisconnectLocal,
  authStatus,
  authConnect,
  approveDevice,
  listDevices,
  renameDevice,
  revokeDevice,
  readActiveDeviceFile,
  loadSessionToken,
} from "@skillet/core";
import { REGISTRY_DEFAULT, resolveRegistryUrl } from "../cli-context.js";
import { webBaseUrl } from "../cli-command-tier.js";

/**
 * Safe machine-readable shape for `auth connect --json` — only non-secret
 * metadata. Bearer tokens (device_token, session_token) are deliberately
 * omitted; they would land in CI logs / shell history and are already
 * persisted to ~/.skillet.
 */
export function safeAuthConnectJson(result: { device_id: string }): string {
  return JSON.stringify({ ok: true, device_id: result.device_id }, null, 2);
}
import { ExitCode, exitWith } from "../exit-codes.js";
import { ok, fail, dim, bold, cyan } from "../cli-colors.js";
import { writeJsonError } from "../json-output.js";
import { resolveWebUrl } from "../open-browser-url.js";
import { printRenderedError } from "../render-error.js";

const LOGOUT_DESCRIPTION = "Sign out of this machine";
const DISCONNECT_DESCRIPTION =
  "Sign out and erase this machine's local credentials";

/** Shared action for `skillet logout` and `skillet auth logout`. */
async function runLogoutAction(opts: { registry: string }, label: string): Promise<void> {
  try {
    const result = await authLogout({ registryUrl: opts.registry });
    delete process.env["SKILLET_TOKEN"];
    if (!result.serverRevoked && result.serverWarning) {
      console.warn(`⚠ ${result.serverWarning}. Local session cleared anyway.`);
    }
    console.log(ok("Signed out."));
    console.log(dim("  This machine no longer syncs. Pair it again to resume."));
    console.log(dim("  Forget it entirely: ") + bold("skillet logout --forget"));
  } catch (err) {
    console.error(fail(`${label} failed: ${(err as Error).message}`));
    exitWith(ExitCode.ERROR);
  }
}

/** Shared action for `skillet disconnect` and `skillet auth disconnect`. */
async function runDisconnectAction(opts: { registry: string }, label: string): Promise<void> {
  try {
    const result = await authDisconnectLocal({ registryUrl: opts.registry });
    delete process.env["SKILLET_TOKEN"];
    if (!result.unregistered && result.warning) {
      console.warn(`⚠ ${result.warning}`);
    }
    console.log(ok("Disconnected. Local credentials cleared."));
  } catch (err) {
    console.error(fail(`${label} failed: ${(err as Error).message}`));
    exitWith(ExitCode.ERROR);
  }
}

/**
 * Top-level sign-out. `skillet logout` ends the session on this machine;
 * `skillet logout --forget` also erases this machine's local credentials (the
 * heavier reset that used to be `disconnect`). Both `disconnect` aliases stay
 * registered but hidden — the desktop tray invokes `auth disconnect`, and
 * scripts may still call the top-level `disconnect`.
 */
export function registerSessionAliasCommands(program: Command): void {
  program
    .command("logout")
    .description(LOGOUT_DESCRIPTION)
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT)
    .option("--forget", "Also erase this machine's local credentials")
    .action((opts: { registry: string; forget?: boolean }) =>
      opts.forget
        ? runDisconnectAction(opts, "logout --forget")
        : runLogoutAction(opts, "logout"),
    );

  program
    .command("disconnect", { hidden: true })
    .description(DISCONNECT_DESCRIPTION)
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT)
    .action((opts: { registry: string }) => runDisconnectAction(opts, "disconnect"));
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Sign in and manage registry session");

  // `auth login` (email magic-link CLI login) retired with the magic-link pipe.
  // Pair this machine with `skillet connect <code>` (a code from web Settings).

  auth
    .command("logout")
    .description(LOGOUT_DESCRIPTION)
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT)
    .action((opts: { registry: string }) => runLogoutAction(opts, "auth logout"));

  // Hidden from `auth --help`: humans use `logout --forget`. Still registered
  // and callable — the desktop tray invokes `auth disconnect`.
  auth
    .command("disconnect", { hidden: true })
    .description(DISCONNECT_DESCRIPTION)
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT)
    .action((opts: { registry: string }) => runDisconnectAction(opts, "auth disconnect"));

  // Hidden from `auth --help`: humans use `doctor`. Still registered and
  // callable with an unchanged `--json` envelope — the desktop tray invokes
  // `auth status --json`.
  auth
    .command("status", { hidden: true })
    .description("Show session, device token, and signing identity state")
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT)
    .option("--token <token>", "Bearer token override")
    .option("--json", "Emit machine-readable status")
    .action(async (opts: { registry: string; token?: string; json?: boolean }) => {
      try {
        const status = await authStatus({
          registryUrl: opts.registry,
          ...(opts.token ? { token: opts.token } : {}),
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify({ ok: true, ...status }, null, 2) + "\n");
          return;
        }
        const who = status.whoami;
        const remotePrimary = who?.author_key_id ?? null;
        const localKey = status.identity?.keyId ?? null;
        console.log(`Bearer: ${status.bearer.kind}${status.bearer.tokenPreview ? ` (${status.bearer.tokenPreview})` : ""}`);
        if (who?.handle) console.log(`  registry handle: @${who.handle}`);
        if (who?.user_id) console.log(`  user: ${who.user_id.slice(0, 8)}…`);
        if (who?.device_id) console.log(`  device: ${who.device_id.slice(0, 12)}…`);
        if (remotePrimary) {
          console.log(`  registry primary key: ${remotePrimary.slice(0, 16)}…`);
        }
        if (localKey) {
          if (remotePrimary && localKey !== remotePrimary) {
            console.log(`  local signing key: ${localKey.slice(0, 16)}… (not registry primary)`);
          } else {
            console.log(`  local signing key: ${localKey.slice(0, 16)}… (registry primary)`);
          }
        } else {
          console.log("  local signing key: none");
        }
        if (status.hints.length > 0) {
          console.log("");
          for (const h of status.hints) console.log(`  → ${h}`);
        }
      } catch (err) {
        printRenderedError(err as Error, (what) => fail(`Couldn't read auth status. ${what}`));
        exitWith(ExitCode.ERROR);
      }
    });

  // `skillet whoami` — registry session + local signing identity for the native app gate.
  program
    .command("whoami")
    .description("Who this machine is signed in as")
    .option("--json", "Emit machine-readable identity JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const status = await authStatus();
        const identity = status.identity
          ? {
              handle: status.identity.handle,
              keyId: status.identity.keyId,
              registryUrl: status.identity.registryUrl,
            }
          : null;

        if (opts.json) {
          process.stdout.write(
            JSON.stringify({
              identity,
              registry: status.whoami,
              bearer: status.bearer.kind,
              // Distinguish a revoked/stale credential (registry said 401/403)
              // from merely offline — the tray must prompt a re-pair, not a retry.
              disconnected: status.credential_rejected,
            }) + "\n",
          );
          return;
        }

        if (status.credential_rejected) {
          console.log("This machine was disconnected. Its saved credential is no longer valid.");
          console.log(
            dim("  Re-pair: ") + bold("skillet connect <code>") + dim(" (code from ") + cyan(resolveWebUrl("/settings")) + dim(")"),
          );
          return;
        }

        if (identity?.handle && identity.keyId) {
          const remotePrimary = status.whoami?.author_key_id ?? null;
          console.log(`@${identity.handle} on ${identity.registryUrl}`);
          if (remotePrimary && identity.keyId !== remotePrimary) {
            console.log(`  local key: ${identity.keyId.slice(0, 16)}… (not registry primary)`);
            if (remotePrimary) {
              console.log(`  registry primary: ${remotePrimary.slice(0, 16)}…`);
            }
          } else {
            console.log(`  key: ${identity.keyId.slice(0, 16)}… (registry primary)`);
          }
          if (status.whoami?.user_id) {
            console.log(`  registry session: active`);
          }
          return;
        }

        if (status.whoami?.handle) {
          // Paired but no session (plain `logout`): the machine keeps syncing
          // but the human sign-in is gone. Say that instead of "signed in",
          // which reads as a bug right after signing out. The bearer kind
          // can't tell us this: the device token outranks the session as the
          // bearer even when both are present.
          if (!(await loadSessionToken())) {
            console.log(`@${status.whoami.handle} (paired, signed out)`);
            console.log(dim("  This machine still syncs your skills."));
            console.log(
              dim("  Sign in again: ") + bold("skillet connect <code>") + dim(" (code from ") + cyan(resolveWebUrl("/settings")) + dim(")"),
            );
            return;
          }
          console.log(`@${status.whoami.handle} (signed in)`);
          const remotePrimary = status.whoami.author_key_id;
          if (remotePrimary && identity?.keyId !== remotePrimary) {
            console.log(`  publishing: works via your session (signing key lives on another machine)`);
          } else {
            console.log(`  publishing: works via your session (no signing key on this machine)`);
          }
          return;
        }

        if (status.bearer.kind !== "none") {
          console.log(`Signed in (${status.bearer.kind})`);
          console.log(`  Run \`skillet auth status\` for details.`);
          return;
        }

        console.log("Not signed in.");
        console.log(dim("  Sign in and get a pair code at ") + cyan(resolveWebUrl("/settings")));
        console.log(dim("  Then run ") + bold("skillet connect <code>"));
      } catch (err) {
        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ identity: null, error: (err as Error).message }) + "\n",
          );
          exitWith(ExitCode.ERROR);
        }
        printRenderedError(err as Error, fail);
        exitWith(ExitCode.ERROR);
      }
    });

  // `skillet device …`: manage author-signed device-key
  // delegations. A device/browser generates its own key and presents the public
  // half; the primary key (in this keystore) signs a delegation cert authorizing
  // it to propose/approve on the author's behalf.
  // Bare `skillet device` is the whole "This machine" view: every machine on
  // the account, which one this is, and the rename hint — so a person never
  // has to remember `device list` vs `device show` vs `device rename`. This is
  // a human overview only (no flags): declaring options on the parent would
  // shadow the subcommands' own `--json`, which the tray parses. Scripts use
  // `device list --json`; the subcommands stay for the tray (`device rename`).
  const device = program
    .command("device")
    .description("Your machines: which one this is, plus how to rename it")
    .action(async () => {
      try {
        const [result, active] = await Promise.all([listDevices({}), readActiveDeviceFile()]);
        const currentId = active?.device_id ?? null;
        const { sync_devices } = result;
        if (sync_devices.length === 0) {
          console.log("No machines connected yet.");
          console.log(
            dim("  Pair one: ") + bold("skillet connect <code>") + dim(" (code from ") + cyan(`${webBaseUrl()}/settings`) + dim(")"),
          );
          return;
        }
        console.log(`Machines on your account (${sync_devices.length})`);
        for (const d of sync_devices) {
          const isCurrent = currentId !== null && d.device_id === currentId;
          const marker = isCurrent ? cyan("●") : dim("○");
          const name = d.label ? d.label : dim("(unnamed)");
          const here = isCurrent ? cyan("  ← this machine") : "";
          const added = new Date(d.created_at * 1000).toISOString().slice(0, 10);
          console.log(`  ${marker} ${name}${here}`);
          console.log(dim(`      ${d.device_id.slice(0, 16)}…  added ${added}`));
        }
        console.log("");
        console.log(dim("  Rename this machine: ") + bold("skillet device rename <label>"));
        console.log(dim("  Manage on the web:   ") + cyan(`${webBaseUrl()}/settings`));
      } catch (err) {
        printRenderedError(err as Error, (what) => fail(`Couldn't list your machines. ${what}`));
        exitWith(ExitCode.ERROR);
      }
    });

  device
    .command("list")
    .description("List the machines on your account")
    .option("--registry <url>", "Registry base URL")
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .option("--json", "Emit machine-readable JSON")
    .action(async (opts: { registry?: string; token?: string; json?: boolean }) => {
      try {
        const result = await listDevices({
          ...(opts.registry ? { registryUrl: opts.registry } : {}),
          ...(opts.token ? { token: opts.token } : {}),
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify({ ok: true, sync_devices: result.sync_devices }) + "\n");
          return;
        }
        const { sync_devices } = result;
        if (sync_devices.length === 0) {
          console.log(
            "No connected devices. Pair a machine with `skillet connect <code>` or open Settings on skillet.md.",
          );
          return;
        }
        for (const d of sync_devices) {
          const added = new Date(d.created_at * 1000).toISOString().slice(0, 10);
          const label = d.label ? ` "${d.label}"` : "";
          console.log(`  ${d.device_id.slice(0, 16)}…${label}  added ${added}`);
        }
      } catch (err) {
        printRenderedError(err as Error, (what) => fail(`Couldn't list devices. ${what}`));
        exitWith(ExitCode.ERROR);
      }
    });

  device
    .command("rename <label>")
    .description("Rename this machine")
    .option("--registry <url>", "Registry base URL")
    .option("--token <token>", "Registry token (defaults to this machine's credentials)")
    .option("--json", "Emit machine-readable JSON")
    .action(async (label: string, opts: { registry?: string; token?: string; json?: boolean }) => {
      try {
        const result = await renameDevice(label, {
          // Env-aware coalesce (explicit flag → identity → SKILLET_REGISTRY_URL
          // → default) — the tray sidecar reaches local/dev registries via env.
          registryUrl: await resolveRegistryUrl({ ...(opts.registry ? { registry: opts.registry } : {}) }),
          ...(opts.token ? { token: opts.token } : {}),
        });
        if (opts.json) {
          // Ad-hoc { ok: true, ...fields } shape — the desktop tray parses it.
          process.stdout.write(
            JSON.stringify({ ok: true, device_id: result.device_id, label: result.label }) + "\n",
          );
          return;
        }
        console.log(ok(`Renamed this machine to "${result.label}"`));
      } catch (err) {
        const message = (err as Error).message;
        if (opts.json) {
          writeJsonError(message);
          return;
        }
        printRenderedError(err as Error, (what) => fail(`Couldn't rename this machine. ${what}`));
        exitWith(
          /not paired|credential|session token|401|403|unauthorized/i.test(message)
            ? ExitCode.AUTH
            : ExitCode.ERROR,
        );
      }
    });
}

/** Legacy device/session linking — SKILLET_LEGACY_CLI=1 only. */
export function registerLegacyAuthCommands(program: Command): void {
  const auth = program.commands.find((c) => c.name() === "auth");
  const device = program.commands.find((c) => c.name() === "device");
  if (!auth || !device) {
    throw new Error("registerAuthCommands must run before registerLegacyAuthCommands");
  }

  auth
    .command("connect")
    .description(
      "Attach machine via signed-in session (prefer `skillet connect <code>` from skillet.md)",
    )
    .option("--registry <url>", "Registry base URL", REGISTRY_DEFAULT)
    .option("--token <token>", "Session token (defaults to ~/.skillet/session.json)")
    .option("--label <label>", "Label for this agent in settings")
    .option("--json", "Emit machine-readable result")
    .action(async (opts: { registry: string; token?: string; label?: string; json?: boolean }) => {
      try {
        const result = await authConnect({
          registryUrl: opts.registry,
          ...(opts.token ? { token: opts.token } : {}),
          ...(opts.label ? { label: opts.label } : {}),
        });
        if (opts.json) {
          process.stdout.write(safeAuthConnectJson(result) + "\n");
          return;
        }
        console.log(ok(`Connected this machine to your account`));
        console.log(`  device: ${result.device_id}`);
        console.log(`  token saved to ~/.skillet/device.json`);
        console.log(`  Pull kits with \`skillet sync\``);
      } catch (err) {
        printRenderedError(err as Error, (what) => fail(`Couldn't connect this machine. ${what}`));
        exitWith(ExitCode.ERROR);
      }
    });

  device
    .command("approve <device_pub_or_code>")
    .description("Approve a device key: mint + sign a delegation cert with your primary key")
    .option("--scopes <list>", "Comma-separated scopes (propose,approve,publish)", "propose,approve,publish")
    .option("--ttl-days <n>", "Delegation lifetime in days (default 90, max 365)")
    .option("--label <label>", "Human label for the device (e.g. \"Sarah's MacBook\")")
    .option("--registry <url>", "Registry base URL")
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .option("--json", "Emit machine-readable JSON")
    .action(
      async (
        pairing: string,
        opts: {
          scopes: string;
          ttlDays?: string;
          label?: string;
          registry?: string;
          token?: string;
          json?: boolean;
        },
      ) => {
        try {
          const scopes = opts.scopes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const s of scopes) {
            if (s !== "propose" && s !== "approve" && s !== "publish") {
              throw new Error(`invalid scope ${JSON.stringify(s)}: only propose,approve,publish are delegable`);
            }
          }
          const ttlDays = opts.ttlDays != null ? Number(opts.ttlDays) : undefined;
          if (ttlDays != null && (!Number.isFinite(ttlDays) || ttlDays <= 0)) {
            throw new Error("--ttl-days must be a positive number");
          }
          const res = await approveDevice({
            pairing,
            scopes: scopes as ("propose" | "approve" | "publish")[],
            ...(ttlDays != null ? { ttlDays } : {}),
            ...(opts.label ? { label: opts.label } : {}),
            ...(opts.registry ? { registryUrl: opts.registry } : {}),
            ...(opts.token ? { token: opts.token } : {}),
          });
          if (opts.json) {
            process.stdout.write(JSON.stringify({ ok: true, ...res }) + "\n");
            return;
          }
          const when = new Date(res.expiresAt * 1000).toISOString().slice(0, 10);
          console.log(
            ok(`${res.alreadyRegistered ? "Already approved" : "Approved"} device ${res.deviceKeyId.slice(0, 16)}…`),
          );
          console.log(`  scopes: ${res.scopes.join(", ")}  ·  expires: ${when}`);
        } catch (err) {
          printRenderedError(err as Error, (what) => fail(`Couldn't approve device. ${what}`));
          exitWith(ExitCode.ERROR);
        }
      },
    );

  device
    .command("revoke <device_key_id>")
    .description("Revoke a device key (mint + sign a revocation with your primary key)")
    .option("--registry <url>", "Registry base URL")
    .option("--token <token>", "Session token (defaults to $SKILLET_TOKEN)")
    .option("--json", "Emit machine-readable JSON")
    .action(
      async (
        deviceKeyId: string,
        opts: { registry?: string; token?: string; json?: boolean },
      ) => {
        try {
          const res = await revokeDevice({
            deviceKeyId,
            ...(opts.registry ? { registryUrl: opts.registry } : {}),
            ...(opts.token ? { token: opts.token } : {}),
          });
          if (opts.json) {
            process.stdout.write(JSON.stringify({ ok: true, ...res }) + "\n");
            return;
          }
          const when = new Date(res.revokedAt * 1000).toISOString();
          console.log(ok(`Revoked device ${res.deviceKeyId.slice(0, 16)}… at ${when}`));
        } catch (err) {
          printRenderedError(err as Error, (what) => fail(`Couldn't revoke device. ${what}`));
          exitWith(ExitCode.ERROR);
        }
      },
    );
}
