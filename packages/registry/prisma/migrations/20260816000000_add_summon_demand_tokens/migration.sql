-- Summon demand tokens: keywords-only signal of unmet summon requests.
-- Aggregate-only. No task text, no per-user rows, no identity, no IP.
CREATE TABLE `summon_demand_tokens` (
    `day` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`day`, `token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
