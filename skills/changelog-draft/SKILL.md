---
name: changelog-draft
description: "Turns merged commits or PRs into a changelog written for the people who use the software, not the people who wrote it. Use when cutting a release, writing release notes, or updating a CHANGELOG."
user-invocable: true
allowed-tools: Bash(git *)
---

# changelog-draft

A changelog is for the reader deciding whether to upgrade, not a reprint of your git log. "Refactor auth middleware" means nothing to them; "you stay logged in across browser restarts now" does. This skill turns one into the other.

## When to use

Cutting a release or writing release notes. Works from git history or a list of merged PRs.

## Gather the raw material

```bash
# Find the last release tag (empty if the repo has none yet)
LAST=$(git describe --tags --abbrev=0 2>/dev/null)

# Commits since that tag — or the whole history if there's no tag yet
git log ${LAST:+$LAST..}HEAD --oneline

# Or merges since a date, if that's your workflow
git log --merges --since="2 weeks ago" --oneline
```

## Group by what the reader cares about

Drop the internal categories (refactor, chore, test). Use these:

- **Added** — new things the user can now do.
- **Changed** — behavior that's different; flag anything that changes a default.
- **Fixed** — bugs that are gone. Describe the symptom they saw, not the code you touched.
- **Deprecated / Removed** — what will stop working, and what to use instead.
- **Security** — vulnerabilities fixed. Always its own section; never buried.

Internal-only commits — refactors, test changes, dependency bumps with no user impact — don't go in the changelog. If nothing user-facing changed, write "Internal improvements" and stop.

## Rewrite each line for the user

| Commit | Changelog entry |
|---|---|
| `fix: null check in session loader` | Fixed a crash when opening the app with an expired session. |
| `feat: add --json flag to export` | `export` now accepts `--json` for machine-readable output. |
| `refactor: extract validation helper` | (omit — no user-facing change) |

Lead each entry with what the user can do, or no longer has to worry about. Past tense, plain language, no ticket numbers mid-sentence (link them at the end if you must).

## Call out breaking changes loudly

Anything that breaks existing usage goes at the top, under **Breaking changes**, with the exact migration step:

```
### Breaking changes
- `config.timeout` is now milliseconds, not seconds. Multiply your existing value by 1000.
```

A breaking change the reader discovers at runtime instead of in the changelog is the worst kind of release note.

## Format

Follow [Keep a Changelog](https://keepachangelog.com): newest version on top, date in ISO format (`2026-06-14`), grouped sections, one line per change. If you can't say a change in one line, it's probably two changes.
