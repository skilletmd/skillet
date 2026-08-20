-- Per-row stamp of the DETECTOR_CORPUS_VERSION that produced findings_json, so
-- the threat lane is independently version-gatable (capabilities_version already
-- is). NULL means "unknown / stale": existing rows read NULL and are refreshed on
-- the next scan-backfill run. No data backfill.
ALTER TABLE `skill_version_scans` ADD COLUMN `detector_corpus_version` INTEGER NULL;
