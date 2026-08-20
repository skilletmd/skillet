-- Widen the scan findings columns from Prisma's default varchar(191) to
-- LONGTEXT, matching capabilities_json / scan_result_cache.findings_json. The
-- 191-char cap truncated large scan reports. No DB-level default: MySQL forbids
-- a literal DEFAULT on TEXT/BLOB, and every insert already supplies the column.

-- AlterTable
ALTER TABLE `proposal_scans` MODIFY `findings_json` LONGTEXT NOT NULL;

-- AlterTable
ALTER TABLE `skill_version_scans` MODIFY `findings_json` LONGTEXT NOT NULL;
