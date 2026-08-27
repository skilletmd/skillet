use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Win32 `CREATE_NO_WINDOW` — console-subsystem children flash a visible window
/// without this flag when spawned from the GUI tray app.
#[cfg(any(windows, test))]
pub(crate) const WINDOWS_CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(any(windows, test))]
pub(crate) fn windows_no_window_creation_flags() -> u32 {
    #[cfg(windows)]
    {
        WINDOWS_CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    {
        0
    }
}

/// Spawn helper for sidecar and opener subprocesses. On Windows we always pass
/// `CREATE_NO_WINDOW` so background sync/pending polls do not flicker `cmd.exe`.
fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new(program);
        cmd.creation_flags(windows_no_window_creation_flags());
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = Command::new(program);
    // Report the desktop APP version to the registry (what the min-version gate +
    // updater key off), NOT the bundled CLI's own package version — the two drift.
    // cli-context.ts only sets SKILLET_CLIENT_VERSION when it's unset, so this wins.
    //
    // Read from PackageInfo, NOT env!("CARGO_PKG_VERSION"). Releases bump only
    // `tauri.conf.json` (see release.yml's tag guard), and that field is what
    // becomes the built app's version — Cargo.toml is never touched. Keying off
    // CARGO_PKG_VERSION froze every client's self-reported version at the
    // Cargo.toml value, so the min-version gate read a number that stopped
    // moving after 0.1.0.
    cmd.env("SKILLET_CLIENT_VERSION", app_version());
    // The sidecar IS the CLI binary; without this its authed traffic would
    // self-report as `cli` and the devices list would grow a false CLI icon.
    cmd.env("SKILLET_CLIENT_KIND", "desktop");
    cmd
}

// ── skillet CLI bridge ──────────────────────────────────────────────────────────
// Prefer the bundled sidecar (standalone binary from prepare-skillet-sidecar.mjs),
// then SKILLET_BIN, then dev node+cli.cjs, then a system `skillet` on PATH.

fn sidecar_candidates() -> &'static [&'static str] {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return &["skillet-aarch64-apple-darwin", "skillet"];
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return &["skillet-x86_64-apple-darwin", "skillet"];
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return &["skillet-x86_64-pc-windows-msvc.exe", "skillet.exe"];
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return &["skillet-x86_64-unknown-linux-gnu", "skillet"];
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
    )))]
    return &["skillet"];
}

/// TCC hygiene (U2): a PATH entry under `$HOME/Documents|Desktop|Downloads`
/// is never probed. Not because an existence check would prompt — metadata
/// probes (stat/exists) are TCC-exempt; only content reads (readdir/open)
/// trip the "access your Documents folder" dialog (see the policy note in
/// core's pathsafe.ts and the tcc probe-contract test). The filter is
/// uniformity: PATH-derived candidates are dropped at the boundary so they
/// can never become content-read (or spawn) targets downstream. The
/// deliberate trade-off is that a binary living inside a protected folder is
/// never discovered. Simple prefix check against the three folder names
/// under `$HOME`; the Node-side policy (`isTccProtectedPath` in
/// @skillet/core) does the full realpath resolution.
fn path_in_tcc_protected_folder(dir: &str) -> bool {
    // TCC is a macOS mechanism; off-mac these folders carry no consent gate,
    // so the filter must be inert there (mirrors core's isTccProtectedPath).
    if !cfg!(target_os = "macos") {
        return false;
    }
    let home = match std::env::var("HOME") {
        Ok(h) if !h.is_empty() => h,
        _ => return false,
    };
    let home = home.trim_end_matches('/');
    for name in ["Documents", "Desktop", "Downloads"] {
        let anchor = format!("{home}/{name}");
        if std::path::Path::new(dir).starts_with(std::path::Path::new(&anchor)) {
            return true;
        }
    }
    false
}

fn bundled_skillet() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in sidecar_candidates() {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Directories to search for a helper binary: a few fixed POSIX install
/// locations first, then everything on PATH.
///
/// PATH is split with the PLATFORM separator. `:` is POSIX-only, and splitting a
/// Windows PATH (`;`) that way shredded every entry into non-paths — so nothing
/// was ever found, the caller silently fell back, and no error said why. Taking
/// the raw value as an argument keeps that logic unit-testable.
fn search_dirs(path_var: Option<std::ffi::OsString>, extra: &[&str]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = extra.iter().map(PathBuf::from).collect();
    if let Some(path) = path_var {
        dirs.extend(
            std::env::split_paths(&path)
                .filter(|dir| !dir.as_os_str().is_empty())
                .filter(|dir| !path_in_tcc_protected_folder(&dir.to_string_lossy())),
        );
    }
    dirs
}

/// Executable names for `stem`, most specific first. Windows needs the `.exe`
/// suffix; a bare stem never resolves there.
fn exe_names(stem: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![format!("{stem}.exe"), stem.to_string()]
    } else {
        vec![stem.to_string()]
    }
}

/// First `dir/name` that exists as a file, across every dir in order.
fn find_in_dirs(dirs: &[PathBuf], names: &[String]) -> Option<PathBuf> {
    for dir in dirs {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Dev-only: run the workspace `cli.cjs` through node instead of the packaged
/// sidecar. Resolved against CARGO_MANIFEST_DIR, which does not exist in a
/// shipped bundle, so this is compiled out of release builds entirely.
#[cfg(debug_assertions)]
fn dev_skillet_node_cli() -> Option<(String, Vec<String>)> {
    let cli_js = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../cli/dist/cli.cjs");
    if !cli_js.is_file() {
        return None;
    }
    let dirs = search_dirs(
        std::env::var_os("PATH"),
        &["/opt/homebrew/bin", "/usr/local/bin"],
    );
    let node = find_in_dirs(&dirs, &exe_names("node"))?;
    Some((
        node.to_string_lossy().into_owned(),
        vec![cli_js.to_string_lossy().into_owned()],
    ))
}

/// The running app's version, as Tauri resolved it (`tauri.conf.json` wins over
/// Cargo.toml). Set once at setup; falls back to the compile-time Cargo version
/// for the unit tests, which never build a Tauri app.
static APP_VERSION: OnceLock<String> = OnceLock::new();

fn app_version() -> String {
    APP_VERSION
        .get()
        .cloned()
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

fn skillet_command() -> Option<(String, Vec<String>)> {
    if let Ok(v) = std::env::var("SKILLET_BIN") {
        if !v.is_empty() {
            let mut parts: Vec<String> = v.split_whitespace().map(String::from).collect();
            let exe = parts.remove(0);
            return Some((exe, parts));
        }
    }
    // In dev, prefer the workspace cli.cjs (rebuilt by `pnpm bundle`) over a stale
    // packaged sidecar sitting in src-tauri/binaries/.
    #[cfg(debug_assertions)]
    if let Some(dev) = dev_skillet_node_cli() {
        return Some(dev);
    }
    if let Some(path) = bundled_skillet() {
        return Some((path.to_string_lossy().into_owned(), vec![]));
    }
    // Same platform rules as dev_skillet_node_cli. Without them this fallback
    // could never resolve on Windows, so a machine with `skillet` installed but
    // no bundled sidecar reported "CLI not found" instead of just using it.
    let dirs = search_dirs(
        std::env::var_os("PATH"),
        &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"],
    );
    find_in_dirs(&dirs, &exe_names("skillet"))
        .map(|path| (path.to_string_lossy().into_owned(), vec![]))
}

fn skillet_home() -> String {
    let dir = std::env::var("SKILLET_DIR").unwrap_or_else(|_| {
        let home = std::env::var("HOME")
            .ok()
            .or_else(|| std::env::var("USERPROFILE").ok())
            .unwrap_or_default();
        format!("{home}/.skillet")
    });
    // Ensure it exists: the sidecar spawns with `.current_dir(skillet_home())`, and
    // Command fails with "No such file or directory (os error 2)" if the working dir
    // is missing — which happens on a fresh machine before the CLI has ever run.
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// The registry override this process (and its CLI sidecar) runs against, when
/// it differs from prod. None = prod (registry.skillet.md) or unset.
fn non_prod_registry_url() -> Option<String> {
    let url = std::env::var("SKILLET_REGISTRY_URL").ok()?;
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "https://registry.skillet.md" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(serde::Deserialize)]
struct DeviceFile {
    device_token: String,
    label: Option<String>,
}

#[derive(serde::Deserialize)]
struct IdentityFile {
    #[serde(rename = "registryUrl")]
    registry_url: Option<String>,
}

fn read_identity_registry_url() -> Option<String> {
    let path = Path::new(&skillet_home()).join("identity.json");
    let raw = fs::read_to_string(path).ok()?;
    let parsed: IdentityFile = serde_json::from_str(&raw).ok()?;
    parsed
        .registry_url
        .map(|v| v.trim_end_matches('/').to_string())
}

fn read_active_device_token() -> Result<String, String> {
    let path = Path::new(&skillet_home()).join("device.json");
    let raw = fs::read_to_string(path).map_err(|_| "not_authenticated".to_string())?;
    let parsed: DeviceFile =
        serde_json::from_str(&raw).map_err(|_| "not_authenticated".to_string())?;
    if parsed.label.as_deref() == Some("anonymous") || parsed.device_token.trim().is_empty() {
        return Err("not_authenticated".into());
    }
    Ok(parsed.device_token)
}

fn is_valid_pair_code(code: &str) -> bool {
    code.len() == 8
        && code
            .chars()
            .all(|c| c.is_ascii_uppercase() || ('2'..='9').contains(&c))
}

fn run_skillet(args: &[&str]) -> Result<String, String> {
    let (exe, mut argv) = skillet_command().ok_or("skillet CLI not found")?;
    argv.extend(args.iter().map(|s| s.to_string()));
    // Run from the Skillet home so `skillet sync` writes skillet.lock there, never into the
    // app's working dir (which during `tauri dev` is watched and would restart us).
    // SKILLET_TCC_CONTEXT: every tray-spawned sidecar runs under the APP's macOS
    // TCC identity, so folder-access unlock markers it earns or consumes are
    // desktop-context — a terminal-earned (cli) marker must never re-admit a
    // tray read, and vice versa (U3).
    let output = hidden_command(exe)
        .args(argv)
        .env("SKILLET_TCC_CONTEXT", "desktop")
        .current_dir(skillet_home())
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Like `run_skillet` but returns stdout regardless of exit code. `login`/`publish`/
/// `whoami --json` print their result body (success OR error) to stdout and exit 1
/// on failure, so the normal run_skillet (which drops stdout on failure) would lose it.
fn run_skillet_capture(args: &[&str]) -> (String, String) {
    let Some((exe, mut argv)) = skillet_command() else {
        return (String::new(), "skillet CLI not found".into());
    };
    argv.extend(args.iter().map(|s| s.to_string()));
    // Same desktop TCC context as run_skillet — see the comment there (U3).
    match hidden_command(exe)
        .args(argv)
        .env("SKILLET_TCC_CONTEXT", "desktop")
        .current_dir(skillet_home())
        .output()
    {
        Ok(o) => (
            String::from_utf8_lossy(&o.stdout).to_string(),
            String::from_utf8_lossy(&o.stderr).to_string(),
        ),
        Err(e) => (String::new(), e.to_string()),
    }
}

// ── Account: identity + upload ───────────────────────────────────────────────
// Uploads ride the verified session — not the CLI signing path. Web Studio uses
// the same registry contract; desktop tray must not require a delegated local
// Ed25519 key.

fn trim_connect_cli_error(stderr: &str, stdout: &str) -> String {
    let raw = if !stderr.trim().is_empty() {
        stderr.trim()
    } else {
        stdout.trim()
    };
    let msg = raw.trim_start_matches('✗').trim();
    if let Some(rest) = msg.strip_prefix("connect failed:") {
        return rest.trim().to_string();
    }
    if msg.is_empty() {
        "Could not connect with that code.".into()
    } else {
        msg.to_string()
    }
}

/// Attach this machine to an existing web account using a pair code from
/// skillet.md → Settings → Devices. Same code the terminal `skillet connect`
/// uses — this is the in-app path so users never need a terminal.
#[tauri::command]
fn connect(pair_code: String) -> Result<String, String> {
    if !is_valid_pair_code(&pair_code) {
        return Err("Invalid pair code".into());
    }
    let (stdout, stderr) =
        run_skillet_capture(&["connect", &pair_code, "--client", "desktop", "--json"]);
    let trimmed = stdout.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Ok(stdout);
    }
    if trimmed.is_empty() {
        return Err(trim_connect_cli_error(&stderr, &stdout));
    }
    Err(format!("Unexpected CLI output: {trimmed}"))
}

/// Rename THIS machine's device row (tray Settings inline edit). The label is
/// user text headed into argv, so it gets the same flag-injection guard as
/// upload_skills (reject leading '-', cap length to the server's 80 clamp).
/// Non-JSON output means an older CLI answered (SKILLET_BIN/PATH fallback
/// without `device rename`) — surface that as a distinct out-of-date error
/// instead of raw commander text.
#[tauri::command]
fn rename_device(label: String) -> Result<String, String> {
    let cleaned = label.trim().to_string();
    if cleaned.is_empty() {
        return Err("Name cannot be empty".into());
    }
    if cleaned.starts_with('-') || cleaned.chars().count() > 80 {
        return Err("Invalid device name".into());
    }
    let (stdout, stderr) = run_skillet_capture(&["device", "rename", &cleaned, "--json"]);
    classify_rename_output(&stdout, &stderr)
}

/// Turn `device rename` sidecar output into the UI-facing result. Old CLIs
/// without the command print commander help/unknown-command text to STDERR
/// with an empty stdout (same shape the desktop contract documents), so the
/// stderr branch must recognize commander noise and surface the distinct
/// out-of-date error — a genuine rename failure from a current CLI still
/// passes its first stderr line through.
fn classify_rename_output(stdout: &str, stderr: &str) -> Result<String, String> {
    let trimmed = stdout.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Ok(stdout.to_string());
    }
    if trimmed.is_empty() && !stderr.trim().is_empty() {
        let first = stderr
            .trim()
            .lines()
            .next()
            .unwrap_or("Rename failed")
            .trim();
        if first.starts_with("Usage:") || first.starts_with("error: unknown command") {
            return Err("CLI out of date — update Skillet".into());
        }
        return Err(first.to_string());
    }
    Err("CLI out of date — update Skillet".into())
}

/// Publish the selected local skills to the user's profile (no kit is created;
/// other devices pull them through the sync manifest's own-authored rows).
/// Slug shapes are validated here so a hostile skill-folder name can never be
/// smuggled into argv as a flag (anything starting with '-' is rejected).
#[tauri::command]
fn upload_skills(slugs: Vec<String>, public: bool) -> Result<String, String> {
    let cleaned: Vec<String> = slugs
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if cleaned.is_empty() {
        return Err("Select at least one skill to upload".into());
    }
    if let Some(bad) = cleaned.iter().find(|s| s.starts_with('-') || s.len() > 120) {
        return Err(format!("Invalid skill name: {bad}"));
    }
    let mut args: Vec<&str> = vec!["upload", "--json"];
    if public {
        args.push("--public");
    }
    for s in &cleaned {
        args.push("--skill");
        args.push(s);
    }
    let (stdout, stderr) = run_skillet_capture(&args);
    let trimmed_out = stdout.trim();
    if trimmed_out.starts_with('{') || trimmed_out.starts_with('[') {
        return Ok(stdout);
    }
    if trimmed_out.is_empty() {
        return Err(stderr);
    }
    Err(trimmed_out
        .lines()
        .next()
        .unwrap_or("Upload failed")
        .to_string())
}

/// Scan installed runtimes and import skills not yet in the kit (`skillet import --yes`).
#[tauri::command]
fn import_discovered() -> Result<String, String> {
    run_skillet(&["import", "-y"])
}

#[tauri::command]
fn cli_available() -> bool {
    skillet_command().is_some()
}

/// Kit grouping + per-skill sync flags (`skillet list --json`).
#[tauri::command]
fn kit_status() -> Result<String, String> {
    run_skillet(&["list", "--json"])
}

/// Skill-stats consent state (`skillet activity status --json`) — gates the
/// one-time "sync skill stats?" tray card. Raw stdout; frontend parses.
#[tauri::command]
fn skill_stats_status() -> Result<String, String> {
    run_skillet(&["activity", "status", "--json"])
}

/// Local skill-usage tally (`skillet usage --json`) — content-free counts that
/// gate the stats ask card: the question only makes sense once stats exist.
#[tauri::command]
fn usage_stats() -> Result<String, String> {
    run_skillet(&["usage", "--json"])
}

/// Answer the skill-stats question from the tray card. `sync=true` syncs stats
/// to the account; false keeps them local. Either way the question is marked
/// answered so no surface re-asks (`skillet activity choose <where> --json`).
#[tauri::command]
fn choose_skill_stats(sync: bool) -> Result<String, String> {
    run_skillet(&[
        "activity",
        "choose",
        if sync { "sync" } else { "local" },
        "--json",
    ])
}

/// Session, device token, and signing identity (`skillet auth status --json`).
#[tauri::command]
fn auth_status() -> String {
    let (stdout, _) = run_skillet_capture(&["auth", "status", "--json"]);
    if stdout.trim().is_empty() {
        "{\"ok\":false,\"bearer\":{\"kind\":\"none\",\"tokenPreview\":null}}".into()
    } else {
        stdout
    }
}

/// Stream connection inputs for device sync push. This is intentionally narrower
/// than auth_status: the webview needs the device bearer to open one registry SSE
/// stream, but we keep normal account surfaces on token previews.
#[tauri::command]
fn device_sync_stream_config() -> Result<String, String> {
    let device_token = read_active_device_token()?;
    let registry_url = non_prod_registry_url()
        .or_else(read_identity_registry_url)
        .unwrap_or_else(|| "https://registry.skillet.md".into());
    Ok(serde_json::json!({
        "registryUrl": registry_url,
        "deviceToken": device_token,
    })
    .to_string())
}

/// The signed-in user's avatar as a `data:` URI (`skillet avatar`). The CLI
/// fetches + base64-encodes it so the desktop renders it without loosening its
/// CSP for remote images. Returns `{"data_uri": "…" | null}`.
#[tauri::command]
fn avatar_data_uri() -> String {
    let (stdout, _) = run_skillet_capture(&["avatar"]);
    if stdout.trim().is_empty() {
        "{\"data_uri\":null}".into()
    } else {
        stdout
    }
}

#[tauri::command]
async fn sync_skills(background: bool) -> Result<String, String> {
    // Runs off the UI thread (spawn_blocking) — a sync can take 10s+ materializing
    // skills, and a synchronous command would freeze the whole tray (beach ball).
    // `skillet sync --json` prints the full adapter report on stdout even when the
    // exit code is non-zero (e.g. one registry kit failed union pull), so the tray
    // still gets those adapters — don't treat stderr-only failures as empty.
    //
    // `background` threads the user-initiated vs automatic distinction through
    // the shared sync path (U3): the sidecar is never a TTY, so without an
    // explicit flag it classifies fail-closed as unattended and parked agent
    // folders stay parked. The tray's manual Sync button passes false
    // (--user-initiated: may trigger the one macOS folder-access prompt and
    // records the unlock marker); every automatic sync passes true
    // (--background: only already-unlocked folders are read).
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<&str> = vec!["sync", "--json"];
        args.push(if background {
            "--background"
        } else {
            "--user-initiated"
        });
        let (stdout, stderr) = run_skillet_capture(&args);
        if stdout.trim().is_empty() {
            Err(if stderr.trim().is_empty() {
                "sync failed".to_string()
            } else {
                stderr
            })
        } else {
            Ok(stdout)
        }
    })
    .await
    .map_err(|e| format!("sync task failed: {e}"))?
}

/// Local agent detection — `skillet runtimes --json`. Pure filesystem scan, no
/// registry, so the tray's "your agents" facepile + folders survive a failing sync
/// (deleted skill, DB reset, offline). Decoupled from `sync_skills` on purpose.
#[tauri::command]
async fn detect_runtimes() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (stdout, stderr) = run_skillet_capture(&["runtimes", "--json"]);
        if stdout.trim().is_empty() {
            Err(if stderr.trim().is_empty() {
                "runtimes failed".to_string()
            } else {
                stderr
            })
        } else {
            Ok(stdout)
        }
    })
    .await
    .map_err(|e| format!("runtimes task failed: {e}"))?
}

#[tauri::command]
async fn check_sync() -> Result<String, String> {
    // Tray-open/launch check: always an automatic run, so it carries
    // --background and never touches a parked agent folder (U3).
    tauri::async_runtime::spawn_blocking(|| {
        let (stdout, stderr) = run_skillet_capture(&["sync", "--check", "--json", "--background"]);
        if stdout.trim().is_empty() {
            Err(if stderr.trim().is_empty() {
                "sync check failed".to_string()
            } else {
                stderr
            })
        } else {
            Ok(stdout)
        }
    })
    .await
    .map_err(|e| format!("sync check task failed: {e}"))?
}

/// Customized skills (`skillet edits list --json`) — the held-update card's
/// source of truth. Each row is `{slug, ref, customized, hasUpdate, version}`.
#[tauri::command]
fn list_edits() -> Result<String, String> {
    run_skillet(&["edits", "list", "--json"])
}

/// Read-only scan for local edits a full sync has not yet reconciled
/// (`skillet edits check --json`). Returns `{ok, edited:[{slug, where}]}`. Lets
/// the tray surface "Edited locally" on tray-open without a full sync or any
/// state/disk mutation. Always an automatic run, so it carries --background:
/// a granted agent folder stays readable instead of parking as unattended
/// (U3); ungranted roots stay parked either way.
#[tauri::command]
fn edits_check() -> Result<String, String> {
    run_skillet(&["edits", "check", "--json", "--background"])
}

/// A `<skill>` arg is a lineage ref (`@author/slug`) — a single conservative
/// token, never empty, never flag-shaped. Used by `edit_diff`.
fn valid_edit_target(skill: &str) -> bool {
    !skill.is_empty()
        && !skill.starts_with('-')
        && skill
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '@' | '/'))
}

/// Read-only diff for the "See diff" card action (`skillet edits diff <skill>
/// --json`). Returns `{files:[{path,status}]}` on stdout on both exit paths, so
/// a not-found skill still surfaces its JSON rather than being dropped.
#[tauri::command]
fn edit_diff(skill: String) -> Result<String, String> {
    if !valid_edit_target(&skill) {
        return Err("invalid edits target".into());
    }
    let (stdout, stderr) = run_skillet_capture(&["edits", "diff", skill.as_str(), "--json"]);
    if stdout.trim().is_empty() {
        Err(if stderr.trim().is_empty() {
            "edits diff returned no output".to_string()
        } else {
            stderr
        })
    } else {
        Ok(stdout)
    }
}

// Pending updates from people you follow — the real consent surface.
// `pending` lists diff-gated, not-yet-decided skills; the decision happens on
// the web (/updates) and the next sync materializes it. The app never
// bypasses the harm gate. Always an automatic poll, so it carries
// --background: a granted agent folder stays readable instead of parking as
// unattended (U3); ungranted roots stay parked either way.
#[tauri::command]
fn pending_updates() -> Result<String, String> {
    run_skillet(&["pending", "--json", "--background"])
}

// ── Insertion ────────────────────────────────────────────────────────────────
// Clipboard + synthesized paste — the same model as the Swift app, needing the
// same Accessibility grant. Cross-platform: Cmd+V on macOS, Ctrl+V elsewhere.

// The palette steals focus when it opens, so remember which app was frontmost
// BEFORE that, then hand focus back to it right before the synthesized paste —
// otherwise ⌘V lands in the palette (nowhere) instead of the user's app.
#[cfg(target_os = "macos")]
static PREV_APP_PID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

#[cfg(target_os = "macos")]
fn capture_frontmost_pid() {
    use objc2_app_kit::NSWorkspace;
    let ws = NSWorkspace::sharedWorkspace();
    if let Some(front) = ws.frontmostApplication() {
        PREV_APP_PID.store(
            front.processIdentifier(),
            std::sync::atomic::Ordering::SeqCst,
        );
    }
}

#[cfg(target_os = "macos")]
fn reactivate_prev_app() {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    let pid = PREV_APP_PID.load(std::sync::atomic::Ordering::SeqCst);
    if pid <= 0 {
        return;
    }
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        let _ = app.activateWithOptions(NSApplicationActivationOptions::empty());
    }
}

fn paste_into_focused_app() {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let Ok(mut enigo) = Enigo::new(&Settings::default()) else {
        return;
    };
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;
    let _ = enigo.key(modifier, Direction::Press);
    let _ = enigo.key(Key::Unicode('v'), Direction::Click);
    let _ = enigo.key(modifier, Direction::Release);
}

#[tauri::command]
fn insert_skill(app: tauri::AppHandle, body: String) -> Result<(), String> {
    // Write the clipboard, then release the handle — on macOS NSPasteboard the
    // content persists after the app drops it (verified: ⌘V still pastes it).
    {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard.set_text(body).map_err(|e| e.to_string())?;
    }
    if let Some(win) = app.get_webview_window("palette") {
        let _ = win.hide();
    }
    // Hand focus back to the app that was frontmost before the palette, let it
    // become key, THEN synthesize the paste — all main-thread work, since macOS
    // event/accessibility APIs (CGEvent via enigo) are main-thread-only and crash
    // the app when called from a spawned thread.
    let app2 = app.clone();
    std::thread::spawn(move || {
        // Let the palette finish hiding before we re-activate the target app.
        std::thread::sleep(std::time::Duration::from_millis(120));
        #[cfg(target_os = "macos")]
        {
            let _ = app2.run_on_main_thread(reactivate_prev_app);
            // Give the reactivated app a beat to become key before ⌘V lands.
            std::thread::sleep(std::time::Duration::from_millis(90));
        }
        let _ = app2.run_on_main_thread(paste_into_focused_app);
    });
    Ok(())
}

// ── Windows ──────────────────────────────────────────────────────────────────

fn toggle_palette(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("palette") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            // Grab the frontmost app now, before show()/set_focus() steal focus.
            #[cfg(target_os = "macos")]
            capture_frontmost_pid();
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// When the tray panel last hid itself, as epoch millis. The frontend hides on
/// blur (outside-click dismiss); clicking the tray ICON is one such outside
/// click, so that hide races this toggle — see `TRAY_REOPEN_GUARD_MS`.
static TRAY_HIDDEN_AT_MS: AtomicU64 = AtomicU64::new(0);

/// How long after a self-hide a tray-icon click is read as "that click closed
/// the panel" rather than "open it". Clicking the icon while the panel is open
/// fires blur on mouse DOWN and this toggle on mouse UP, so by the time we read
/// `is_visible()` the blur-hide may already have landed — and without this
/// guard the toggle reads `false` and reopens the panel the user just closed.
/// Sized for that gap (one mouse click), not for deliberate reopens.
const TRAY_REOPEN_GUARD_MS: u64 = 400;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Record that the tray panel is being hidden. Called from every hide path so
/// the toggle above can distinguish a blur-hide it caused from a stale one.
fn stamp_tray_hidden() {
    TRAY_HIDDEN_AT_MS.store(now_ms(), Ordering::Relaxed);
}

/// Hide the tray panel and stamp the time. The frontend calls this instead of
/// `getCurrentWindow().hide()` so the tray-icon toggle stays in sync with the
/// blur dismiss.
#[tauri::command]
fn hide_tray(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("tray") {
        stamp_tray_hidden();
        let _ = win.hide();
    }
}

/// Toggle the panel from a click on the tray ICON — the one path that races the
/// frontend's blur-dismiss, because the click that blurs the panel closed is the
/// same click that lands here. Every other caller wants a plain toggle and must
/// keep using `show_tray_under`, or a legitimate open could be swallowed.
fn toggle_tray_from_icon(app: &tauri::AppHandle, cursor: PhysicalPosition<f64>) {
    let visible = app
        .get_webview_window("tray")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    // Not visible — but if it hid within the guard window, this is the mouse UP
    // of the very click whose mouse DOWN blurred it closed. Reopening here is
    // what makes closing take two clicks (and reads as a click that did
    // nothing). Swallow it; the next click opens normally.
    if !visible
        && now_ms().saturating_sub(TRAY_HIDDEN_AT_MS.load(Ordering::Relaxed)) < TRAY_REOPEN_GUARD_MS
    {
        return;
    }
    show_tray_under(app, cursor);
}

fn show_tray_under(app: &tauri::AppHandle, cursor: PhysicalPosition<f64>) {
    if let Some(win) = app.get_webview_window("tray") {
        if win.is_visible().unwrap_or(false) {
            stamp_tray_hidden();
            let _ = win.hide();
            return;
        }
        let scale = win.scale_factor().unwrap_or(2.0);
        let win_w = win
            .outer_size()
            .map(|s| s.width as f64)
            .unwrap_or(360.0 * scale);
        let margin = 8.0 * scale;
        // Clamp within the WORK AREA of the monitor the tray icon is on (cursor
        // position), not the primary one — they differ on multi-display setups.
        // Work area is the screen minus the taskbar/dock on whichever edge it
        // occupies (Win32 `rcWork`), so the panel stays clear of it without this
        // code having to know where the taskbar is. Windows 11 only allows a
        // bottom taskbar, but Windows 10 allows all four edges.
        let work = win
            .available_monitors()
            .ok()
            .and_then(|monitors| {
                monitors.into_iter().find(|m| {
                    let p = m.position();
                    let s = m.size();
                    let (x0, y0) = (p.x as f64, p.y as f64);
                    cursor.x >= x0
                        && cursor.x < x0 + s.width as f64
                        && cursor.y >= y0
                        && cursor.y < y0 + s.height as f64
                })
            })
            .or_else(|| win.primary_monitor().ok().flatten())
            .map(|m| {
                // macOS keeps the full monitor rect it has always used. Its
                // work_area is the NSScreen visibleFrame, which also subtracts the
                // menu bar and Dock, so adopting it there would shift long-standing
                // menubar placement for a problem macOS does not have.
                #[cfg(target_os = "macos")]
                {
                    let p = m.position();
                    let s = m.size();
                    (p.x as f64, p.y as f64, s.width as f64, s.height as f64)
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let a = m.work_area();
                    (
                        a.position.x as f64,
                        a.position.y as f64,
                        a.size.width as f64,
                        a.size.height as f64,
                    )
                }
            });

        let clamp_x = |mut x: f64| {
            let (min_x, max_x) = match work {
                Some((wx, _, ww, _)) => (wx + margin, wx + ww - win_w - margin),
                None => (margin, f64::MAX),
            };
            if x > max_x {
                x = max_x;
            }
            x.max(min_x)
        };

        let (x, y) = {
            #[cfg(target_os = "macos")]
            {
                let x = clamp_x(cursor.x - 24.0 * scale);
                let y = cursor.y + 6.0 * scale;
                (x, y)
            }
            #[cfg(not(target_os = "macos"))]
            {
                let x = clamp_x(cursor.x - win_w + 24.0 * scale);
                // Anchor the panel's BOTTOM just above the click point. This used
                // to guess `480.0 * scale`, which overshoots the real 400-logical
                // panel by 80 logical px (160 physical at 200%), leaving the panel
                // visibly floating above the taskbar instead of sitting on it.
                // Measure the window instead of estimating it.
                let win_h = win
                    .outer_size()
                    .map(|s| s.height as f64)
                    .unwrap_or(400.0 * scale);
                // Prefer opening ABOVE the click, which is right for the bottom
                // taskbar (the only option on Win11). If that would run past the
                // top of the work area — a top taskbar on Win10, or simply not
                // enough room above — drop below the click instead, then clamp so
                // the panel never lands under the taskbar on any edge.
                let mut y = cursor.y - win_h - margin;
                match work {
                    Some((_, wy, _, wh)) => {
                        if y < wy + margin {
                            y = cursor.y + margin;
                        }
                        let max_y = wy + wh - win_h - margin;
                        if y > max_y {
                            y = max_y;
                        }
                        y = y.max(wy + margin);
                    }
                    None => y = y.max(margin),
                }
                (x, y)
            }
        };

        let _ = win.set_position(PhysicalPosition::new(x, y));
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Open the markdown viewer window (`?view=viewer`) for a customized skill —
/// the tray's "See changes" action (U7/R14). The viewer is the only surface
/// that shows YOUR edited version and the yours-vs-theirs diff. The window is
/// preconfigured in tauri.conf.json; we rebuild its query with the requested
/// `skill` lineage ref so it (re)loads that skill, then show + focus it.
/// `skill` is allowlisted to a single conservative ref token (never flag-shaped
/// argv), the same guard `edit_diff` uses.
/// Navigate the preconfigured `viewer` window to `skill` and show + focus it.
/// Shared by the `open_viewer` command (tray "See changes") and the
/// `skillet://compare` deep link (web "See changes"), so both open the viewer
/// identically. `skill` is allowlisted to a single conservative ref token (never
/// flag-shaped argv), the same guard `edit_diff` uses.
fn show_viewer_for(app: &tauri::AppHandle, skill: &str) -> Result<(), String> {
    if !valid_edit_target(skill) {
        return Err("invalid edits target".into());
    }
    let win = app
        .get_webview_window("viewer")
        .ok_or_else(|| "viewer window not found".to_string())?;
    // Rebuild the query on the window's own URL (tauri://… in prod, the dev
    // server in dev), so the viewer reloads on the requested ref. query_pairs_mut
    // percent-encodes the ref; the viewer's URLSearchParams decodes it back.
    let mut url = win.url().map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .clear()
        .append_pair("view", "viewer")
        .append_pair("skill", skill);
    win.navigate(url).map_err(|e| e.to_string())?;
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

#[tauri::command]
fn open_viewer(app: tauri::AppHandle, skill: String) -> Result<(), String> {
    show_viewer_for(&app, &skill)
}

/// Parse a `skillet://compare/<author>/<slug>` deep link into the canonical
/// `@owner/slug` lineage ref the viewer resolves against — the same shape the
/// tray's "See changes" passes to `open_viewer`. The web sends the @-less API
/// ref (`author/slug`); without the leading `@`, the viewer's `parseSkillRef`
/// reads the whole thing as a bare slug, `resolveSkillForRef` can't match
/// `kit_status`, and it reports "not materialized" even though the skill is
/// present. Returns None for any other scheme/host, a path that isn't exactly
/// two segments, or a flag-shaped/junk segment (each must pass `valid_edit_target`
/// on its own before the ref is built — defense in depth for the CLI argv).
fn parse_compare_ref(url: &url::Url) -> Option<String> {
    if url.scheme() != "skillet" || url.host_str() != Some("compare") {
        return None;
    }
    let segs: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
    if segs.len() != 2 {
        return None;
    }
    let (author, slug) = (segs[0], segs[1]);
    if !valid_edit_target(author) || !valid_edit_target(slug) {
        return None;
    }
    Some(format!("@{author}/{slug}"))
}

// Browsing, publishing, profiles, the follow graph — all live on the web. The
// native app is the syncer; "Open Skillet" hands off to the web app in the browser.
#[tauri::command]
fn open_web(path: Option<String>) {
    let base = std::env::var("SKILLET_WEB_URL").unwrap_or_else(|_| "https://skillet.md".into());
    // SECURITY: only ever open the Skillet web origin + a relative path. The
    // previous `Some(p) if !p.is_empty() => p` arm let the webview hand an
    // arbitrary URL/string to the system opener; a compromised renderer could
    // launch `open <anything>`. Non-relative input now falls back to `base`.
    let url = match path {
        Some(p) if p.starts_with('/') => format!("{base}{p}"),
        _ => base,
    };
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let _ = hidden_command("cmd")
        .args(["/C", "start", "", &url])
        .spawn();
    #[cfg(target_os = "linux")]
    let _ = Command::new("xdg-open").arg(&url).spawn();
}

// ── Accessibility permission ─────────────────────────────────────────────────
// Paste into focused app synthesizes Cmd+V, which needs Accessibility trust on macOS.

#[tauri::command]
fn accessibility_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_accessibility_client::accessibility::application_is_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Marks that this app has already raised the Accessibility prompt once.
///
/// macOS shows that prompt at most once per app: every later call to
/// `application_is_trusted_with_prompt` is a silent no-op. Nothing in the API
/// reports "already asked" — `application_is_trusted()` is equally false before
/// the first ask and after a refusal — so the only way to tell a first ask from
/// a repeat is to remember it. Same shape as the onboarding flag.
#[cfg(target_os = "macos")]
fn accessibility_asked_flag() -> std::path::PathBuf {
    std::path::Path::new(&skillet_home()).join(".skillet-accessibility-asked")
}

/// Ask for Accessibility, one surface at a time.
///
/// This used to fire the native prompt AND open System Settings in the same
/// breath, so a first-time ask put a system dialog and a settings window on
/// screen together and made the app look like it was demanding two things.
/// The redirect was there because a second press does nothing visible, which
/// is true — but that is a reason to branch, not to always do both.
#[tauri::command]
fn request_accessibility() {
    #[cfg(target_os = "macos")]
    {
        let flag = accessibility_asked_flag();
        if flag.exists() {
            // The prompt is spent. Settings is the only surface left.
            open_privacy_pane("Privacy_Accessibility");
            return;
        }
        if let Some(parent) = flag.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&flag, "1");
        macos_accessibility_client::accessibility::application_is_trusted_with_prompt();
    }
}

/// Whether the Accessibility prompt has already been spent on this machine.
/// Surfaces read this to label the action honestly: "Allow" the first time,
/// "Open System Settings" after.
#[tauri::command]
fn accessibility_asked() -> bool {
    #[cfg(target_os = "macos")]
    {
        accessibility_asked_flag().exists()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Open one anchor of System Settings ▸ Privacy & Security.
///
/// Uses the MODERN pane id (`com.apple.settings.PrivacySecurity.extension`).
/// The legacy `com.apple.preference.security` form still resolves for
/// Accessibility, but Files and Folders has no legacy anchor at all, so one
/// modern helper keeps both links on the same spelling instead of leaving a
/// lone legacy string to rot next to a modern one.
#[cfg(target_os = "macos")]
fn open_privacy_pane(anchor: &str) {
    let _ = std::process::Command::new("open")
        .arg(format!(
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?{anchor}"
        ))
        .spawn();
}

/// The `tccutil` service name for a protected-folder anchor.
///
/// A fixed mapping, not string interpolation. The anchor arrives from the
/// webview, and this is what keeps it out of the command's argument list: an
/// unrecognised path maps to None and no process is spawned at all.
fn tccutil_service_for(anchor: &str) -> Option<&'static str> {
    match std::path::Path::new(anchor).file_name()?.to_str()? {
        "Documents" => Some("SystemPolicyDocumentsFolder"),
        "Desktop" => Some("SystemPolicyDesktopFolder"),
        "Downloads" => Some("SystemPolicyDownloadsFolder"),
        _ => None,
    }
}

/// Re-arm the macOS folder-access prompt for one protected folder.
///
/// Once a grant is refused, TCC records the denial and never asks again, so
/// "try again" is not something the app can do by retrying its own work.
/// Resetting this bundle's own entry for that service is what makes the next
/// user-initiated sync able to prompt at all.
///
/// Best-effort by design. `tccutil` needs no elevation to reset an app's own
/// entries today, but it is a shell-out to a tool Apple has tightened before,
/// and it exits non-zero when there is no entry to reset. The caller always
/// falls through to System Settings, so the button lands somewhere useful
/// whatever this returns.
///
/// No marker bookkeeping: a successful user-initiated read afterwards calls
/// recordTccGrant, which clears the suspension in tcc-access.json on its own.
#[tauri::command]
fn reset_folder_access(app: tauri::AppHandle, anchor: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let service = tccutil_service_for(&anchor).ok_or("not a protected folder")?;
        let bundle_id = app.config().identifier.clone();
        let status = hidden_command("tccutil")
            .args(["reset", service, &bundle_id])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("tccutil exited {status}"));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, anchor);
        Err("folder access is a macOS concept".to_string())
    }
}

/// Files and Folders — the recovery route for a REFUSED folder grant.
///
/// macOS records a denial and never prompts again, so the tray's needs-access
/// notice cannot fix a denied folder by re-running the sync however many times
/// it is pressed. Leaving the app is the only move left, and until this existed
/// there was nothing to leave to: the app shipped copy telling people to open
/// System Settings with no way to take them there.
#[tauri::command]
fn open_folder_access_settings() {
    #[cfg(target_os = "macos")]
    {
        open_privacy_pane("Privacy_FilesAndFolders");
    }
}

/// Clear local registry credentials via the CLI sidecar (session, device, identity).
/// `auth disconnect` unregisters the device and revokes the session server-side
/// before clearing local files — don't run `auth logout` first, or the session
/// it needs for the device DELETE is already gone.
#[tauri::command]
fn logout() -> Result<(), String> {
    run_skillet(&["auth", "disconnect"]).map(|_| ())
}

/// Home dir for confining filesystem-opening IPC (macOS/Linux `HOME`, Windows
/// `USERPROFILE`).
fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .map(std::path::PathBuf::from)
}

/// Canonicalized roots a skills folder may legitimately live under: the user's
/// home, the Skillet data dir, and any advanced-setup roots in
/// `SKILLET_SKILL_ROOTS` (colon/semicolon-separated, matching the CLI). Advanced
/// users can point runtimes at skills dirs outside $HOME via that env, so a
/// home-only confinement would silently refuse to open their real folders.
fn allowed_skill_roots() -> Vec<std::path::PathBuf> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Some(h) = home_dir() {
        roots.push(h);
    }
    roots.push(std::path::PathBuf::from(skillet_home()));
    if let Ok(extra) = std::env::var("SKILLET_SKILL_ROOTS") {
        for part in extra
            .split(|c| c == ':' || c == ';')
            .filter(|s| !s.is_empty())
        {
            roots.push(std::path::PathBuf::from(part));
        }
    }
    roots
        .into_iter()
        .filter_map(|r| std::fs::canonicalize(r).ok())
        .collect()
}

/// True when `p` resolves under one of the allowed skill roots.
fn is_allowed_skill_dir(p: &std::path::Path) -> bool {
    allowed_skill_roots().iter().any(|root| p.starts_with(root))
}

/// Reveal a runtime's skills folder in the system file manager.
#[tauri::command]
fn open_folder(path: String) {
    // SECURITY: `path` arrives from the webview. Confine it to an EXISTING
    // DIRECTORY under an allowed skill root before handing it to the system
    // opener — otherwise a compromised renderer could drive `open` at an
    // arbitrary file or app bundle (e.g. /Applications/Calculator.app, which is
    // itself a dir). Allowed roots are $HOME, the Skillet data dir, and any
    // SKILLET_SKILL_ROOTS entries (so advanced out-of-$HOME setups still work).
    // Expand a leading `~/` — canonicalize() does NOT do shell tilde expansion,
    // so a path like "~/.claude/skills" would silently fail to resolve.
    let expanded = match path.strip_prefix("~/") {
        Some(rest) => match std::env::var("HOME") {
            Ok(home) => format!("{home}/{rest}"),
            Err(_) => path.clone(),
        },
        None => path.clone(),
    };
    let canon = match std::fs::canonicalize(&expanded) {
        Ok(c) => c,
        Err(_) => return,
    };
    if !canon.is_dir() || !is_allowed_skill_dir(&canon) {
        return;
    }
    // macOS `open <dir>` LAUNCHES an application bundle (a .app is itself a dir
    // that passes is_dir), so a malicious bundle dropped under $HOME could be
    // started. `open -R` only REVEALS the path in Finder, never launches it —
    // and "reveal the skills folder" is this command's actual intent.
    #[cfg(target_os = "macos")]
    let _ = Command::new("open")
        .arg("-R")
        .arg(canon.as_os_str())
        .spawn();
    #[cfg(target_os = "windows")]
    let _ = hidden_command("explorer").arg(canon.as_os_str()).spawn();
    #[cfg(target_os = "linux")]
    let _ = Command::new("xdg-open").arg(canon.as_os_str()).spawn();
}

/// Text file extensions the viewer renders inline. Anything else is treated as
/// binary — surfaced in the sidebar as a size note, never streamed into the DOM.
fn is_text_file(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "md" | "markdown"
                    | "mdx"
                    | "txt"
                    | "json"
                    | "jsonc"
                    | "yaml"
                    | "yml"
                    | "toml"
                    | "csv"
                    | "tsv"
                    | "sh"
                    | "bash"
                    | "zsh"
                    | "js"
                    | "cjs"
                    | "mjs"
                    | "ts"
                    | "tsx"
                    | "jsx"
                    | "py"
                    | "rb"
                    | "go"
                    | "rs"
                    | "css"
                    | "scss"
                    | "html"
                    | "xml"
                    | "svg"
                    | "sql"
                    | "env"
                    | "ini"
                    | "conf"
                    | "toml.lock"
                    | "lock"
            )
        })
        .unwrap_or(false)
}

/// Bundle root for a skill = the directory holding its SKILL.md. Confined to an
/// allowed skill root, same rule as open_folder.
fn skill_bundle_root(skill_md_path: &str) -> Result<PathBuf, String> {
    let file = std::fs::canonicalize(skill_md_path).map_err(|e| e.to_string())?;
    let root = file
        .parent()
        .ok_or_else(|| "no parent dir".to_string())?
        .to_path_buf();
    if !root.is_dir() || !is_allowed_skill_dir(&root) {
        return Err("not an allowed skill dir".into());
    }
    Ok(root)
}

/// List every file in a skill's bundle for the viewer sidebar. `skill_md_path`
/// is the SKILL.md path from the CLI list; its parent directory is the bundle
/// root. Returns a JSON manifest of bundle-relative paths (SKILL.md first, then
/// case-insensitive), each flagged text vs binary so the webview can lazy-load
/// one via `skill_file`. Bounded in count and depth so a pathological dir can't
/// wedge the UI; symlinks are never followed out of the bundle.
#[tauri::command]
fn skill_files(skill_md_path: String) -> Result<String, String> {
    let root = skill_bundle_root(&skill_md_path)?;
    let mut files: Vec<serde_json::Value> = Vec::new();
    let mut stack = vec![root.clone()];
    let mut count = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for ent in entries.flatten() {
            let Ok(meta) = ent.metadata() else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            let p = ent.path();
            if meta.is_dir() {
                let depth = p
                    .strip_prefix(&root)
                    .map(|r| r.components().count())
                    .unwrap_or(99);
                if depth <= 6 {
                    stack.push(p);
                }
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            count += 1;
            if count > 2000 {
                break;
            }
            let Ok(rel) = p.strip_prefix(&root) else {
                continue;
            };
            let rel = rel.to_string_lossy().replace('\\', "/");
            files.push(serde_json::json!({
                "rel": rel,
                "size": meta.len(),
                "binary": !is_text_file(&p),
            }));
        }
        if count > 2000 {
            break;
        }
    }
    files.sort_by(|a, b| {
        let ar = a["rel"].as_str().unwrap_or("");
        let br = b["rel"].as_str().unwrap_or("");
        (ar != "SKILL.md", ar.to_lowercase()).cmp(&(br != "SKILL.md", br.to_lowercase()))
    });
    serde_json::to_string(&serde_json::json!({ "files": files })).map_err(|e| e.to_string())
}

/// Read one text file from a skill's bundle for the viewer. `rel` is a bundle-
/// relative path; it must stay inside the confined root (no absolute path, no
/// `..` escape) and resolve to a real regular file. Binary or oversized files
/// return a flag instead of content so the DOM never ingests raw bytes.
#[tauri::command]
fn skill_file(skill_md_path: String, rel: String) -> Result<String, String> {
    let root = skill_bundle_root(&skill_md_path)?;
    let relp = Path::new(&rel);
    if relp.is_absolute()
        || relp.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::Prefix(_)
            )
        })
    {
        return Err("invalid path".into());
    }
    let target = std::fs::canonicalize(root.join(relp)).map_err(|e| e.to_string())?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err("outside bundle".into());
    }
    let meta = std::fs::metadata(&target).map_err(|e| e.to_string())?;
    let binary = !is_text_file(&target);
    let too_big = meta.len() > 1_000_000; // 1 MB inline cap
    if binary || too_big {
        return serde_json::to_string(&serde_json::json!({
            "rel": rel, "binary": binary, "tooBig": too_big, "size": meta.len(), "content": "",
        }))
        .map_err(|e| e.to_string());
    }
    let content = std::fs::read_to_string(&target).map_err(|e| e.to_string())?;
    serde_json::to_string(&serde_json::json!({
        "rel": rel, "binary": false, "tooBig": false, "size": meta.len(), "content": content,
    }))
    .map_err(|e| e.to_string())
}

// ── Onboarding gate ──────────────────────────────────────────────────────────

fn onboarded_flag() -> std::path::PathBuf {
    std::path::Path::new(&skillet_home()).join(".skillet-onboarded")
}

fn is_onboarded() -> bool {
    onboarded_flag().exists()
}

#[tauri::command]
fn finish_onboarding(app: tauri::AppHandle) {
    let path = onboarded_flag();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, "1");
    if let Some(win) = app.get_webview_window("onboarding") {
        let _ = win.close();
    }
    // Become a menubar-only accessory now that the welcome flow is done.
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    // "Open Skillet" must open something: summon the tray panel as if the
    // icon was clicked, positioned from the icon's real rect when available
    // (falling back to the menubar's right end).
    use tauri::Manager;
    let cursor = app
        .try_state::<TrayHandle>()
        .and_then(|h| h.0.rect().ok().flatten())
        .map(|r| {
            let (x, w) = match (r.position, r.size) {
                (tauri::Position::Physical(p), tauri::Size::Physical(sz)) => {
                    (p.x as f64, sz.width as f64)
                }
                (tauri::Position::Logical(p), tauri::Size::Logical(sz)) => (p.x, sz.width),
                (tauri::Position::Physical(p), _) => (p.x as f64, 48.0),
                (tauri::Position::Logical(p), _) => (p.x, 24.0),
            };
            PhysicalPosition::new(x + w / 2.0, 2.0)
        })
        .unwrap_or_else(|| {
            let width = app
                .get_webview_window("tray")
                .and_then(|w| w.primary_monitor().ok().flatten())
                .map(|m| m.size().width as f64)
                .unwrap_or(2880.0);
            PhysicalPosition::new(width - 200.0, 2.0)
        });
    show_tray_under(&app, cursor);
}

/// Tray icon handle, managed so commands can position the panel without a click.
struct TrayHandle(tauri::tray::TrayIcon);

// ── Global shortcut (configurable) ───────────────────────────────────────────
// Default ⌥⇧S on macOS / Ctrl+Shift+S elsewhere — a deliberate two-modifier chord
// that doesn't clash with launchers (⌥Space is Alfred's) or clobber a character.
// Persisted so the user can rebind it.

fn shortcut_config_path() -> std::path::PathBuf {
    std::path::Path::new(&skillet_home()).join("skillet-shortcut")
}

fn default_shortcut() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Alt+Shift+KeyS"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Control+Shift+KeyS"
    }
}

fn load_shortcut() -> String {
    std::fs::read_to_string(shortcut_config_path())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_shortcut().to_string())
}

#[tauri::command]
fn get_shortcut() -> String {
    load_shortcut()
}

#[tauri::command]
fn set_shortcut(app: tauri::AppHandle, accel: String) -> Result<String, String> {
    let shortcut = Shortcut::from_str(&accel).map_err(|e| e.to_string())?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(shortcut).map_err(|e| e.to_string())?;
    let path = shortcut_config_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, &accel);
    Ok(accel)
}

// While the rebind recorder is armed, the current combo must not be live as a
// global shortcut — the OS would deliver it to the toggle handler instead of
// the webview, so pressing the existing shortcut could never re-record it.
#[tauri::command]
fn suspend_shortcut(app: tauri::AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}

/// Re-register the stored shortcut after a cancelled or failed rebind.
#[tauri::command]
fn resume_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    let shortcut = Shortcut::from_str(&load_shortcut()).map_err(|e| e.to_string())?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(shortcut).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_palette(app);
                    }
                })
                .build(),
        )
        // The viewer is a single reusable window (open_viewer navigates + shows
        // it). Closing it with the red button would DESTROY it, after which
        // get_webview_window("viewer") returns None and clicking a skill silently
        // fails to reopen. Intercept its close: hide instead, so it persists.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "viewer" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            cli_available,
            kit_status,
            skill_stats_status,
            usage_stats,
            choose_skill_stats,
            auth_status,
            device_sync_stream_config,
            avatar_data_uri,
            sync_skills,
            detect_runtimes,
            check_sync,
            pending_updates,
            list_edits,
            edits_check,
            edit_diff,
            connect,
            hide_tray,
            rename_device,
            upload_skills,
            import_discovered,
            logout,
            open_folder,
            skill_files,
            skill_file,
            get_shortcut,
            set_shortcut,
            suspend_shortcut,
            resume_shortcut,
            insert_skill,
            quit_app,
            open_viewer,
            open_web,
            accessibility_granted,
            request_accessibility,
            accessibility_asked,
            open_folder_access_settings,
            reset_folder_access,
            finish_onboarding
        ])
        .setup(|app| {
            // Pin the real app version before anything can shell out to the
            // sidecar — every `run_skillet*` call stamps it onto the request.
            let _ = APP_VERSION.set(app.package_info().version.to_string());

            // Accessory (menubar-only) once onboarded; Regular during first run so
            // the onboarding window can take focus over whatever app is in front.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(if is_onboarded() {
                tauri::ActivationPolicy::Accessory
            } else {
                tauri::ActivationPolicy::Regular
            });

            // Web "See changes" → skillet://compare/<author>/<slug> opens the
            // viewer on that skill's yours-vs-theirs diff. macOS delivers the URL
            // to the running instance via on_open_url, or via get_current when the
            // link cold-launched the app. Only macOS is registered (U1); Windows/
            // Linux keep the web's toast fallback (they'd also need single-instance).
            {
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        if let Some(skill) = parse_compare_ref(&url) {
                            let _ = show_viewer_for(&handle, &skill);
                        }
                    }
                });
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let handle = app.handle().clone();
                    for url in urls {
                        if let Some(skill) = parse_compare_ref(&url) {
                            let _ = show_viewer_for(&handle, &skill);
                        }
                    }
                }
            }

            // Configured global shortcut (default ⌥⇧S) → palette.
            if let Ok(shortcut) = Shortcut::from_str(&load_shortcut()) {
                let _ = app.global_shortcut().register(shortcut);
            }

            // Tray icon → dropdown. The favicon mark on a colored rounded badge —
            // never template mode, since template would flatten the badge into a
            // solid silhouette.
            //
            // Non-prod registry (SKILLET_REGISTRY_URL set, e.g. localhost dev): the
            // badge turns orange so the menu bar shows at a glance that this
            // tray is NOT talking to prod. The sidecar CLI reads the same env var,
            // so the icon reflects where syncs actually go.
            let dev_registry = non_prod_registry_url();
            let tray_img = if dev_registry.is_some() {
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon-dev@2x.png"))
                    .expect("dev tray icon")
            } else {
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                    .expect("tray icon")
            };
            let mut tray_builder = TrayIconBuilder::new().icon(tray_img);
            if let Some(url) = &dev_registry {
                tray_builder = tray_builder.tooltip(format!("Skillet — {url}"));
            }
            #[cfg(target_os = "macos")]
            {
                tray_builder = tray_builder.icon_as_template(false);
            }
            let tray_icon = tray_builder
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        toggle_tray_from_icon(tray.app_handle(), position);
                    }
                })
                .build(app)?;
            // Handle kept so finish_onboarding can summon the panel under the
            // icon without a click — "Open Skillet" must visibly open something.
            app.manage(TrayHandle(tray_icon));

            // The same non-prod tell on the window (and so the taskbar) icon. The
            // tray alone is not enough on Windows: the taskbar tile comes from the
            // bundled icon.ico, so a dev build looked identical to a prod one there.
            // Rendered from vector at 48px (scripts/gen-icons.mjs) — 48 divides
            // evenly into the 24px taskbar tile and the 16px small icon.
            if dev_registry.is_some() {
                for (_, win) in app.webview_windows() {
                    if let Ok(icon) =
                        tauri::image::Image::from_bytes(include_bytes!("../icons/app-icon-dev.png"))
                    {
                        let _ = win.set_icon(icon);
                    }
                }
            }

            // First run: greet, sync, ask for the one permission. Otherwise close
            // the onboarding webview so its timers never run in the background.
            if let Some(win) = app.get_webview_window("onboarding") {
                if is_onboarded() {
                    let _ = win.close();
                } else {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Skillet");
}

#[cfg(test)]
mod folder_access_tests {
    use super::tccutil_service_for;

    // The anchor comes from the webview. Only the three real protected folders
    // may reach a spawned command, and they reach it as a fixed service name,
    // never as the caller's own string.
    #[test]
    fn maps_each_protected_folder_to_its_service() {
        assert_eq!(
            tccutil_service_for("/Users/x/Documents"),
            Some("SystemPolicyDocumentsFolder")
        );
        assert_eq!(
            tccutil_service_for("/Users/x/Desktop"),
            Some("SystemPolicyDesktopFolder")
        );
        assert_eq!(
            tccutil_service_for("/Users/x/Downloads"),
            Some("SystemPolicyDownloadsFolder")
        );
    }

    #[test]
    fn refuses_anything_else() {
        assert_eq!(tccutil_service_for("/Users/x/.claude/skills"), None);
        assert_eq!(tccutil_service_for("/Users/x/Documents/nested"), None);
        assert_eq!(tccutil_service_for(""), None);
        assert_eq!(tccutil_service_for("/"), None);
        // Shell metacharacters are not special to Command, but they must not
        // resolve to a service either.
        assert_eq!(tccutil_service_for("/tmp/Documents; rm -rf /"), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bug this guards: PATH was split on `:`, which is POSIX-only. On
    /// Windows every entry contains a drive colon and the separator is `;`, so
    /// the split produced non-paths, nothing resolved, and the app silently ran
    /// a stale bundled sidecar instead of the workspace CLI — with no error.
    /// `join_paths` builds the value the platform actually uses, so this fails
    /// on Windows if anyone reintroduces a hardcoded separator.
    #[test]
    fn search_dirs_recovers_every_entry_of_a_platform_path() {
        let want: Vec<PathBuf> = if cfg!(windows) {
            vec![
                PathBuf::from(r"C:\tools\node-v24"),
                PathBuf::from(r"C:\Program Files\nodejs"),
            ]
        } else {
            vec![
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/home/u/.local/bin"),
            ]
        };
        let joined = std::env::join_paths(want.iter()).expect("joinable");
        assert_eq!(search_dirs(Some(joined), &[]), want);
    }

    #[test]
    fn search_dirs_puts_extras_first_and_survives_no_path() {
        let dirs = search_dirs(None, &["/opt/homebrew/bin"]);
        assert_eq!(dirs, vec![PathBuf::from("/opt/homebrew/bin")]);
    }

    #[test]
    fn search_dirs_drops_empty_entries() {
        // A trailing separator yields an empty entry, which would otherwise
        // resolve as the process's current directory.
        let joined =
            std::env::join_paths([PathBuf::from("/a"), PathBuf::from("")]).expect("joinable");
        assert_eq!(search_dirs(Some(joined), &[]), vec![PathBuf::from("/a")]);
    }

    #[test]
    fn exe_names_carry_the_windows_suffix() {
        let names = exe_names("node");
        if cfg!(windows) {
            // .exe first: a bare `node` never resolves on Windows.
            assert_eq!(names, vec!["node.exe".to_string(), "node".to_string()]);
        } else {
            assert_eq!(names, vec!["node".to_string()]);
        }
    }

    #[test]
    fn find_in_dirs_returns_the_first_real_file() {
        let tmp = std::env::temp_dir().join(format!("skillet-find-{}", std::process::id()));
        let present = tmp.join("bin-b");
        std::fs::create_dir_all(&present).expect("mkdir");
        let stem = "toolstub";
        let name = exe_names(stem).remove(0);
        std::fs::write(present.join(&name), b"x").expect("write");

        let dirs = vec![tmp.join("bin-a"), present.clone()];
        assert_eq!(
            find_in_dirs(&dirs, &exe_names(stem)),
            Some(present.join(&name)),
            "should skip the missing dir and find the real file in the next one",
        );
        assert_eq!(find_in_dirs(&dirs, &exe_names("absent")), None);

        // A DIRECTORY with the right name must not count as the executable.
        let decoy = tmp.join("bin-c");
        std::fs::create_dir_all(decoy.join(&name)).expect("mkdir decoy");
        assert_eq!(find_in_dirs(&[decoy], &exe_names(stem)), None);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn pair_code_rejects_wrong_length_and_charset() {
        assert!(!is_valid_pair_code(""));
        assert!(!is_valid_pair_code("abc"));
        assert!(!is_valid_pair_code("abcd1234")); // lowercase
        assert!(!is_valid_pair_code("ABCD0123")); // 0 and 1 excluded
        assert!(is_valid_pair_code("ABCD2345"));
    }

    #[test]
    fn create_no_window_constant_matches_win32() {
        assert_eq!(WINDOWS_CREATE_NO_WINDOW, 0x0800_0000);
    }

    #[test]
    fn rename_output_commander_stderr_reads_as_cli_out_of_date() {
        // The real old-CLI shape: empty stdout, commander help on stderr.
        let err = classify_rename_output("", "Usage: skillet [options] [command]\n\nOptions:\n")
            .unwrap_err();
        assert!(err.contains("CLI out of date"), "{err}");
        let err = classify_rename_output("", "error: unknown command 'device'\n").unwrap_err();
        assert!(err.contains("CLI out of date"), "{err}");
    }

    #[test]
    fn rename_output_commander_stdout_reads_as_cli_out_of_date() {
        let err = classify_rename_output("Usage: skillet [options]\n", "").unwrap_err();
        assert!(err.contains("CLI out of date"), "{err}");
    }

    #[test]
    fn rename_output_passes_through_json_and_real_errors() {
        assert!(classify_rename_output("{\"ok\":true}\n", "").is_ok());
        let err = classify_rename_output("", "Rename failed: name taken\n").unwrap_err();
        assert_eq!(err, "Rename failed: name taken");
    }

    fn compare_ref(s: &str) -> Option<String> {
        parse_compare_ref(&url::Url::parse(s).unwrap())
    }

    #[test]
    fn parse_compare_ref_returns_canonical_at_owner_slug() {
        // The web sends @-less author/slug; the ref must gain the leading @ so the
        // viewer's resolveSkillForRef matches kit_status (else "not materialized").
        assert_eq!(
            compare_ref("skillet://compare/openclaudia/serp-analyzer"),
            Some("@openclaudia/serp-analyzer".to_string())
        );
    }

    #[test]
    fn parse_compare_ref_rejects_wrong_host_and_scheme() {
        assert_eq!(
            compare_ref("skillet://open/openclaudia/serp-analyzer"),
            None
        );
        assert_eq!(compare_ref("https://compare/a/b"), None);
    }

    #[test]
    fn parse_compare_ref_rejects_wrong_segment_count() {
        assert_eq!(compare_ref("skillet://compare/openclaudia"), None); // missing slug
        assert_eq!(compare_ref("skillet://compare/a/b/c"), None); // extra segment
        assert_eq!(compare_ref("skillet://compare/"), None); // host only
    }

    #[test]
    fn parse_compare_ref_rejects_flag_shaped_segment() {
        // A leading-dash segment (would be misread as a CLI flag) is rejected
        // before the ref is built — each segment must pass valid_edit_target.
        assert_eq!(compare_ref("skillet://compare/-rf/x"), None);
        assert_eq!(compare_ref("skillet://compare/openclaudia/-rf"), None);
    }

    #[test]
    fn windows_no_window_creation_flags_platform() {
        #[cfg(windows)]
        assert_eq!(windows_no_window_creation_flags(), WINDOWS_CREATE_NO_WINDOW);
        #[cfg(not(windows))]
        assert_eq!(windows_no_window_creation_flags(), 0);
    }
}
