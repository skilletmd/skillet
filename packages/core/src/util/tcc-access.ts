/**
 * TCC access policy (U3) — decides whether a macOS-protected-resolving root is
 * PARKED for this invocation, and remembers user-granted access so a granted
 * root syncs in the background without re-prompting at every launch.
 *
 * Model:
 *  - U2 established the pure path policy (`isTccProtectedPath`): content reads
 *    against a root resolving into ~/Documents, ~/Desktop, or ~/Downloads trip
 *    the macOS consent prompt, so launch-path reads park such roots.
 *  - U3 layers WHO is asking on top. Every invocation classifies as one of:
 *      'user'       — an interactive terminal (TTY) run, or a run explicitly
 *                     marked user-initiated (the tray's manual Sync button).
 *                     May content-read protected roots (macOS may prompt once,
 *                     with the app's usage string) and is the ONLY class that
 *                     records unlock markers.
 *      'background' — a run explicitly marked background by a caller that
 *                     knows its own provenance (the tray's automatic syncs,
 *                     SSE-triggered syncs, launch auto-sync, cron with
 *                     `--background`). Admits a root only when an ACTIVE
 *                     unlock marker from the SAME context covers it.
 *      'unattended' — everything else: no TTY and no explicit signal
 *                     (agent-stamped route hooks, MCP-driven runs). Fail
 *                     closed: parked regardless of markers, never writes them.
 *  - Markers are context-scoped. macOS attributes a TCC grant to the
 *    responsible app: a grant earned under the desktop tray (the app bundle's
 *    identity) says nothing about the terminal's, and vice versa. The context
 *    ('desktop' | 'cli') rides an env var the tray's Rust shell sets on every
 *    sidecar spawn (SKILLET_TCC_CONTEXT=desktop); direct CLI runs are 'cli'.
 *    A marker only ever re-admits reads from the context that earned it.
 *  - Demotion self-heals divergence. A probing read under a marked root that
 *    fails EPERM/EACCES (the user revoked access, or denied the prompt)
 *    SUSPENDS that marker and re-parks the root before any per-skill work, so
 *    one revocation never spams per-skill `edit_unreadable` failures. A
 *    tccutil-style reset without EPERM simply prompts once on the next
 *    background probe (now carrying the bundle usage string); a denial there
 *    yields EPERM and demotes.
 *
 * Storage: one JSON file under the skillet dir (`tcc-access.json`), keyed per
 * resolved realpath (aliased paths share a marker). All reads/writes are
 * best-effort and fail closed: an unreadable store means "no grants".
 *
 * Static imports only — the packaged sidecar throws silently on dynamic
 * `import('node:…')`.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { skilletDir } from "../session-token.js";
import {
  HERMES_DEFAULT_HOME,
  computeHermesProfileRootUngated,
  isPathWithin,
  isTccProtectedPath,
  realpathDeepestExisting,
  tccProtectedAnchorFor,
} from "./pathsafe.js";

export type TccInitiation = "user" | "background" | "unattended";
export type TccContext = "desktop" | "cli";

export interface TccInvocation {
  initiation: TccInitiation;
  context: TccContext;
}

// Explicit classification set by the CLI entrypoint (flags win over TTY
// detection). Module-local, process-scoped: every CLI/sidecar run is one
// short-lived process, so this is per-invocation state.
let _override: Partial<TccInvocation> | null = null;

/**
 * Classify the current invocation. Explicit signals (setTccInvocation, from
 * the CLI's `--background` / `--user-initiated` flags) win; otherwise only an
 * interactive terminal (stdin AND stdout are TTYs) counts as user-initiated,
 * and everything else is fail-closed 'unattended' — a hook-style invocation
 * with a PTY on one side but a pipe on the other never qualifies.
 */
export function detectTccInvocation(): TccInvocation {
  const context: TccContext =
    process.env["SKILLET_TCC_CONTEXT"] === "desktop" ? "desktop" : "cli";
  const tty = process.stdout.isTTY === true && process.stdin.isTTY === true;
  return {
    initiation: _override?.initiation ?? (tty ? "user" : "unattended"),
    context: _override?.context ?? context,
  };
}

/** Explicitly classify this process's invocation (CLI flag plumbing). */
export function setTccInvocation(inv: Partial<TccInvocation>): void {
  _override = { ..._override, ...inv };
}

/** Reset the explicit classification (tests). */
export function resetTccInvocation(): void {
  _override = null;
}

/** Snapshot the explicit classification so a callee that sets its own
 *  (sync() applying opts.tccInitiation) can restore the caller's value on the
 *  way out instead of blindly resetting a CLI-installed override. */
export function snapshotTccInvocation(): Partial<TccInvocation> | null {
  return _override ? { ..._override } : null;
}

/** Restore a snapshot taken by snapshotTccInvocation. */
export function restoreTccInvocation(snapshot: Partial<TccInvocation> | null): void {
  _override = snapshot ? { ...snapshot } : null;
}

// ── unlock-marker store ──────────────────────────────────────────────────────

interface TccGrantRecord {
  /** Root the grant covers: the protected ANCHOR (realpath'd ~/Documents,
   *  ~/Desktop, or ~/Downloads) the probed root resolved under — see
   *  tccGrantStoreKey. */
  root: string;
  /** The TCC identity the grant was earned under. */
  context: TccContext;
  granted_at: string;
  /** Set when a marked read failed EPERM/EACCES — the marker is suspended. */
  suspended_at?: string;
  suspended_code?: string;
}

function grantsPath(): string {
  return join(skilletDir(), "tcc-access.json");
}

// Uncached on purpose: the store is one small JSON file, every CLI/sidecar
// run is a short-lived process, and reading fresh keeps a mid-run suspension
// (or another process's grant) visible without invalidation machinery.
function loadGrants(): TccGrantRecord[] {
  let grants: TccGrantRecord[] = [];
  try {
    const parsed = JSON.parse(readFileSync(grantsPath(), "utf8")) as {
      grants?: unknown;
    };
    if (Array.isArray(parsed.grants)) {
      grants = parsed.grants.filter(
        (g): g is TccGrantRecord =>
          !!g &&
          typeof (g as TccGrantRecord).root === "string" &&
          ((g as TccGrantRecord).context === "desktop" ||
            (g as TccGrantRecord).context === "cli"),
      );
    }
  } catch {
    // Missing or corrupt store → no grants (fail closed).
  }
  return grants;
}

function saveGrants(grants: TccGrantRecord[]): void {
  const path = grantsPath();
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ version: 1, grants }, null, 2) + "\n", {
      mode: 0o600,
    });
  } catch {
    // Best-effort: an unwritable store just means the grant doesn't persist
    // past this process; the next user-initiated run re-earns it.
  }
}

/** Canonical marker key for a root — aliased paths share one marker. */
export function tccGrantKey(root: string): string {
  return realpathDeepestExisting(root);
}

/** Marker key for STORING a grant/suspension: the protected ANCHOR the root
 *  resolves under. macOS attributes a TCC grant app-wide per protected folder
 *  (consenting to ~/Documents for one root covers every root inside it), so
 *  the marker matches that scope instead of re-prompting per root. Falls back
 *  to the canonical root for a path outside every anchor. */
function tccGrantStoreKey(root: string): string {
  const resolved = realpathDeepestExisting(root);
  return tccProtectedAnchorFor(resolved) ?? resolved;
}

/** Record (or refresh) a grant for `root` under `context`, clearing any
 *  suspension — a fresh successful user-initiated read supersedes a denial. */
export function recordTccGrant(root: string, context: TccContext): void {
  const key = tccGrantStoreKey(root);
  const grants = loadGrants().filter(
    (g) => !(g.root === key && g.context === context),
  );
  grants.push({ root: key, context, granted_at: new Date().toISOString() });
  saveGrants(grants);
}

/** Suspend the grant for `root` under `context` after a permission failure. */
export function suspendTccGrant(
  root: string,
  context: TccContext,
  code: string,
): void {
  const key = tccGrantStoreKey(root);
  const grants = loadGrants();
  const now = new Date().toISOString();
  const existing = grants.find((g) => g.root === key && g.context === context);
  if (existing) {
    existing.suspended_at = now;
    existing.suspended_code = code;
  } else {
    // No prior grant (a user-initiated run whose prompt was denied): record a
    // born-suspended marker so surfaces can say "denied" instead of re-asking.
    grants.push({
      root: key,
      context,
      granted_at: now,
      suspended_at: now,
      suspended_code: code,
    });
  }
  saveGrants(grants);
}

type GrantState = "active" | "suspended" | "none";

/** The strongest grant covering `path` for `context`: a marker admits the
 *  root it was earned for and everything below it, never siblings. */
function grantStateCovering(path: string, context: TccContext): GrantState {
  const key = tccGrantKey(path);
  let state: GrantState = "none";
  for (const g of loadGrants()) {
    if (g.context !== context) continue;
    if (!isPathWithin(key, g.root)) continue;
    if (!g.suspended_at) return "active";
    state = "suspended";
  }
  return state;
}

// ── gates ────────────────────────────────────────────────────────────────────

/**
 * Passive park gate — the drop-in replacement for U2's `isTccProtectedPath`
 * call sites on the content-read path. Never probes, never writes markers:
 *  - user-initiated: not parked (the run may read; macOS may prompt once);
 *  - background: parked unless an ACTIVE same-context marker covers the path;
 *  - unattended: always parked (markers never re-admit an unknown caller).
 */
export function isTccParkedPath(p: string): boolean {
  if (!isTccProtectedPath(p)) return false;
  const inv = detectTccInvocation();
  if (inv.initiation === "user") return false;
  if (inv.initiation === "background") {
    return grantStateCovering(p, inv.context) !== "active";
  }
  return true;
}

/**
 * Invocation-aware Hermes profile root (U3). The sticky `active_profile`
 * read is a filesystem CONTENT read against the Hermes home, so it obeys the
 * same park gate as every other content read: a user-initiated run (or a
 * background run holding an active same-context marker) may read it and
 * resolve the active profile tree; an unattended or ungranted-background run
 * sees null — the default tree is equally unreachable, and detection stays
 * metadata-only. The underlying read is memoized UNGATED in pathsafe while
 * the gate re-evaluates per call, so a process that becomes user-initiated
 * after module load (CLI flags, sync() applying opts.tccInitiation) resolves
 * the real profile without a restart.
 */
export function hermesProfileRoot(): string | null {
  if (isTccParkedPath(HERMES_DEFAULT_HOME)) return null;
  return computeHermesProfileRootUngated();
}

export interface TccRootDescription {
  /** The root resolves into a macOS-protected folder. */
  protected: boolean;
  /** The strongest grant `context` holds over the root. */
  grant: GrantState;
  /** The realpath'd protected folder the root resolves under, or null when it
   *  resolves outside all three. This is the unit of both grouping and reset:
   *  macOS scopes consent per protected folder, so two roots sharing an anchor
   *  are one grant, one surface row, and one `tccutil` service. */
  anchor: string | null;
}

/**
 * Non-probing assessment — the REPORTING counterpart to `assessTccRoot`.
 *
 * `assessTccRoot` exists to perform the TCC-gated read; for a user-initiated
 * run that read is the consent moment and macOS may prompt. That makes it
 * unusable for a status readout: a surface that only wants to SAY a folder
 * needs access must never be the thing that raises the dialog. This answers
 * from paths and the grant store alone, touching the filesystem no further
 * than realpath resolution.
 *
 * `context` is an argument rather than a read of `detectTccInvocation()` so a
 * caller can report on an identity other than its own — `skillet doctor` run
 * in a terminal still needs to say what the desktop's markers look like, and
 * conflating the two is how a support paste reports the wrong answer
 * confidently.
 */
export function describeTccRoot(
  root: string,
  context: TccContext,
): TccRootDescription {
  if (!isTccProtectedPath(root)) {
    return { protected: false, grant: "none", anchor: null };
  }
  const resolved = realpathDeepestExisting(root);
  return {
    protected: true,
    grant: grantStateCovering(resolved, context),
    anchor: tccProtectedAnchorFor(resolved),
  };
}

export interface TccRootAccess {
  /** The root resolves into a macOS-protected folder. */
  protected: boolean;
  /** No content read/write may touch the root this run. */
  parked: boolean;
  /** The park is a live permission denial (marker suspended), not just an
   *  ungranted root — surfaces route to System Settings instead of Sync now. */
  denied: boolean;
}

/**
 * Probing per-root assessment, run ONCE per adapter root (and the skill
 * store) at the top of a sync. Beyond the passive gate it:
 *  - performs the one TCC-triggering content read (a readdir) for runs that
 *    are allowed to read — user-initiated runs, and background runs holding
 *    an active same-context marker;
 *  - records the unlock marker on a successful USER-INITIATED read (the
 *    consent moment: the user asked, macOS prompted, the read succeeded);
 *  - suspends the marker and re-parks the root when the probe fails
 *    EPERM/EACCES, BEFORE any per-skill work — one revocation, one parked
 *    root, zero per-skill `edit_unreadable` spam.
 */
export function assessTccRoot(root: string): TccRootAccess {
  if (!isTccProtectedPath(root)) {
    return { protected: false, parked: false, denied: false };
  }
  const inv = detectTccInvocation();
  if (inv.initiation === "unattended") {
    // Markers never re-admit an unknown caller, but a suspended one still
    // names the reason for surfaces.
    return {
      protected: true,
      parked: true,
      denied: grantStateCovering(root, inv.context) === "suspended",
    };
  }
  if (inv.initiation === "background") {
    const state = grantStateCovering(root, inv.context);
    if (state !== "active") {
      return { protected: true, parked: true, denied: state === "suspended" };
    }
  }
  // User-initiated, or background under an active marker: probe one read.
  const probe = probeTccRead(root);
  if (probe.outcome === "ok") {
    if (inv.initiation === "user") recordTccGrant(root, inv.context);
    return { protected: true, parked: false, denied: false };
  }
  if (probe.outcome === "denied") {
    suspendTccGrant(root, inv.context, probe.code ?? "EPERM");
    return { protected: true, parked: true, denied: true };
  }
  // Unreadable for a non-permission reason: fail closed, but not a denial.
  return { protected: true, parked: true, denied: false };
}

/**
 * One content read against `root` (or its deepest existing ancestor INSIDE the
 * protected zone) — exactly the operation macOS gates, so its outcome is the
 * ground truth for whether this process's TCC identity may read there.
 * Walking out of the protected zone on ENOENT means nothing protected exists
 * yet to read → 'ok' (the prompt can only fire against real content).
 */
function probeTccRead(root: string): {
  outcome: "ok" | "denied" | "unreadable";
  /** The actual errno for a denial (EPERM or EACCES) — recorded verbatim on
   *  the suspended marker so surfaces report the real failure. */
  code?: string;
} {
  let current = resolve(root);
  for (;;) {
    try {
      readdirSync(current);
      return { outcome: "ok" };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") return { outcome: "denied", code };
      if (code !== "ENOENT" && code !== "ENOTDIR") return { outcome: "unreadable" };
      const parent = dirname(current);
      if (parent === current || !isTccProtectedPath(parent)) return { outcome: "ok" };
      current = parent;
    }
  }
}
