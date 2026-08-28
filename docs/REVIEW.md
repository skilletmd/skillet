# REVIEW.md

What code review holds the line on in this repo, and the known non-issues
reviewers keep rediscovering. Written for humans and agents doing review;
general conventions are in [CONTRIBUTING.md](CONTRIBUTING.md), operational
gotchas in [CLAUDE.md](CLAUDE.md).

## Always check

- **Consent coverage.** Any PR that adds or changes a sync-manifest source must
  extend the pending-updates queue and the `/approvals` scope guard in the same
  PR (see "Update consent" in CLAUDE.md). A source that syncs but can't be
  approved on web wedges devices permanently.
- **Desktop↔CLI contract.** Any PR that hides, renames, or re-tiers a CLI
  command must show the desktop contract test still passing. The tray fails
  silently on unknown commands.
- **Tests and the real home directory.** Any test touching `skilletDir()`,
  `device.json`, or `session.json` must isolate `SKILLET_DIR` (not just
  `HOME`). A test that writes the developer's real `~/.skillet` is a blocking
  defect regardless of what it asserts.
- **Signed data.** `platform-signing.ts` embeds version ordinals in Ed25519
  attestations, and skill handles are bound into v2 signature envelopes
  (`@author/slug`). Changes to version ordering, handles, or identity shape are
  protocol/signature changes — review them as such, not as refactors.
- **Migrations.** Registry schema changes need a Prisma migration; never edit
  applied migrations.
- **Copy.** User-facing strings: no em-dashes, short declarative sentences,
  no "private until you connect" phrasing. CLI copy: color annotates, never
  decorates; no preamble.

## Test expectations

Auth, sync contracts, registry endpoints, and scanner behavior always get
tests. Copy, styling, and layout changes don't. Behavior over implementation
details. Two test locations only: colocated `foo.test.ts` or
`<package>/tests/` — no `__tests__/`.

## Known non-issues — do not re-flag

These have each been investigated and deliberately resolved. Re-raising them
without new evidence wastes a review cycle.

- **`skill_version_scans.skill_version_id`** looks like a hash misnamed as an
  id. It's a convention-correct FK — the sibling of `skill_id` in the composite
  primary key. `skill_versions`' PK is `hash`, which is why it reads odd.
  Renaming churns ~55 sites for zero behavior.
- **`authors.id` is a handle string, `users.id` is a UUID.** Not a bug to
  re-root: `authors` is a superset of users (org slugs, unclaimed mirror
  brands), and handles are bound into signatures and URLs. The invariant is
  enforced with branded types (`Handle` / `UserId`) in
  `packages/registry/src/auth/identity.ts`. Don't propose a DB rename.
- **Unlisted skills still visible inside kits** — deliberate v1 moderation
  scope, not a leak. Quarantine blocks download regardless of kit membership.
- **Version ordinals are derived, not stored.** The `(published_at, rowid)`
  total order in `versionOrdinal()` is the fix that shipped; a stored column
  touches signed data and was rejected on investigation.
- **"N installs" ≠ raw installs.** It counts public adopters by design;
  installer identity is private.

## Review posture

Verify claimed bugs against the pre-change source and reproduce before
asserting them. Pattern-matching a diff to a known bug class without checking
the actual code produces false findings more often than real ones.
