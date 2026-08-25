-- Decision context for the mirror review queue.
--
-- A pending row showed a score, a handle, a repo, and a skill count. That is
-- enough to reject obvious junk and nothing more: an admin still had to open
-- GitHub to answer what the skills actually are, whether we need them, and
-- whether we already have them. The work to answer the first was already being
-- done and thrown away -- the quality rubric reads every sampled skill's name
-- and description to score it, then keeps the score and discards the text.
--
-- These land in COLUMNS, not in `screen_notes`. That column is a single text
-- blob the admin page already recovers three numbers from with regexes; adding
-- names, categories, and overlap to it would put the data one prose-format
-- change away from vanishing. `screen_notes` stays exactly what it is, the
-- human-readable rubric breakdown.
--
-- Everything is nullable because 64 rows already exist without it and must keep
-- rendering and stay decidable.
ALTER TABLE `mirror_review_queue`
  ADD COLUMN `skills_captured_at` INT NULL,
  ADD COLUMN `category_summary` JSON NULL;

-- One row per skill in the candidate repo. The queue's skill COUNT came from
-- the rubric; the names did not survive it. Cascade on delete so retiring a
-- candidate takes its captured skills with it rather than orphaning them.
--
-- `overlap_ref` / `overlap_score` are the single best catalog match for this
-- skill. One good match answers "do we already have this"; a ranked list does
-- not earn its width. The row-level overlap COUNT is derived at render from
-- these scores rather than stored, because the threshold is calibrated against
-- a moving catalog and a stored count would silently misrepresent every
-- existing row the moment it moves.
CREATE TABLE `mirror_candidate_skills` (
  `queue_id` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `name` TEXT NULL,
  `description` TEXT NULL,
  `category` VARCHAR(64) NULL,
  `overlap_ref` VARCHAR(255) NULL,
  `overlap_score` DOUBLE NULL,
  PRIMARY KEY (`queue_id`, `slug`),
  INDEX `idx_mirror_candidate_skills_queue` (`queue_id`),
  CONSTRAINT `mirror_candidate_skills_queue_id_fkey`
    FOREIGN KEY (`queue_id`) REFERENCES `mirror_review_queue` (`id`)
    ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
