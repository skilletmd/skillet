---
name: review-a-diff
description: "Reviews a code diff for correctness bugs, security issues, and missing tests before you approve or merge. Use when reviewing a pull request, checking your own branch before pushing, or asked to look over a diff."
user-invocable: true
allowed-tools: Bash(git *)
---

# review-a-diff

Most review feedback is noise a linter should have caught. This skill spends your attention where it pays: correctness, security, and the tests that prove the change works. Read the diff three times, once per lens, instead of once for everything.

## When to use

Reviewing a PR, or checking your own branch before `git push`. Works on any language.

## Get the diff

```bash
git diff main...HEAD          # your changes since you branched from main
git diff main...HEAD --stat   # files touched, at a glance
```

Read the `--stat` first. A change that touches 40 files for a "small fix" is the first finding.

## Lens 1 — Correctness

Read the diff as if it will run with the worst possible input.

- Off-by-one, wrong comparison operator, inverted boolean.
- Null / undefined / empty: what happens when the list is empty, the map misses, the call returns nothing?
- Error paths: is the error swallowed, logged, or propagated? Does a failed write leave half-written state?
- Concurrency: shared state touched without a lock, an `await` that races a later read.
- The change does what the PR says — and nothing the PR doesn't say.

## Lens 2 — Security

```bash
# Which files touch sensitive surfaces (matches filenames)?
git diff main...HEAD --name-only | grep -iE "auth|sign|cred|token|secret|crypto|sql"

# Are there secrets in the added lines themselves (matches diff content)?
git diff main...HEAD | grep -nE "^\+" | grep -iE "api.?key|secret|token|password|BEGIN [A-Z ]*PRIVATE KEY"
```

If either matches, slow down. Check for:

- User input reaching a query, shell, file path, or `eval` without validation.
- Secrets committed in the added lines — keys, tokens, passwords, `.env` values.
- Authorization checks that are missing, not just authentication (is the user allowed to touch *this* record?).
- Logging that prints tokens, passwords, or full request bodies.

## Lens 3 — Tests

A change without a test is a claim without proof.

- Is there a test that fails before this change and passes after?
- Does it cover the edge case the change is about, or just the happy path?
- If there's no test, the PR should say why ("config-only", "covered by the integration suite") — not stay silent.

## Write the review

Lead with the one thing that blocks merge. Group the rest as "should fix" and "optional." Quote the line, say what's wrong, and — when you can — paste the fix. A review that only says "this is wrong" costs the author a round-trip to find out how.

Approve when correctness holds, no security surface is exposed, and the change is tested. Style is the linter's job.
