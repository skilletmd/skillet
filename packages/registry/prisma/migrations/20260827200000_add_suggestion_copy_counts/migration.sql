-- Copies of a suggested invocation from a profile.
--
-- A copy is the only step of the funnel this site can observe: the line leaves
-- on someone's clipboard, and a pasted line is indistinguishable from a typed
-- one, so this is a reading in its own right rather than the head of a funnel
-- that joins to skill_summon_counts.
--
-- Aggregate-by-construction, matching skill_summon_counts: a per-(author,
-- skill, day) tally with no per-visitor row, no client id, no IP. The visitors
-- being counted are logged-out strangers on a shared link, so there is
-- deliberately nothing here to identify or de-anonymize.

-- CreateTable
CREATE TABLE `suggestion_copy_counts` (
    `author_id` VARCHAR(191) NOT NULL,
    `skill_id`  VARCHAR(191) NOT NULL,
    `day`       INTEGER NOT NULL,
    `count`     INTEGER NOT NULL DEFAULT 0,

    INDEX `idx_suggestion_copy_author`(`author_id`),
    PRIMARY KEY (`author_id`, `skill_id`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
