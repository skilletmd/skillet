---
name: commit-message
description: "Writes a clear commit message from your staged changes — a subject that fits in 50 characters and a body that explains why. Use when committing a change whose reason isn't obvious from the diff alone."
user-invocable: true
allowed-tools: Bash(git *)
---

# commit-message

The diff shows what changed. The commit message exists to say *why* — the context that isn't in the code and won't be in anyone's head in six months. This skill writes that.

## When to use

Any commit worth more than `git commit -m "fix"`. Especially before committing a change whose reason isn't obvious from the diff.

## Read what you're committing

```bash
git diff --staged
```

Commit one logical change at a time. If the staged diff does two unrelated things, that's two commits — `git restore --staged <file>` to split them.

## The format

```
<type>: <subject, imperative, under 50 chars>

<body: why this change, what it affects, wrapped at 72 chars>
```

**Subject line:**
- Imperative mood: "add", "fix", "remove" — not "added" or "fixes". It completes the sentence "If applied, this commit will ___."
- Under 50 characters. If it won't fit, the commit is probably too big.
- No trailing period.

**Type** (conventional commits — optional, but be consistent):
`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.

**Body** (skip it only when the subject is genuinely complete on its own):
- Explain *why*, not *what* — the diff already shows what.
- Note side effects, migrations, or anything a future reader would be surprised by.
- Reference the issue: `Closes #123`.

## Example

```
fix: stop double-charging on retried checkout

The payment client retried on a 504 without checking whether the
first request had already succeeded, charging some customers twice.
Make the charge idempotent, keyed on the order ID.

Closes #482
```

The diff alone would show a reviewer a new `idempotency_key` parameter. The message is where the *why* lives.

## What to avoid

- `"fix bug"`, `"update"`, `"wip"`, `"changes"` — these cost a future engineer a `git blame` and a guess.
- Restating the diff: "changed line 42 in auth.js" — they can see that.
- Bundling unrelated changes so the subject has to list three things with "and".
