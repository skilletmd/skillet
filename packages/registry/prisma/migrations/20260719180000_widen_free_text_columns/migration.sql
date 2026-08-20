-- Widen free-text columns off Prisma's default VARCHAR(191). Values longer
-- than 191 chars hit ERROR 1406 or silent truncation on load. Prefer TEXT for
-- prose/URLs/notes; LONGTEXT for secrets/keys matching peer columns; VARCHAR(512)
-- for indexed or short-default labels (KTD5/KTD6). No restore of already-truncated
-- rows. MySQL forbids literal DEFAULT on TEXT/BLOB — strip defaults when widening
-- to those types (author_keys.label stays VARCHAR so its default remains).

-- AlterTable
ALTER TABLE `author_delegations` MODIFY `label` TEXT NULL;

-- AlterTable
ALTER TABLE `author_keys` MODIFY `label` VARCHAR(512) NOT NULL DEFAULT 'unnamed';

-- AlterTable
ALTER TABLE `authors` MODIFY `name` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `connected_repos` MODIFY `token_enc` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `connected_repos` MODIFY `selected_dirs` TEXT NULL;

-- AlterTable
ALTER TABLE `devices` MODIFY `label` TEXT NULL;

-- AlterTable
ALTER TABLE `devices` MODIFY `detected_agents` TEXT NULL;

-- AlterTable
ALTER TABLE `devices` MODIFY `client_kinds` TEXT NULL;

-- AlterTable
ALTER TABLE `events` MODIFY `meta` TEXT NULL;

-- AlterTable
ALTER TABLE `kit_invites` MODIFY `label` TEXT NULL;

-- AlterTable
ALTER TABLE `kit_keys` MODIFY `label` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `kits` MODIFY `name` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `kits` MODIFY `description` TEXT NULL;

-- AlterTable
ALTER TABLE `kits` MODIFY `source_repo` VARCHAR(512) NULL;

-- AlterTable
ALTER TABLE `kits` MODIFY `source_ref` VARCHAR(512) NULL;

-- AlterTable
ALTER TABLE `kits` MODIFY `source_path` TEXT NULL;

-- AlterTable
ALTER TABLE `mcp_links` MODIFY `token_secret_enc` LONGTEXT NOT NULL;

-- AlterTable
ALTER TABLE `mirror_review_queue` MODIFY `source_repo` VARCHAR(512) NOT NULL;

-- AlterTable
ALTER TABLE `mirror_review_queue` MODIFY `license` TEXT NULL;

-- AlterTable
ALTER TABLE `mirror_review_queue` MODIFY `screen_notes` TEXT NULL;

-- AlterTable
ALTER TABLE `organizations` MODIFY `name` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `skill_mirrors` MODIFY `source_repo` VARCHAR(512) NOT NULL;

-- AlterTable
ALTER TABLE `skill_mirrors` MODIFY `source_ref` VARCHAR(512) NULL;

-- AlterTable
ALTER TABLE `skill_mirrors` MODIFY `source_path` TEXT NULL;

-- AlterTable
ALTER TABLE `skill_mirrors` MODIFY `source_url` TEXT NULL;

-- AlterTable
ALTER TABLE `skill_mirrors` MODIFY `license` TEXT NULL;

-- AlterTable
ALTER TABLE `skill_moderation_actions` MODIFY `public_reason` TEXT NULL;

-- AlterTable
ALTER TABLE `skill_proposals` MODIFY `decision_note` TEXT NULL;

-- AlterTable
ALTER TABLE `skill_reports` MODIFY `admin_notes` TEXT NULL;

-- AlterTable
ALTER TABLE `skills` MODIFY `description` TEXT NULL;

-- AlterTable
ALTER TABLE `skills` MODIFY `deprecation_message` TEXT NULL;

-- AlterTable
ALTER TABLE `skills` MODIFY `source_repo` VARCHAR(512) NULL;

-- AlterTable
ALTER TABLE `skills` MODIFY `source_url` TEXT NULL;

-- AlterTable
ALTER TABLE `user_github_tokens` MODIFY `token_enc` LONGTEXT NOT NULL;

-- AlterTable
ALTER TABLE `users` MODIFY `author_public_key` LONGTEXT NULL;
