-- Kit map onboarding (plan 2026-11-16 U9): Save on a computer that isn't
-- connected yet, private backups by content hash, the saved map, and the
-- changes waiting for a computer.
--
-- Additive only. Two nullable columns on existing tables, no backfill:
--   devices.connected_at              when a pair code last connected the row;
--                                     null reads as created_at.
--   machine_pair_codes.map_session_id set on codes an approved map session mints,
--                                     so Settings never reuses one and their
--                                     claim refuses a presented device token.
-- skill_backups never touches `skills` or the sync manifest (KTD7).
-- kit_map_changes.device_id carries no foreign key on purpose: device rows are
-- hard-deleted in several places, and a leftover change must never block that.

-- AlterTable
ALTER TABLE `devices` ADD COLUMN `connected_at` INTEGER NULL;

-- AlterTable
ALTER TABLE `machine_pair_codes` ADD COLUMN `map_session_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `map_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `poll_secret_hash` VARCHAR(191) NOT NULL,
    `proof_hash` VARCHAR(191) NOT NULL,
    `proof_used_at` INTEGER NULL,
    `binding_hash` VARCHAR(191) NULL,
    `label` TEXT NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `expires_at` INTEGER NOT NULL,
    `approved_by_user_id` VARCHAR(191) NULL,
    `approved_at` INTEGER NULL,
    `pair_code` VARCHAR(191) NULL,
    `code_expires_at` INTEGER NULL,
    `code_delivered_at` INTEGER NULL,
    `claimed_at` INTEGER NULL,
    `device_id` VARCHAR(191) NULL,
    `result` VARCHAR(191) NULL,
    `result_json` LONGTEXT NULL,
    `result_at` INTEGER NULL,

    INDEX `idx_map_sessions_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `map_session_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `attempted_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_map_session_attempts_kind_ip_time`(`kind`, `ip`, `attempted_at`),
    INDEX `idx_map_session_attempts_time`(`attempted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_backups` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `name` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `tools` TEXT NOT NULL,
    `size` INTEGER NOT NULL,
    `origin` VARCHAR(191) NOT NULL,
    `sources` TEXT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_skill_backups_user_created`(`user_id`, `created_at`),
    UNIQUE INDEX `uniq_skill_backups_user_hash`(`user_id`, `hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_backup_files` (
    `backup_id` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `blob_hash` VARCHAR(191) NOT NULL,

    INDEX `idx_skill_backup_files_blob`(`blob_hash`),
    PRIMARY KEY (`backup_id`, `path`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kit_maps` (
    `user_id` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `document_json` LONGTEXT NOT NULL,
    `updated_at` INTEGER NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kit_map_changes` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `device_id` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `body_json` LONGTEXT NOT NULL,
    `created_at` INTEGER NOT NULL,
    `claimed_at` INTEGER NULL,
    `acknowledged_at` INTEGER NULL,
    `outcome` VARCHAR(191) NULL,

    INDEX `idx_kit_map_changes_user_open`(`user_id`, `acknowledged_at`),
    INDEX `idx_kit_map_changes_device_open`(`device_id`, `acknowledged_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `skill_backups` ADD CONSTRAINT `skill_backups_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_backup_files` ADD CONSTRAINT `skill_backup_files_backup_id_fkey` FOREIGN KEY (`backup_id`) REFERENCES `skill_backups`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_backup_files` ADD CONSTRAINT `skill_backup_files_blob_hash_fkey` FOREIGN KEY (`blob_hash`) REFERENCES `blobs`(`hash`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_maps` ADD CONSTRAINT `kit_maps_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_map_changes` ADD CONSTRAINT `kit_map_changes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

