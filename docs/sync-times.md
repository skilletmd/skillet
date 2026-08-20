# Sync times and freshness

Skillet does not push changes to your machines. The registry holds the source of truth; each device **pulls** on a schedule you trigger (desktop app, manual Sync, or CLI/cron). The website can approve updates and change kits, but only the **app or CLI** writes skills into Claude, Cursor, and the rest.

This doc answers: **how long until a web change shows up locally?** Times below are typical, not guarantees. Network latency and kit size affect full sync duration.

---

## Desktop app (macOS and Windows)

Mac and Windows use the **same** menubar/tray app (`packages/desktop`). Both shell out to the bundled `skillet` CLI for sync. Behavior is identical.

### Built-in schedules

| Mechanism | Interval | What runs | When it applies |
|-----------|----------|-----------|-----------------|
| **Tray open check** | At most every **90 seconds** while the tray window has focus | `skillet sync --check` then full `skillet sync` only if `changed: true` | You open the tray after a web change |
| **Daily auto-sync** | At most **~once per 22 hours** while the app stays open | Full `skillet sync` | App launch (if stale) + hourly staleness check |
| **Post-link onboarding** | Every **5 seconds** for **2.5 minutes** after device link | Full sync | Right after pairing a new device |
| **Pending updates UI** | Every **2 minutes** while tray is open | `skillet pending` (list only, not a full sync) | Manual-review queue visibility |
| **Manual Sync** | Immediate | Full `skillet sync` | You click Sync in the tray |

**Tray closed:** No pending poll and no tray-open check. Only daily auto-sync (if the app process is still running) and manual Sync apply.

**App quit:** Nothing runs. There is no installed background service.

### Typical latency (desktop)

| You did this on the web | When it usually lands on disk |
|---------------------------|-------------------------------|
| Added a skill / toggled a kit | Next time you **open the tray** (within ~90s of last check) or tap **Sync**; otherwise up to **~24h** if the app stays open and you never open the tray |
| Approved an update | Decision is account-wide immediately; **files** update on next full sync (tray open, Sync button, or daily auto-sync). Pending list may refresh within **~2 min** while tray is open |
| Approved from the desktop tray | Immediate full sync after approve |
| Right after linking this device | **~5 seconds** during the 2.5-minute onboarding window |

Unchanged manifests are cheap: the union manifest can **304** via cached ETag; `--check` avoids writing to runtimes when nothing changed.

---

## CLI

The CLI has **no built-in timer**. Freshness is entirely up to you.

| How you sync | Typical use |
|--------------|-------------|
| `skillet sync` | Manual full pull + materialize |
| `skillet sync --check` | Detect changes only (safe to run often; uses ETags, no adapter writes) |
| **cron / launchd / systemd** | Headless daily (or custom) schedule; see [Automating sync](#automating-sync) below |

Recommended pattern for frequent polling without heavy work:

```sh
if skillet sync --check --json | jq -e '.changed == true' >/dev/null 2>&1; then
  SKILLET_DAEMON=1 skillet sync
fi
```

Set `SKILLET_DAEMON=1` on scheduled runs so metrics tag them as daemon activity.

### Typical latency (CLI)

| Situation | When changes land |
|-----------|-------------------|
| You run `skillet sync` after a web change | **Immediate** (network + sync time) |
| You only use cron (e.g. daily at 03:00) | Up to **24 hours** unless you run sync yourself sooner |
| You cron `--check` every 15 min + sync when changed | Within **~15 minutes** of the web change (your schedule) |
| No sync command and no scheduler | **Never** until you run sync |

`skillet mcp` reads `~/.skillet/skills/` as-is; it does not pull from the registry. Run `skillet sync` first.

---

## Web, trust mode, and approvals

- **Your own skills** (published by you): trusted on sync; no review step for your content.
- **Others' updates (manual review default):** stay in the queue until you approve on web or desktop; then the next **full sync** applies files. `--check` reports `changed: true` while gated updates still need materialization.
- **Auto-update mode** (Settings → Account): approved scanned updates apply on the next sync without waiting in the queue.

The web never writes to agent runtimes. Approvals and kit toggles are server-side; **sync** is what materializes them locally.

---

## What a full sync does (why it takes longer than a check)

1. **Union manifest** (`GET /sync/manifest`) with optional ETag 304  
2. **Per-skill pulls** for registry entries (ETag-cached per skill)  
3. **Trust gates** (signature verify, harm scan, optional diff approval)  
4. **Materialize** into each detected runtime (Claude, Cursor, universal `.agents/skills`, etc.)

`skillet sync --check` runs the pull phases and reports `changed` but skips materialize, prune, and lock write when nothing needs applying.

---

## Comparison: desktop apps vs CLI

| | **Desktop (macOS + Windows)** | **CLI** |
|---|-------------------------------|---------|
| **Same sync engine** | Bundled `skillet sync --json` sidecar | `skillet sync` |
| **Built-in auto-sync** | Yes: ~daily while app open; tray-open check every 90s | No; you schedule or run manually |
| **Fast path after web change** | Open tray or tap **Sync** | Run `skillet sync` |
| **Typical passive latency** (no manual action) | Up to **~24 hours** (daily throttle) | **Unbounded** unless cron |
| **Fastest typical latency** (active user) | **Seconds** (tray open + check, or manual Sync) | **Seconds** (manual `skillet sync`) |
| **Right after device link** | **~5s** polling for 2.5 min | One sync in onboarding wizard; then manual |
| **Cheap change detection** | `sync --check` on tray focus | `skillet sync --check` |
| **Pending updates in UI** | Refreshes every **2 min** (tray open); files still need full sync | `skillet pending` (legacy CLI); no background poll |
| **Approve on web → local files** | Next full sync | Next `skillet sync` |
| **Approve in desktop tray** | Immediate sync after approve | N/A (use app or `skillet approve` + `skillet sync`) |
| **While tray / terminal closed** | Daily auto-sync only (if app still running) | Nothing unless scheduler fires |
| **When app / shell exits** | No sync | No sync (unless system scheduler) |
| **Headless / server** | N/A | cron, launchd, or systemd; see [Automating sync](#automating-sync) |
| **Daemon installed by Skillet** | No | No |
| **Metrics on automated runs** | Background sync should use daemon tagging where applicable | `SKILLET_DAEMON=1` on cron |
| **MCP live skills** | Sync first; MCP reads local store | Same: `skillet sync` then `skillet mcp` |

---

## Automating sync

Skillet does **not** install a background daemon. The desktop app already keeps a machine current opportunistically (on launch + roughly once a day while it's open), with no installed service — quit the app and nothing runs.

Opening the **tray** on Mac or Windows runs a lightweight `skillet sync --check` first and only runs a full sync when the registry manifest changed. Daily auto-sync in the background is unchanged.

For headless or server machines without the desktop app, schedule `skillet sync` with your own scheduler. The CLI is built for this: clean exit codes, and `SKILLET_DAEMON=1` tags the activity as `daemon` so automated runs don't count toward the human-only metrics.

`skillet sync --check` hits the registry with cached ETags and reports whether a full `skillet sync` would change anything on disk. It does not materialize into runtimes. Use it in cron when you want to poll often but only apply when needed:

```sh
if skillet sync --check --json | jq -e '.changed == true' >/dev/null 2>&1; then
  SKILLET_DAEMON=1 skillet sync
fi
```

### cron (Linux / macOS)

Once a day at 03:00:

```cron
0 3 * * *  SKILLET_DAEMON=1 /usr/local/bin/skillet sync >> ~/.skillet/sync.log 2>&1
```

### launchd (macOS)

`~/Library/LaunchAgents/md.skillet.sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>md.skillet.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/skillet</string>
    <string>sync</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>SKILLET_DAEMON</key><string>1</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer></dict>
</dict>
</plist>
```

```sh
launchctl load ~/Library/LaunchAgents/md.skillet.sync.plist
```

### systemd timer (Linux)

`~/.config/systemd/user/skillet-sync.service`:

```ini
[Service]
Type=oneshot
Environment=SKILLET_DAEMON=1
ExecStart=/usr/local/bin/skillet sync
```

`~/.config/systemd/user/skillet-sync.timer`:

```ini
[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
systemctl --user enable --now skillet-sync.timer
```

**Notes:** you own the schedule; removing automation is just removing your cron/launchd/systemd entry. A daily cadence is plenty — an unchanged sync is cheap (the manifest 304s). Run as the user whose `~/.skillet` holds the session/device token.

For CI and shared runners, use a kit key (`skillet_k_…`) via `SKILLET_TOKEN` — see the [CLI reference](/docs/cli#headless-authentication).

---

## Related docs

- [Keeping skills updated](../packages/web/content/docs/updates.md) — approvals and auto-update mode (product docs)
- [CLI reference](../packages/web/content/docs/cli.md) — exit codes, `--json`, headless auth
