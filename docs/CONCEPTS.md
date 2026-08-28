# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Skill trust & moderation

Two independent status axes govern whether a skill is trusted and available. They collide on the word "quarantined" but come from different systems — keep them distinct.

### Moderation status
The whole-skill enforcement state set by a human admin: `none`, `unlisted`, or `quarantined`. Applies to every version of the skill.

`unlisted` hides a skill from discovery (search, browse, profiles) but leaves it directly fetchable by anyone with the reference. `quarantined` blocks downloads outright and freezes the skill against new versions. Both are reversible and appear on the public moderation log. An admin reaches these through the Reports queue (acting on a user report) or, for unlist, directly.

### Scan status
The automatic per-version verdict from the security scanner: `pending`, `clean`, `flagged`, or `quarantined`. Applies to a single published version, not the whole skill.

`flagged` is only ever a scanner verdict — there is no manual "flag" action. A scan-`quarantined` version is one the scanner judged confirmed-dangerous and is blocked from download, distinct from an admin **Moderation status** quarantine even though they share the word.

### Report
A user-submitted flag on a skill (e.g. malware, ownership claim). Reports are grouped per skill in the admin queue, where an admin resolves them by dismissing or by enforcing a **Moderation status** (unlist or quarantine).

## Mirror library

### Mirror
A skill published under a reserved brand handle from a public GitHub repo the author didn't upload themselves. Mirror authors carry `is_mirror = 1`; content is platform-attested, scanned, and re-synced from the source repo.

### Seed
An entry in the curated mirror source list (`packages/registry/scripts/mirror-sources.json`): handle, repo, license, and a per-source `maxSkills` curation cap. Seeds are re-synced nightly; discovered (queue-approved) mirrors sync alongside them but live in `mirror_review_queue`, not the seed file.

### Claimed mirror handle
A mirror handle whose real owner verified ownership; `authors.mirror_claimed_at` is stamped while `is_mirror` stays 1. Claiming does not freeze content sync, but the claimed author owns their profile (never overwritten from the seed file) and the curated `maxSkills` cap no longer applies. There is no unclaim path.

### Tombstone
Removal of a mirrored skill whose source directory vanished upstream, performed during sync. Skills with reports or moderation actions are skipped instead of deleted so the moderation trail survives.

### Suspension
The author-level enforcement state, distinct from the per-skill **Moderation status**. Suspending a user hides the whole person — their profile, their skills and kits, and their presence in every discovery surface (search, facepiles, followers, feeds, leaderboards). It is a reversible admin action shown in the "Suspended users" list. Enforcement is a **live guard** keyed on the user's suspended flag applied at read time, not only a one-time bulk hide of existing content, so a suspended user stays hidden even for content created or relisted after suspension. The suspended user can still see their own account; everyone else gets a 404 on their profile.
