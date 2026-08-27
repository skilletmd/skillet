-- Split summon reach by caller class without touching the primary key.
--
-- `authed_count` is a subset of `count`: the summons that arrived with an
-- account-bound principal. Adding the dimension to the composite PK instead
-- would rename the generated compound-key input, so every upsert from a
-- not-yet-restarted process would throw during the deploy window — and
-- emitSummonEvent is fire-and-forget (`.catch(() => {})`), so those summons
-- would disappear with no error surface, indistinguishable from the intended
-- count correction shipping alongside it.
--
-- Existing rows default to 0. That reads as "caller class not recorded",
-- not as "known anonymous"; nothing re-attributes history.

-- AlterTable
ALTER TABLE `skill_summon_counts` ADD COLUMN `authed_count` INT NOT NULL DEFAULT 0;
