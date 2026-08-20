---
name: pr-handoff
description: "Generates a complete pull request description pre-filled with what changed, why, how to test locally, and an acceptance criteria checklist. Use before opening or updating any PR to eliminate the most common review round-trip causes."
user-invocable: true
allowed-tools: Bash(git *)
---

# pr-handoff

Write your PR description once, correctly, on the first submission — so reviewers don't have to ask basic questions. The most common review round-trips are: missing test steps, unclear scope, and no security flag. This skill closes all three.

## When to use

Before running `git pr create` or `gh pr create` on any pull request. Takes 2–3 minutes to fill in; typically saves one full review round-trip.

## Step 1 — Gather the facts

Run these commands first:

```bash
# What changed
git diff main...HEAD --stat

# Commits on this branch
git log main...HEAD --oneline

# Does this PR touch security-sensitive surfaces?
git diff main...HEAD --name-only | grep -iE "auth|sign|cred|token|secret|key|password|crypto"
```

## Step 2 — Fill the template

Copy this template and replace every `<...>` placeholder:

```markdown
## What changed

- <first bullet: what was added, changed, or removed — be specific about files/modules>
- <second bullet if needed>

## Why

<The problem this solves or the requirement it fulfills. Link to the issue or spec section if applicable.>

## How to test locally

```bash
# 1. Install deps
<your install command, e.g. pnpm install>

# 2. Build
<your build command>

# 3. Run the relevant tests
<your test command, e.g. pnpm test path/to/test>

# 4. Manual verification
<step-by-step commands to see the change working>
```

Expected output:
```
<paste expected output here>
```

## Acceptance criteria

- [ ] All existing tests pass
- [ ] New tests added for changed behavior
- [ ] No type errors (`<your typecheck command>`)
- [ ] Manual test steps above produce expected output
- [ ] <add any criteria specific to this change>

## Security review required?

<!-- Delete the line that doesn't apply -->
**Yes — security review required before merge.** This PR touches: `<list the sensitive surfaces>`.
**No** — This PR does not touch auth, signing, credentials, file writes, or trust policy.

## Related

Closes #<issue number>

- Depends on: (none / #<PR number>)
- Follow-up: (none / #<issue number>)
```

## Step 3 — Quick check before submitting

```bash
# Confirm no secrets in diff
git diff main...HEAD | grep -iE "secret|token|password|private.?key|api.?key" && echo "WARNING: possible secret" || echo "Clean"

# Confirm tests pass
<your test command>

# Confirm build is clean
<your build command> 2>&1 | tail -5
```

If any check fails, fix before opening — don't rely on CI or reviewers to catch it.

## Step 4 — Open the PR

```bash
gh pr create \
  --title "<concise description under 70 chars>" \
  --body "$(cat <<'EOF'
<paste filled template here>
EOF
)" \
  --base main
```

## What makes a good PR description

**What changed:** Name specific files or modules, not vague concepts ("updated the auth module" → "added token expiry to `src/auth/session.ts`").

**Why:** One or two sentences on the problem, not the solution — the diff already shows the solution.

**How to test:** Step-by-step commands a reviewer who has never seen this code can run to verify it works. If there's no manual test, say so explicitly.

**Acceptance criteria:** Checkbox items the reviewer uses to approve. Each item should be verifiable, not aspirational.

**Security flag:** Any change touching auth, file writes, credentials, signing, or trust policy needs an explicit security review flag. When in doubt, flag it — a false positive costs 5 minutes; a missed security issue costs much more.
