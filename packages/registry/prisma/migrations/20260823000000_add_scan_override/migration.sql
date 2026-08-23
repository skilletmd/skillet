-- An admin decision that the harm scanner's quarantine on this skill is a false
-- positive, so the skill stays servable while the scanner keeps flagging it.
--
-- Security tooling is the case this exists for. `garrytan/careful` ("Safety
-- guardrails for destructive commands") quarantined because its own test cases
-- name `rm -rf /`; `garrytan/cso` ("Chief Security Officer mode") because its
-- audit checklist lists `forget your instructions` as a pattern to look for.
-- The scanner cannot separate a guard from a payload — they contain the same
-- strings for opposite reasons — and no path or filename heuristic can either,
-- because an attacker controls those too. A human review is the only signal
-- that is not spoofable, so this records one.
--
-- Deliberately NOT a way to un-flag: findings stay visible in the trust panel.
-- It only stops the quarantine from suppressing `latest_hash`.
ALTER TABLE `skills`
  ADD COLUMN `scan_override_at` INT NULL,
  ADD COLUMN `scan_override_by` VARCHAR(191) NULL,
  ADD COLUMN `scan_override_reason` TEXT NULL;
