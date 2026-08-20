-- Per-user mute of a team (org) kit's auto-sync. Presence of a row means the
-- user has opted that team kit out of syncing; its skills are then dropped from
-- the manifest, the pending-update queue, and the /approvals coverage set.

-- CreateTable
CREATE TABLE `muted_team_kits` (
    `user_id` VARCHAR(191) NOT NULL,
    `kit_id` VARCHAR(191) NOT NULL,
    `muted_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_muted_team_kits_user_id`(`user_id`),
    PRIMARY KEY (`user_id`, `kit_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
