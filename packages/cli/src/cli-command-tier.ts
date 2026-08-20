/**
 * Shared skillet.md origin for user-facing URLs in CLI output.
 *
 * Command tiering (device-agent vs web-managed) is NOT modeled here anymore:
 * the single source is the registration split in commands/register-all.ts —
 * device-tier commands register unconditionally, management verbs behind the
 * legacy flag. A parallel path-classifier used to live here and drifted from
 * that registration (the drift once dropped pending/approve/reject and broke
 * the tray), so it was removed.
 */
export function webBaseUrl(): string {
  return (process.env["SKILLET_WEB_URL"] ?? "https://skillet.md").replace(/\/+$/, "");
}
