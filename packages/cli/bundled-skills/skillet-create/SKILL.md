---
name: skillet-create
description: Turn what you have already been doing with this agent into a real skill, then land it on your Skillet profile. Use when the user invokes /skillet create, or asks to make, draft, or capture a skill from their own work, habits, repo conventions, or past sessions.
user-invocable: true
---

# Skillet create (`/skillet create`)

Most people cannot answer "what skill do you want to write?" They can answer
"yes, that one" when you show them something they already do. So this playbook
never opens with a blank page. It reads the work that already happened, proposes
candidates with evidence, and carries the one they pick all the way to a live
skill page.

Six phases, in order. Do not skip, do not merge, do not run more than one skill
per invocation.

## 0. Say what you are about to read

One line, before you read anything. Not a privacy essay, a scope statement:

```
Reading this session, this project's recent transcripts, and its conventions files to find what you keep doing. Stays on your machine.
```

Then read. Everything in phase 1 is local. Nothing is sent anywhere until the
user approves an upload in phase 4.

**Never widen the scope on your own.** Other projects, other repos, and shell
history are out unless the user names them. If the current project yields
nothing, ask before reaching further.

## 1. Mine the evidence

Work the ladder top-down. Stop when you have enough for three honest candidates.

1. **This session.** Already in your context and free. What did the user correct
   you on? What did they explain that they clearly explain often?
2. **This project's transcripts.** Claude Code keeps them at
   `~/.claude/projects/<slugified-cwd>/*.jsonl`; Codex at `~/.codex/sessions/`.
   Grep for repeated instruction shapes rather than reading whole files:
   "always", "never", "remember to", "don't forget", "like last time", "same as",
   "I told you". Repetition is the signal. A thing said once is a preference; a
   thing said four times is a skill.
3. **Conventions the user already wrote down.** `CLAUDE.md`, `AGENTS.md`,
   `.cursorrules`, `CONTRIBUTING.md`. These are proto-skills that never got
   packaged. A section that keeps getting cited is the strongest candidate in
   the repo.
4. **Their own commits.** `git log --author="$(git config user.email)" --oneline -50`
   plus the shape of their diffs. What ritual do they run before every push?

**What does not count as evidence.** `skillet usage` and `skillet activity` record
routed skill refs only, never task text, so they cannot tell you what a new skill
should say. Do not mine them for content.

## 2. Propose three, with receipts

Never propose a skill you cannot point at evidence for. Show exactly three,
numbered, each one line of what it is plus one line of where you saw it:

```
Three things you keep doing:

1) release-notes  Draft release notes from merged PRs in your changelog format
   Seen: 6 sessions, always the same three-section shape

2) db-migration-check  Pre-flight checks before running a migration on prod
   Seen: CLAUDE.md "Migrations" + you walked me through it twice

3) pr-voice  Your PR description voice: what changed, why, how to test
   Seen: 14 of your last 20 PR bodies follow it exactly

Reply with a number, or describe something else.
```

Rules for this phase:

- **Three, not eight.** A long menu is a research report, not a decision.
- **Name the count.** "Seen 6 times" is why they will trust the pick.
- If the evidence is thin, say so in one line and offer to interview them
  instead. A thin proposal you dress up as strong is worse than an honest ask.
- If they describe something else, take it. Their answer beats your mining.

## 3. Draft it

One skill. One thing it does. Write to a working directory named for the slug.

The craft rules live in `@skillet/write-a-skill` and this playbook does not
repeat them. If it is in the user's kit, read it. If not, summon it:
`GET https://registry.skillet.md/api/v1/skills/skillet/write-a-skill`. If you
cannot reach it, the three that matter most are:

- **The description is the product.** It decides whether the skill ever loads.
  Shape: what it does, then "Use when [specific trigger]."
- **Procedure or ability, not both.** Ordered steps, or principles plus sharp
  examples. Mixing them is why skills feel mushy.
- **Instructions, not documentation.** What you want done, not everything you know.

Write two files:

`<slug>/SKILL.md` — frontmatter (`name`, `description`, `user-invocable: true`
when it deserves a slash command) plus a tight body. A screen or two.

`<slug>/evals/smoke.json` — the trigger test. Two or three cases, each a prompt
that should fire the skill and the terms its body must contain:

```json
{
  "version": 1,
  "cases": [
    {
      "id": "basic",
      "prompt": "draft release notes for this week",
      "expect_in_skill": ["merged pr", "three-section", "changelog"]
    }
  ]
}
```

The check is a case-insensitive substring match against SKILL.md, so pick terms
that are load-bearing instructions, not decoration. Max 8 cases, 16 terms each.

**Keep every term short enough to survive a line wrap.** The match is literal
against the raw file, so a phrase your body happens to break across two lines
("what it was two\n  pivots ago") will not be found even though a reader sees it
plainly. Prefer three or four words that sit together on one line.

**Before you move on, show the user the draft and get a yes.** They are about to
put their name on it.

**Never write a secret into a skill.** API keys, tokens, internal hostnames,
customer names. Reference where the secret lives instead. The registry scans on
publish, but a scan that catches it means it was already written to disk.

## 4. Land it (private)

**Check pairing before you import.** `skillet import` gates on it for every
branch: an unpaired machine writes nothing to the kit and exits 3. So look
first, rather than letting the user watch a command fail.

```bash
skillet whoami
```

If that shows nobody, stop and ask for the one thing only they can do. Do not
tell them to run `skillet connect` alone: with no code it just errors, which is
a dead end in a chat.

```
Ready to save it. Sign in at skillet.md/settings and paste the pair code here, I'll do the rest.
```

When they paste one, run `skillet connect <code>` yourself, then continue.

Once paired, one command does both halves. It imports into the local kit and
backs the skill up to the account as **private**:

```bash
skillet import ./<slug> -y
```

Private is the default and not a step the user has to ask for. Say what happened
in one line and give them the URL:

```
Imported and saved to your profile, private: skillet.md/@<handle>/<slug>
```

## 5. Verify the trigger

```bash
skillet eval <slug>
```

`PASS` means the body covers every case. `FAIL` lists the missing terms: fix the
SKILL.md so the instruction is actually there, then re-run. Do not fix a failure
by deleting the case. The eval exists to catch a skill that reads well and
instructs nothing.

`SKIP` means no fixture was found, which means phase 3 was done incompletely.

## 6. Offer public, once

Ask once, plainly, and take no for an answer:

```
Want this public on your profile? Anyone could then find and run it.
  1) Keep it private   2) Make it public
```

On `2`:

```bash
skillet upload --skill <slug> --public
```

Use `upload`, not `publish`. `publish` only exists behind `SKILLET_LEGACY_CLI`,
so on a normal install it is an unknown command. Re-uploading an already-saved
skill with `--public` is the supported visibility flip.

On `1`, stop. Do not re-ask later in the session, do not add a footer about how
much better it would be if they shared. It is already on their profile, which is
what they asked for.

**Public is only ever an explicit yes.** Never pass `--public` because the skill
looks generally useful, never pass `--yes` to skip the confirmation on the
user's behalf.

## Command reality check

Every command this playbook runs exists on a default install: `whoami`,
`connect`, `create`, `import`, `eval`, `upload`. If you reach for anything else,
confirm it is not management-tier before telling the user to run it.

## Rules

- **Evidence before proposal.** Every candidate cites something you actually
  read. Never invent a habit to have something to offer.
- **Local by default.** Phase 1 reads only this project. Phase 4 uploads private.
  Phase 6 is the single place anything becomes public, and only on a yes.
- **One skill per run.** If they want three, run this three times. A batch draft
  is three mediocre skills.
- **The draft is theirs.** Show it, get a yes, then land it.
- **No secrets in skill content, ever.**

## Examples

| User says | What this does |
|-----------|----------------|
| `/skillet create` | Mine, propose three, draft the pick, land it private |
| `/skillet create from my CLAUDE.md` | Skip mining, propose from the conventions file |
| `/skillet create a skill for our deploy ritual` | Skip phases 1-2, draft that directly |
