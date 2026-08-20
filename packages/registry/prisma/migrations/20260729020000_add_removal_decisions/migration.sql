-- Removal consent (kit author drops a skill): per-user decision to prune or keep.
CREATE TABLE `removal_decisions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `skill_id` VARCHAR(191) NOT NULL,
    `kit_id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `decided_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    UNIQUE INDEX `uniq_removal_decisions`(`user_id`, `skill_id`, `kit_id`),
    INDEX `idx_removal_decisions_user`(`user_id`, `decided_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `removal_decisions` ADD CONSTRAINT `removal_decisions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
