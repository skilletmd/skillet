-- CreateTable
CREATE TABLE `alerts` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `payload_json` LONGTEXT NOT NULL,
    `raised_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_alerts_kind_user`(`kind`, `user_id`),
    INDEX `idx_alerts_raised_at`(`raised_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `author_delegations` (
    `device_key_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `author_key_id` VARCHAR(191) NOT NULL,
    `device_pub` LONGTEXT NOT NULL,
    `scopes` TEXT NOT NULL,
    `cert_json` LONGTEXT NOT NULL,
    `cert_sig_alg` VARCHAR(191) NOT NULL,
    `cert_sig_key_id` VARCHAR(191) NOT NULL,
    `cert_sig_b64` LONGTEXT NOT NULL,
    `label` VARCHAR(191) NULL,
    `issued_at` INTEGER NOT NULL,
    `expires_at` INTEGER NOT NULL,
    `revoked_at` INTEGER NULL,
    `revocation_sig_b64` LONGTEXT NULL,
    `revocation_json` LONGTEXT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_author_delegations_author_key`(`author_key_id`),
    INDEX `idx_author_delegations_user`(`user_id`),
    PRIMARY KEY (`device_key_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `author_keys` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `key_id` VARCHAR(191) NOT NULL,
    `public_key` LONGTEXT NOT NULL,
    `label` VARCHAR(191) NOT NULL DEFAULT 'unnamed',
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `revoked_at` INTEGER NULL,

    INDEX `idx_author_keys_user_id`(`user_id`),
    UNIQUE INDEX `uniq_author_keys_2`(`user_id`, `key_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `authors` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `avatar_url` TEXT NULL,
    `bio` TEXT NULL,
    `profile_url` TEXT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `is_mirror` INTEGER NOT NULL DEFAULT 0,
    `mirror_source_url` TEXT NULL,
    `mirror_claimed_at` INTEGER NULL,
    `agents_public` INTEGER NOT NULL DEFAULT 1,
    `x_handle` VARCHAR(191) NULL,
    `source_owner_type` VARCHAR(191) NULL,
    `shown_agents` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `blobs` (
    `hash` VARCHAR(191) NOT NULL,
    `bytes` LONGBLOB NULL,
    `size` INTEGER NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `storage_loc` VARCHAR(191) NOT NULL DEFAULT 'inline',

    PRIMARY KEY (`hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `capability_result_cache` (
    `content_key` VARCHAR(191) NOT NULL,
    `capability_version` INTEGER NOT NULL,
    `capabilities_json` LONGTEXT NOT NULL,
    `computed_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_capability_result_cache_version`(`capability_version`),
    PRIMARY KEY (`content_key`, `capability_version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `connected_repos` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `owner` VARCHAR(191) NOT NULL,
    `repo` VARCHAR(191) NOT NULL,
    `default_branch` VARCHAR(191) NULL,
    `token_enc` VARCHAR(191) NULL,
    `last_synced_sha` VARCHAR(191) NULL,
    `last_synced_at` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `selected_dirs` VARCHAR(191) NULL,
    `as_kit` INTEGER NOT NULL DEFAULT 1,
    `publish_as` VARCHAR(191) NULL,

    INDEX `idx_connected_repos_user`(`user_id`),
    UNIQUE INDEX `uniq_connected_repos_2`(`user_id`, `owner`, `repo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_kit_excludes` (
    `device_id` VARCHAR(191) NOT NULL,
    `source_key` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`device_id`, `source_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_skill_edits` (
    `device_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `skill_id` VARCHAR(191) NOT NULL,
    `baseline_version` VARCHAR(191) NULL,
    `baseline_hash` VARCHAR(191) NOT NULL,
    `edited_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_device_skill_edits_user`(`user_id`, `skill_id`),
    UNIQUE INDEX `uniq_device_skill_edits_1`(`device_id`, `skill_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_skill_materializations` (
    `device_id` VARCHAR(191) NOT NULL,
    `skill_slug` VARCHAR(191) NOT NULL,
    `runtime` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `reported_at` INTEGER NOT NULL,

    INDEX `idx_dsm_device_reported`(`device_id`, `reported_at`),
    PRIMARY KEY (`device_id`, `skill_slug`, `runtime`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devices` (
    `id` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `last_seen_at` INTEGER NULL,
    `detected_agents` VARCHAR(191) NULL,
    `agents_reported_at` INTEGER NULL,
    `client_kind` VARCHAR(191) NULL,
    `client_platform` VARCHAR(191) NULL,
    `machine_id` VARCHAR(191) NULL,
    `client_kinds` VARCHAR(191) NULL,

    UNIQUE INDEX `uniq_devices_2`(`token_hash`),
    INDEX `idx_devices_user_machine`(`user_id`, `machine_id`),
    INDEX `idx_devices_user_id`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_login_codes` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `code_hash` VARCHAR(191) NOT NULL,
    `request_ip` VARCHAR(191) NULL,
    `expires_at` INTEGER NOT NULL,
    `consumed_at` INTEGER NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_email_login_codes_email`(`email`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `events` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `initiator` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `device_id` VARCHAR(191) NULL,
    `meta` VARCHAR(191) NULL,
    `ts` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_events_user_ts`(`user_id`, `ts`),
    INDEX `idx_events_name_ts`(`name`, `ts`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follow_counts` (
    `subject_kind` VARCHAR(191) NOT NULL,
    `subject_id` VARCHAR(191) NOT NULL,
    `followers` INTEGER NOT NULL DEFAULT 0,
    `subscribers` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`subject_kind`, `subject_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follows` (
    `follower_user_id` VARCHAR(191) NOT NULL,
    `subject_kind` VARCHAR(191) NOT NULL,
    `subject_id` VARCHAR(191) NOT NULL,
    `is_private` INTEGER NOT NULL DEFAULT 0,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_follows_subject`(`subject_kind`, `subject_id`),
    PRIMARY KEY (`follower_user_id`, `subject_kind`, `subject_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `handle_aliases` (
    `old_handle` VARCHAR(191) NOT NULL,
    `new_handle` VARCHAR(191) NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    PRIMARY KEY (`old_handle`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `key_bind_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `attempted_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_key_bind_attempts_user_time`(`user_id`, `attempted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `key_bind_nonces` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `nonce` VARCHAR(191) NOT NULL,
    `expires_at` INTEGER NOT NULL,
    `consumed_at` INTEGER NULL,

    UNIQUE INDEX `uniq_key_bind_nonces_2`(`nonce`),
    INDEX `idx_key_bind_nonces_user`(`user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kit_invites` (
    `id` VARCHAR(191) NOT NULL,
    `kit_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `handle` VARCHAR(191) NULL,
    `label` VARCHAR(191) NULL,
    `invited_by` VARCHAR(191) NOT NULL,
    `expires_at` INTEGER NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `redeemed_at` INTEGER NULL,
    `kit_key_id` VARCHAR(191) NULL,

    INDEX `idx_kit_invites_email`(`email`),
    INDEX `idx_kit_invites_handle`(`handle`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kit_keys` (
    `id` VARCHAR(191) NOT NULL,
    `kit_id` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `expires_at` INTEGER NULL,
    `revoked_at` INTEGER NULL,

    UNIQUE INDEX `uniq_kit_keys_2`(`token_hash`),
    INDEX `idx_kit_keys_kit_id`(`kit_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kit_members` (
    `kit_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `invited_by` VARCHAR(191) NULL,
    `invited_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `accepted_at` INTEGER NULL,

    INDEX `idx_kit_members_user_id`(`user_id`),
    PRIMARY KEY (`kit_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kit_skills` (
    `kit_id` VARCHAR(191) NOT NULL,
    `skill_id` VARCHAR(191) NOT NULL,
    `pinned_hash` VARCHAR(191) NULL,
    `added_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    PRIMARY KEY (`kit_id`, `skill_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kit_slug_aliases` (
    `owner_id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `kit_id` VARCHAR(191) NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_kit_slug_aliases_kit`(`kit_id`),
    PRIMARY KEY (`owner_id`, `slug`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kit_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `kit_id` VARCHAR(191) NULL,
    `author_id` VARCHAR(191) NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `trust_mode` VARCHAR(191) NULL,

    INDEX `idx_kit_sub_kit_kind`(`kit_id`, `kind`, `created_at`),
    INDEX `idx_kit_sub_author_kind`(`author_id`, `kind`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kit_versions` (
    `id` VARCHAR(191) NOT NULL,
    `kit_id` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `snapshot_json` LONGTEXT NOT NULL,
    `summary` TEXT NULL,
    `editor_id` VARCHAR(191) NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `major` INTEGER NOT NULL DEFAULT 1,
    `minor` INTEGER NOT NULL DEFAULT 0,

    INDEX `idx_kit_versions_kit`(`kit_id`, `version` DESC),
    UNIQUE INDEX `uniq_kit_versions_2`(`kit_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kits` (
    `id` VARCHAR(191) NOT NULL,
    `owner_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `visibility` VARCHAR(191) NOT NULL DEFAULT 'private',
    `profile_hidden` INTEGER NOT NULL DEFAULT 0,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `org_id` VARCHAR(191) NULL,
    `source_type` VARCHAR(191) NOT NULL DEFAULT 'owned',
    `source_repo` VARCHAR(191) NULL,
    `source_ref` VARCHAR(191) NULL,
    `source_path` VARCHAR(191) NULL,
    `last_synced_sha` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `slug` VARCHAR(191) NULL,
    `moderation_status` VARCHAR(191) NOT NULL DEFAULT 'none',
    `is_featured` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `idx_kits_owner_slug`(`owner_id`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `machine_pair_codes` (
    `code` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `expires_at` INTEGER NOT NULL,
    `redeemed_at` INTEGER NULL,
    `redeemed_device_id` VARCHAR(191) NULL,

    INDEX `idx_machine_pair_codes_user`(`user_id`, `expires_at`),
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mcp_call_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `attempted_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `link_id` VARCHAR(191) NULL,

    INDEX `idx_mcp_call_attempts_time`(`attempted_at`),
    INDEX `idx_mcp_call_attempts_link_time`(`link_id`, `attempted_at`),
    INDEX `idx_mcp_call_attempts_ip_time`(`ip`, `attempted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mcp_link_clients` (
    `link_id` VARCHAR(191) NOT NULL,
    `client` VARCHAR(191) NOT NULL,
    `first_used_at` INTEGER NOT NULL,
    `last_used_at` INTEGER NOT NULL,

    PRIMARY KEY (`link_id`, `client`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mcp_links` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `token_secret_enc` VARCHAR(191) NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `revoked_at` INTEGER NULL,
    `last_used_at` INTEGER NULL,

    UNIQUE INDEX `uniq_mcp_links_2`(`token_hash`),
    INDEX `idx_mcp_links_user`(`user_id`, `revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mirror_review_queue` (
    `id` VARCHAR(191) NOT NULL,
    `source_repo` VARCHAR(191) NOT NULL,
    `normalized_repo_key` VARCHAR(191) NOT NULL,
    `source_owner_login` VARCHAR(191) NULL,
    `source_owner_id` INTEGER NULL,
    `derived_handle` VARCHAR(191) NULL,
    `owner_type` VARCHAR(191) NULL,
    `license` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `submitted_by` VARCHAR(191) NULL,
    `screen_notes` VARCHAR(191) NULL,
    `decided_by` VARCHAR(191) NULL,
    `decided_at` INTEGER NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_mirror_review_queue_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_states` (
    `state` VARCHAR(191) NOT NULL,
    `pickup_id` VARCHAR(191) NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `expires_at` INTEGER NOT NULL,
    `consumed_at` INTEGER NULL,

    INDEX `idx_oauth_states_expires`(`expires_at`),
    PRIMARY KEY (`state`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organization_invites` (
    `id` VARCHAR(191) NOT NULL,
    `org_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `handle` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'member',
    `invited_by` VARCHAR(191) NOT NULL,
    `expires_at` INTEGER NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `redeemed_at` INTEGER NULL,

    INDEX `idx_organization_invites_email`(`email`),
    INDEX `idx_organization_invites_handle`(`handle`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organization_members` (
    `org_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'member',
    `invited_by` VARCHAR(191) NULL,
    `invited_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `accepted_at` INTEGER NULL,

    INDEX `idx_organization_members_user_id`(`user_id`),
    PRIMARY KEY (`org_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organizations` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `owner_user_id` VARCHAR(191) NULL,
    `source_owner_id` INTEGER NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    UNIQUE INDEX `uniq_organizations_2`(`slug`),
    INDEX `idx_organizations_slug`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pair_claim_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `attempted_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_pair_claim_attempts_ip_time`(`ip`, `attempted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_keys` (
    `purpose` VARCHAR(191) NOT NULL,
    `key_id` VARCHAR(191) NOT NULL,
    `public_key` LONGTEXT NOT NULL,
    `secret_pem` LONGTEXT NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    PRIMARY KEY (`purpose`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proposal_files` (
    `proposal_id` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `blob_hash` VARCHAR(191) NOT NULL,

    INDEX `idx_proposal_files_blob`(`blob_hash`),
    PRIMARY KEY (`proposal_id`, `path`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proposal_scans` (
    `proposal_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `findings_json` VARCHAR(191) NOT NULL DEFAULT '[]',
    `scanned_at` INTEGER NULL,

    PRIMARY KEY (`proposal_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `publish_log` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `skill_id` VARCHAR(191) NOT NULL,
    `content_hash` VARCHAR(191) NOT NULL,
    `published_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_publish_log_user_time`(`user_id`, `published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scan_cache_metrics` (
    `corpus_version` INTEGER NOT NULL AUTO_INCREMENT,
    `hits` INTEGER NOT NULL DEFAULT 0,
    `misses` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`corpus_version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scan_result_cache` (
    `content_key` VARCHAR(191) NOT NULL,
    `corpus_version` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `findings_json` LONGTEXT NOT NULL,
    `scanned_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_scan_result_cache_corpus`(`corpus_version`),
    PRIMARY KEY (`content_key`, `corpus_version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `search_source_counts` (
    `day` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`day`, `source`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `expires_at` INTEGER NULL,
    `revoked_at` INTEGER NULL,
    `device_id` VARCHAR(191) NULL,

    UNIQUE INDEX `uniq_sessions_2`(`token_hash`),
    INDEX `idx_sessions_user_id`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_aliases` (
    `from_skill_id` VARCHAR(191) NOT NULL,
    `to_skill_id` VARCHAR(191) NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    PRIMARY KEY (`from_skill_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_installers` (
    `skill_id` VARCHAR(191) NOT NULL,
    `installer_kind` VARCHAR(191) NOT NULL,
    `installer_id` VARCHAR(191) NOT NULL,
    `installed_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_skill_installers_skill`(`skill_id`),
    PRIMARY KEY (`skill_id`, `installer_kind`, `installer_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_mirrors` (
    `skill_id` VARCHAR(191) NOT NULL,
    `source_repo` VARCHAR(191) NOT NULL,
    `source_ref` VARCHAR(191) NULL,
    `source_path` VARCHAR(191) NULL,
    `source_url` VARCHAR(191) NULL,
    `license` VARCHAR(191) NULL,
    `computed_hash` VARCHAR(191) NOT NULL,
    `synced_at` INTEGER NOT NULL,
    `blocked_hash` VARCHAR(191) NULL,

    INDEX `idx_skill_mirrors_repo`(`source_repo`),
    PRIMARY KEY (`skill_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_moderation_actions` (
    `id` VARCHAR(191) NOT NULL,
    `skill_id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `public_reason` VARCHAR(191) NULL,
    `acted_by` VARCHAR(191) NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_skill_moderation_actions_skill`(`skill_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_proposals` (
    `id` VARCHAR(191) NOT NULL,
    `skill_id` VARCHAR(191) NOT NULL,
    `base_hash` VARCHAR(191) NULL,
    `proposed_hash` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `proposer_author_id` VARCHAR(191) NOT NULL,
    `signature_alg` VARCHAR(191) NULL,
    `signature_key_id` VARCHAR(191) NULL,
    `signature_b64` LONGTEXT NULL,
    `author_key_id` VARCHAR(191) NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `decided_by` VARCHAR(191) NULL,
    `decided_at` INTEGER NULL,
    `decision_note` VARCHAR(191) NULL,

    INDEX `idx_skill_proposals_skill`(`skill_id`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_reports` (
    `id` VARCHAR(191) NOT NULL,
    `skill_id` VARCHAR(191) NOT NULL,
    `version_hash` VARCHAR(191) NULL,
    `reported_by` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `claims_ownership` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `admin_notes` VARCHAR(191) NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `resolved_at` INTEGER NULL,

    INDEX `idx_skill_reports_reporter`(`reported_by`, `created_at`),
    INDEX `idx_skill_reports_skill`(`skill_id`),
    INDEX `idx_skill_reports_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_runtime_availability` (
    `user_id` VARCHAR(191) NOT NULL,
    `skill_ref` VARCHAR(191) NOT NULL,
    `runtime` VARCHAR(191) NOT NULL,
    `last_seen` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_availability_skill_runtime`(`skill_ref`, `runtime`),
    PRIMARY KEY (`user_id`, `skill_ref`, `runtime`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_version_files` (
    `skill_id` VARCHAR(191) NOT NULL,
    `version_hash` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `blob_hash` VARCHAR(191) NOT NULL,

    INDEX `idx_skill_version_files_blob`(`blob_hash`),
    PRIMARY KEY (`skill_id`, `version_hash`, `path`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_version_provenance` (
    `skill_id` VARCHAR(191) NOT NULL,
    `version_hash` VARCHAR(191) NOT NULL,
    `proposed_by` VARCHAR(191) NOT NULL,
    `approved_by` VARCHAR(191) NOT NULL,
    `proposal_id` VARCHAR(191) NULL,

    PRIMARY KEY (`skill_id`, `version_hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_version_scans` (
    `skill_id` VARCHAR(191) NOT NULL,
    `skill_version_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `findings_json` VARCHAR(191) NOT NULL DEFAULT '[]',
    `scanned_at` INTEGER NULL,
    `capabilities_json` LONGTEXT NULL,
    `capabilities_version` INTEGER NULL,

    PRIMARY KEY (`skill_id`, `skill_version_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_versions` (
    `hash` VARCHAR(191) NOT NULL,
    `skill_id` VARCHAR(191) NOT NULL,
    `signature_alg` VARCHAR(191) NULL,
    `signature_key_id` VARCHAR(191) NULL,
    `signature_b64` LONGTEXT NULL,
    `author_key_id` VARCHAR(191) NULL,
    `metadata_json` LONGTEXT NOT NULL,
    `published_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `published_by` VARCHAR(191) NOT NULL,
    `delegation_json` LONGTEXT NULL,
    `yanked_at` INTEGER NULL,
    `yank_reason` TEXT NULL,
    `sig_version` INTEGER NULL,
    `major` INTEGER NOT NULL DEFAULT 1,
    `minor` INTEGER NOT NULL DEFAULT 0,
    `patch` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`skill_id`, `hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skills` (
    `id` VARCHAR(191) NOT NULL,
    `author_id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `latest_hash` VARCHAR(191) NULL,
    `visibility` VARCHAR(191) NOT NULL DEFAULT 'private',
    `install_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `org_id` VARCHAR(191) NULL,
    `created_by_user_id` VARCHAR(191) NULL,
    `deprecated_at` INTEGER NULL,
    `deprecation_message` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `source_repo` VARCHAR(191) NULL,
    `source_url` VARCHAR(191) NULL,
    `moderation_status` VARCHAR(191) NOT NULL DEFAULT 'none',
    `is_featured` INTEGER NOT NULL DEFAULT 0,

    INDEX `idx_skills_category`(`category`),
    UNIQUE INDEX `uniq_skills_2`(`author_id`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `update_decisions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `skill_id` VARCHAR(191) NOT NULL,
    `version_hash` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `decided_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_update_decisions_decided`(`user_id`, `state`, `decided_at`),
    INDEX `idx_update_decisions_user`(`user_id`, `state`),
    UNIQUE INDEX `uniq_update_decisions_2`(`user_id`, `skill_id`, `version_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_github_tokens` (
    `user_id` VARCHAR(191) NOT NULL,
    `token_enc` VARCHAR(191) NOT NULL,
    `updated_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_identities` (
    `user_id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `provider_subject_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `email_verified` INTEGER NOT NULL DEFAULT 0,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `provider_login` VARCHAR(191) NULL,
    `display_name` TEXT NULL,
    `avatar_url` TEXT NULL,

    INDEX `idx_user_identities_user_id`(`user_id`),
    PRIMARY KEY (`provider`, `provider_subject_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `handle` VARCHAR(191) NULL,
    `author_key_id` VARCHAR(191) NULL,
    `author_public_key` VARCHAR(191) NULL,
    `github_id` VARCHAR(191) NULL,
    `two_factor` INTEGER NOT NULL DEFAULT 0,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
    `suspended_at` INTEGER NULL,
    `is_admin` INTEGER NOT NULL DEFAULT 0,
    `activity_private` INTEGER NOT NULL DEFAULT 0,
    `notifications_seen_at` INTEGER NULL,
    `update_mode` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `attention_seq` INTEGER NOT NULL DEFAULT 0,
    `device_sync_seq` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `uniq_users_2`(`handle`),
    UNIQUE INDEX `uniq_users_3`(`github_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `version_scan_notices` (
    `version_hash` VARCHAR(191) NOT NULL,
    `skill_id` VARCHAR(191) NOT NULL,
    `author_id` VARCHAR(191) NULL,
    `reason` TEXT NOT NULL,
    `created_at` INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),

    INDEX `idx_version_scan_notices_author`(`author_id`, `created_at`),
    PRIMARY KEY (`version_hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `alerts` ADD CONSTRAINT `alerts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `author_delegations` ADD CONSTRAINT `author_delegations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `author_keys` ADD CONSTRAINT `author_keys_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `connected_repos` ADD CONSTRAINT `connected_repos_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `device_kit_excludes` ADD CONSTRAINT `device_kit_excludes_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `device_skill_edits` ADD CONSTRAINT `device_skill_edits_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `device_skill_edits` ADD CONSTRAINT `device_skill_edits_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `follows` ADD CONSTRAINT `follows_follower_user_id_fkey` FOREIGN KEY (`follower_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `key_bind_attempts` ADD CONSTRAINT `key_bind_attempts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `key_bind_nonces` ADD CONSTRAINT `key_bind_nonces_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_invites` ADD CONSTRAINT `kit_invites_kit_key_id_fkey` FOREIGN KEY (`kit_key_id`) REFERENCES `kit_keys`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_invites` ADD CONSTRAINT `kit_invites_invited_by_fkey` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_invites` ADD CONSTRAINT `kit_invites_kit_id_fkey` FOREIGN KEY (`kit_id`) REFERENCES `kits`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_keys` ADD CONSTRAINT `kit_keys_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_keys` ADD CONSTRAINT `kit_keys_kit_id_fkey` FOREIGN KEY (`kit_id`) REFERENCES `kits`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_members` ADD CONSTRAINT `kit_members_invited_by_fkey` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_members` ADD CONSTRAINT `kit_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_members` ADD CONSTRAINT `kit_members_kit_id_fkey` FOREIGN KEY (`kit_id`) REFERENCES `kits`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_skills` ADD CONSTRAINT `kit_skills_skill_id_pinned_hash_fkey` FOREIGN KEY (`skill_id`, `pinned_hash`) REFERENCES `skill_versions`(`skill_id`, `hash`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_skills` ADD CONSTRAINT `kit_skills_skill_id_fkey` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_skills` ADD CONSTRAINT `kit_skills_kit_id_fkey` FOREIGN KEY (`kit_id`) REFERENCES `kits`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_slug_aliases` ADD CONSTRAINT `kit_slug_aliases_kit_id_fkey` FOREIGN KEY (`kit_id`) REFERENCES `kits`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_subscriptions` ADD CONSTRAINT `kit_subscriptions_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_subscriptions` ADD CONSTRAINT `kit_subscriptions_kit_id_fkey` FOREIGN KEY (`kit_id`) REFERENCES `kits`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_subscriptions` ADD CONSTRAINT `kit_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_versions` ADD CONSTRAINT `kit_versions_editor_id_fkey` FOREIGN KEY (`editor_id`) REFERENCES `authors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kit_versions` ADD CONSTRAINT `kit_versions_kit_id_fkey` FOREIGN KEY (`kit_id`) REFERENCES `kits`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kits` ADD CONSTRAINT `kits_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `kits` ADD CONSTRAINT `kits_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `authors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `machine_pair_codes` ADD CONSTRAINT `machine_pair_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `mcp_link_clients` ADD CONSTRAINT `mcp_link_clients_link_id_fkey` FOREIGN KEY (`link_id`) REFERENCES `mcp_links`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `mcp_links` ADD CONSTRAINT `mcp_links_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `organization_invites` ADD CONSTRAINT `organization_invites_invited_by_fkey` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `organization_invites` ADD CONSTRAINT `organization_invites_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `organization_members` ADD CONSTRAINT `organization_members_invited_by_fkey` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `organization_members` ADD CONSTRAINT `organization_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `organization_members` ADD CONSTRAINT `organization_members_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `organizations` ADD CONSTRAINT `organizations_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `proposal_files` ADD CONSTRAINT `proposal_files_blob_hash_fkey` FOREIGN KEY (`blob_hash`) REFERENCES `blobs`(`hash`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `proposal_files` ADD CONSTRAINT `proposal_files_proposal_id_fkey` FOREIGN KEY (`proposal_id`) REFERENCES `skill_proposals`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `proposal_scans` ADD CONSTRAINT `proposal_scans_proposal_id_fkey` FOREIGN KEY (`proposal_id`) REFERENCES `skill_proposals`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `publish_log` ADD CONSTRAINT `publish_log_skill_id_fkey` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `publish_log` ADD CONSTRAINT `publish_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_aliases` ADD CONSTRAINT `skill_aliases_to_skill_id_fkey` FOREIGN KEY (`to_skill_id`) REFERENCES `skills`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_moderation_actions` ADD CONSTRAINT `skill_moderation_actions_acted_by_fkey` FOREIGN KEY (`acted_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_moderation_actions` ADD CONSTRAINT `skill_moderation_actions_skill_id_fkey` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_proposals` ADD CONSTRAINT `skill_proposals_decided_by_fkey` FOREIGN KEY (`decided_by`) REFERENCES `authors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_proposals` ADD CONSTRAINT `skill_proposals_proposer_author_id_fkey` FOREIGN KEY (`proposer_author_id`) REFERENCES `authors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_proposals` ADD CONSTRAINT `skill_proposals_skill_id_fkey` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_reports` ADD CONSTRAINT `skill_reports_reported_by_fkey` FOREIGN KEY (`reported_by`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_reports` ADD CONSTRAINT `skill_reports_skill_id_fkey` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_runtime_availability` ADD CONSTRAINT `skill_runtime_availability_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_version_files` ADD CONSTRAINT `skill_version_files_skill_id_version_hash_fkey` FOREIGN KEY (`skill_id`, `version_hash`) REFERENCES `skill_versions`(`skill_id`, `hash`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_version_files` ADD CONSTRAINT `skill_version_files_blob_hash_fkey` FOREIGN KEY (`blob_hash`) REFERENCES `blobs`(`hash`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_version_provenance` ADD CONSTRAINT `skill_version_provenance_skill_id_version_hash_fkey` FOREIGN KEY (`skill_id`, `version_hash`) REFERENCES `skill_versions`(`skill_id`, `hash`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_version_provenance` ADD CONSTRAINT `skill_version_provenance_proposal_id_fkey` FOREIGN KEY (`proposal_id`) REFERENCES `skill_proposals`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_version_provenance` ADD CONSTRAINT `skill_version_provenance_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `authors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_version_provenance` ADD CONSTRAINT `skill_version_provenance_proposed_by_fkey` FOREIGN KEY (`proposed_by`) REFERENCES `authors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_version_scans` ADD CONSTRAINT `skill_version_scans_skill_id_skill_version_id_fkey` FOREIGN KEY (`skill_id`, `skill_version_id`) REFERENCES `skill_versions`(`skill_id`, `hash`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_versions` ADD CONSTRAINT `skill_versions_published_by_fkey` FOREIGN KEY (`published_by`) REFERENCES `authors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skill_versions` ADD CONSTRAINT `skill_versions_skill_id_fkey` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skills` ADD CONSTRAINT `skills_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skills` ADD CONSTRAINT `skills_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `skills` ADD CONSTRAINT `skills_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `update_decisions` ADD CONSTRAINT `update_decisions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `user_github_tokens` ADD CONSTRAINT `user_github_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `user_identities` ADD CONSTRAINT `user_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

