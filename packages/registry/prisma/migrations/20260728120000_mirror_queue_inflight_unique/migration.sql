-- Restore the in-flight uniqueness invariant on mirror_review_queue that the
-- sqlite partial unique index (migration 038) carried before the MySQL cutover.
-- MySQL has no partial indexes, so a stored generated column holds the
-- normalized key only while the row occupies an in-flight status; decided rows
-- generate NULL, and MySQL unique indexes treat NULLs as distinct.
--
-- The status list must stay in lockstep with IN_FLIGHT in
-- src/routes/mirror-queue.ts: ('submitted','pending_review','approved','live').

-- Dedup first: the invariant has been DB-unenforced since the cutover, so any
-- duplicate in-flight rows would make the unique index fail to build. Keep the
-- newest row per key (created_at, then id) and mark older ones rejected_screen.
UPDATE `mirror_review_queue` SET
  `status` = 'rejected_screen',
  `screen_notes` = CONCAT(COALESCE(`screen_notes`, ''), ' [migration: duplicate in-flight row superseded by a newer entry]')
WHERE `id` IN (
  SELECT `id` FROM (
    SELECT `id`,
           ROW_NUMBER() OVER (
             PARTITION BY `normalized_repo_key`
             ORDER BY `created_at` DESC, `id` DESC
           ) AS `rn`
    FROM `mirror_review_queue`
    WHERE `status` IN ('submitted', 'pending_review', 'approved', 'live')
  ) `ranked`
  WHERE `rn` > 1
);

ALTER TABLE `mirror_review_queue`
  ADD COLUMN `inflight_repo_key` VARCHAR(191)
  GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('submitted', 'pending_review', 'approved', 'live')
         THEN `normalized_repo_key`
         ELSE NULL
    END
  ) STORED;

CREATE UNIQUE INDEX `uq_mirror_review_queue_inflight`
  ON `mirror_review_queue` (`inflight_repo_key`);
