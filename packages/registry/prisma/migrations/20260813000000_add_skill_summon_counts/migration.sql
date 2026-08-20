-- Summon reach counter (plan 012 U6): aggregate-only, no PII, no per-summoner rows.
CREATE TABLE `skill_summon_counts` (
    `skill_id` VARCHAR(191) NOT NULL,
    `via_handle` VARCHAR(191) NOT NULL DEFAULT '',
    `day` INTEGER NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    INDEX `idx_skill_summon_counts_day`(`day`),
    INDEX `idx_skill_summon_counts_skill`(`skill_id`),
    PRIMARY KEY (`skill_id`, `via_handle`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
