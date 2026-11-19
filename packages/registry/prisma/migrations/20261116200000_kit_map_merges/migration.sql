-- Kit map onboarding (plan 2026-11-16 U14): the merges a computer writes for
-- the kit map, with their blind rounds.
--
-- Additive only: one new table, no backfill.
--   map_merges.id is the merge change's id (kit_map_changes.id): one record per
--   drafted merge, its job and originals copied from the change.
-- The merged skill itself is a skill_backups row with origin `merge`.
-- map_merges.device_id carries no foreign key on purpose, like
-- kit_map_changes.device_id: device rows are hard-deleted in several places,
-- and a leftover merge must never block that.

-- CreateTable
CREATE TABLE `map_merges` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(191) NULL,
    `job` VARCHAR(191) NOT NULL,
    `keys_json` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `merged_hash` VARCHAR(191) NULL,
    `brief` TEXT NULL,
    `rounds_json` LONGTEXT NULL,
    `created_at` INTEGER NOT NULL,
    `updated_at` INTEGER NOT NULL,

    INDEX `idx_map_merges_user_created`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `map_merges` ADD CONSTRAINT `map_merges_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
