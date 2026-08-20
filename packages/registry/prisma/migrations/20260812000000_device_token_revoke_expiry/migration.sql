-- #464: device tokens gain revocation + sliding idle expiry (parity with
-- sessions/kit_keys/mcp_links). `revoked_at` soft-revokes without deleting the
-- row (preserves machine_id/reclaim); `expires_at` is renewed on each
-- authenticated request. Null `expires_at` means "no expiry" so resolution is
-- safe between this deploy and the backfill below.
ALTER TABLE `devices` ADD COLUMN `revoked_at` INTEGER NULL;
ALTER TABLE `devices` ADD COLUMN `expires_at` INTEGER NULL;

-- Backfill existing rows to a sliding 90-day (7776000s) deadline anchored on
-- last activity. A device idle longer than the window is already past its
-- deadline and re-pairs on next use; an active one has runway and renews.
UPDATE `devices`
  SET `expires_at` = COALESCE(`last_seen_at`, `created_at`) + 7776000
  WHERE `expires_at` IS NULL;
