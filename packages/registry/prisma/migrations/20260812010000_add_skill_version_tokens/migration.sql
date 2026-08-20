-- Context-weight metering (v1): store an approximate token count per skill
-- version so surfaces can show "what does this cost your context." Computed
-- once at write time (publish + mirror sync) and backfilled for existing rows;
-- these columns are derived data, outside the signed version envelope.
--   token_count   = headline (ambient + body)
--   token_ambient = name + trigger description kept hot for a materialized skill
--   token_bundle  = bundled reference/script text (null until v1.1)
--   token_method  = tokenizer identity, so a later swap is a clean re-tokenize
-- All nullable: legacy rows stay null until the backfill runs.
ALTER TABLE `skill_versions` ADD COLUMN `token_count` INTEGER NULL;
ALTER TABLE `skill_versions` ADD COLUMN `token_ambient` INTEGER NULL;
ALTER TABLE `skill_versions` ADD COLUMN `token_bundle` INTEGER NULL;
ALTER TABLE `skill_versions` ADD COLUMN `token_method` VARCHAR(191) NULL;
