---
name: skillet-onboarding
description: "Step-by-step onboarding for new Skillet users. Trigger on first run, when someone asks how to get started with Skillet, or when setting up Skillet in a new environment. Walks through install, first sync, first publish, and adding a skill from another author."
user-invocable: true
---

# skillet-onboarding

Welcome to Skillet. This skill walks you through the four moments that make Skillet click: install, sync, publish, and add from someone else. It takes about 10 minutes.

## Step 1 — Install and first sync (< 2 min)

```bash
npx skilletmd
```

That's it. Skillet installs, scans for skill directories it already knows about (`~/.agents/skills`, `~/.claude/skills`, `.cursor/rules`, etc.), and shows you what it found. Sign in at skillet.md first — passwordless, an email link — then the wizard links this machine with a pair code from skillet.md → Settings → Devices and runs your first sync. Pairing never uploads your local skills; uploading is a separate, deliberate step.

If you have no skills yet, that's fine — skip to Step 3.

## Step 2 — Sync to a second machine

On any other machine:

```bash
# Preferred: pair code from skillet.md → Settings → Devices
skillet connect ABCD-1234
skillet sync
```

Or sign in with email first:

```bash
skillet auth login --email you@example.com
skillet sync
```

If you've already published, sync pulls your kits and writes skills to the correct locations for each runtime.

## Step 3 — Publish your first skill (< 5 min)

### Create a skill

A skill is a SKILL.md file. The minimum viable skill has a name, a description, and a body:

```markdown
---
name: my-first-skill
description: "What this skill does and when to trigger it."
---

# my-first-skill

Instructions for the AI go here. Be specific about when to use this
and what behavior you want.
```

Save it anywhere, then import:

```bash
skillet import ./path/to/my-first-skill
skillet sync
```

Point `import` at the skill's **directory** (the one with `SKILL.md` inside it), not at the file.

### Publish

Your handle is claimed when you sign in, so connect this machine first:

```bash
skillet connect <code>                    # pair code from skillet.md/settings
skillet upload --skill my-first-skill     # private
```

Add `--public` when you want it findable by anyone.

Skillet runs a privacy scan before anything leaves your machine. When this machine holds an Ed25519 author key the version is signed with it; otherwise it publishes through your signed-in session.

Your skill gets a page at `https://skillet.md/skills/you/my-first-skill` with an install command and Add to Claude / Add to ChatGPT buttons.

### Push a v2 update

Edit the SKILL.md, then:

```bash
skillet upload --skill my-first-skill
```

Anyone who added your skill sees it as a diff on their next `skillet sync` or in `skillet pending` — not a silent overwrite. They approve explicitly:

```bash
skillet pending
skillet approve my-first-skill --version 2
```

## Step 4 — Add a skill from another author

```bash
skillet add @skillet/write-a-skill
```

The skill materializes in every runtime you have configured. No copy-paste, no per-tool setup.

## What's in `skillet.lock`

After adding skills, Skillet writes a lockfile:

```json
{
  "skills": {
    "@you/my-first-skill": { "version": "2.0.0", "digest": "sha256:..." },
    "@skillet/write-a-skill": { "version": "1.0.0", "digest": "sha256:..." }
  },
  "registry": "https://registry.skillet.md"
}
```

Commit this. Anyone cloning your repo can run `skillet sync` and get exactly the same skills.

## Next steps

- **Write a better skill:** `skillet add @skillet/write-a-skill`
- **Understand the sync model:** `skillet add @skillet/skillet-sync`
- **Share a kit with your team:** create it on skillet.md, then add your skills to it there
- **Harm-scan your kit:** `skillet scan`
