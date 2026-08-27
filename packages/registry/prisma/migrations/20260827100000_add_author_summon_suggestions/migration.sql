-- Suggested invocations per author: the three `/skillet @handle <task>` lines a
-- profile shows.
--
-- Three additive nullable columns, no default backfill and no primary-key
-- change, following `20260827000000_add_summon_authed_count`.
--
-- NULL `suggestions` means never generated, which is what the backfill selects
-- on. It is deliberately distinct from a stored empty set, which means
-- generated and the kit could not support a confident line — that author should
-- not be retried on the next run.
--
-- `suggestions_edited_at` is terminal: once an author has corrected their own
-- lines, regeneration skips them permanently rather than trying to merge.

-- AlterTable
ALTER TABLE `authors` ADD COLUMN `suggestions` TEXT NULL;
ALTER TABLE `authors` ADD COLUMN `suggestions_generated_at` INT NULL;
ALTER TABLE `authors` ADD COLUMN `suggestions_edited_at` INT NULL;
