---
name: write-a-skill
description: "Helps you write a good SKILL.md — covers frontmatter fields, trigger description, scope, and common mistakes. Use when creating a new skill or improving an existing one. Also the source material for the Skillet publish quickstart."
user-invocable: true
---

# write-a-skill

A good SKILL.md does one thing well, triggers on the right moment, and stays scoped to what it actually knows. Most skill problems come from: vague trigger descriptions, scope creep, and missing the why.

## The minimum viable skill

```markdown
---
name: my-skill
description: "One sentence. What does this skill do and WHEN should the AI invoke it? Be specific."
---

# my-skill

Instructions for the AI go here.
```

That's it. Name, description, body. The description is the most important field — it's how the runtime decides whether to load this skill at all.

## Frontmatter reference

```yaml
---
name: my-skill                    # Required. Slug-format (lowercase, hyphens).

description: "..."                # Required. One sentence, specific trigger condition.
                                  # Bad:  "Helps with code."
                                  # Good: "Use when reviewing TypeScript PRs for type safety issues."

user-invocable: true              # Optional. Adds a /my-skill slash command.

allowed-tools: Bash(git *)        # Optional. Restricts which tools the skill can use.
                                  # Omit if the skill only generates text.
---
```

## Writing the description field

The description does two jobs: it tells the runtime **when to load the skill**, and it tells the user **what the skill does**.

Bad descriptions (too vague — the runtime loads this for everything):
- `"Helps with tasks."`
- `"Useful for developers."`
- `"Context about my project."`

Good descriptions (specific trigger condition + what it provides):
- `"Use when writing or reviewing commit messages to enforce conventional commit format."`
- `"Contains my company's refund policy. Trigger when a user asks about returns, refunds, or billing disputes."`
- `"Teaches the Skillet sync model. Trigger when someone asks how Skillet works, how to sync skills, or how to add a skill."`

The pattern: **"Use when [specific situation]. [What the skill provides or does.]"**

## Scoping the body

**Do one thing.** A skill that covers your entire development workflow will be loaded constantly and help rarely. Split into smaller, focused skills instead.

**Wrong scope:**
```markdown
# my-project
Everything about my project: the tech stack, our coding standards,
how we deploy, the refund policy, PR process, on-call runbook...
```

**Right scope:**
```markdown
# pr-process
Our PR review process: what to check, how to write the description,
who approves what. Use when opening or reviewing a PR.
```

**Tell the AI what you want, not what you know.** The body is instructions, not documentation. Write as if you're briefing a capable colleague who has no project context.

```markdown
# refund-policy-handler

When a user asks about refunds or returns:
1. Check if purchase is within 30 days (full refund, no questions asked)
2. Between 30–90 days: store credit only, requires proof of purchase
3. After 90 days: escalate to support@company.com

Never promise a refund outside these terms. If uncertain, escalate.
```

## Procedures vs abilities

Two kinds of skill, structured differently. Know which you're writing.

- **Procedure:** a step-by-step process the agent runs to completion. Deploy checklist, "grill me on this plan," red-green-refactor. Write as ordered steps with checkpoints.
- **Ability:** a capability or discipline the agent adopts and applies throughout while loaded. A writing voice, a code-review standard, "always work test-first." Write as principles plus a few sharp examples.

A procedure says *what to do, in order*. An ability changes *how it does everything*. Mixing the two in one skill is the most common reason a skill feels mushy.

## Leitwörter: leading words

The highest-leverage trick in skill writing. A *leitwort* is a loaded, repeated phrase, ideally borrowed from a respected discipline, that the agent picks up and repeats in its own reasoning, which steers its behavior.

Name the behavior you want with a precise term, use it two or three times in the body, and the agent echoes it back and self-reinforces. Examples that work:
- Teaching: "zone of proximal development" (challenged but not overwhelmed).
- Engineering: "tracer bullets," "deep modules," "test seams," "clean code."
- Reviewing: "load-bearing comment," "narrow the blast radius."

Two things happen: the agent gets a compact token it repeats to hold the behavior, and the term taps the model's pretrained associations with that domain's good practice. Invent your own. Vague verbs ("be thorough") don't stick; a named concept does.

## Keep the body short; disclose progressively

The body is loaded into context every time the skill fires. Long skills cost tokens on every invocation and trigger worse. Keep `SKILL.md` tight, a screen or two. When it grows:

- **Split detail into references, one level deep.** `SKILL.md` is the entry point; push long tables, edge cases, and rarely-needed depth into `REFERENCE.md` / `EXAMPLES.md` and link to them. The agent loads them only when it needs them.
- **Push deterministic work into a script.** If a step is mechanical (validate, format, transform), ship a small script in `scripts/` and tell the agent to run it. More reliable and cheaper than regenerating code each time.

Rule of thumb: if the body runs past ~150 lines or covers two distinct domains, split it.

## Align before you build

The best procedure skills front-load questions. No one knows exactly what they want, so a skill that makes the agent interview you (or the docs) until the ambiguity is gone beats one that guesses and produces confident garbage. For anything that builds or changes something, open with a short alignment step before execution.

## Watch for context over-generalization

A skill that lets the agent write freely to a notes or memory file has a failure mode: a one-off remark ("validating this programmatically is handy") gets treated as a standing rule and applied to everything, burning tokens and drifting behavior. Be explicit about what the agent should persist and reuse, and what is a one-time observation.

## When-to-trigger description

The `description` field is loaded into the AI's context before it reads your skill body. It's the filter that decides whether your skill runs at all.

Think of it as the PR description for your skill — would someone reading only this line know exactly when to use it?

Checklist:
- [ ] Contains a specific trigger condition ("when X happens", "use when Y")
- [ ] Names the domain (code review, billing, onboarding, etc.)
- [ ] Under 2 sentences — if you need more, the skill scope is too broad

## Common mistakes

**Over-scoped:** One SKILL.md covering 10 different topics. Split it.

**Vague description:** `"Helpful context."` — the runtime loads this everywhere and it helps nowhere. Make the trigger specific.

**Imperative without context:** Instructions that assume knowledge the AI doesn't have. If your skill says "use our naming convention," tell it what the convention is.

**Secrets in skill content:** Skillet's privacy scan catches these before publish, but write skills that don't contain secrets in the first place. Reference where secrets live, don't embed them.

**Skill as documentation:** If you're just pasting your README into a SKILL.md, it won't trigger well and will be too broad to be useful. Ask: "What specific situation does this help with?" and write for that.

## Examples by type

### Context skill (private state, not shared by default)

```markdown
---
name: writing-voice
description: "My writing style guide. Use when drafting emails, blog posts, docs, or any long-form text."
---

Write in a direct, confident tone. Short sentences. Active voice.
No filler phrases ("It's worth noting that...", "In conclusion...").
Use concrete examples. If you can cut a word, cut it.
```

### Procedure skill (workflow instructions)

```markdown
---
name: deploy-checklist
description: "Pre-deploy checklist for the payments service. Use before any production deploy to payments."
user-invocable: true
allowed-tools: Bash(git *), Bash(kubectl *)
---

Before deploying to prod:
1. Run `kubectl get pods -n payments` — confirm all pods healthy
2. Check the last 100 lines of logs for ERRORs
3. Verify the PR has SecurityEngineer approval if it touches auth
4. Announce in #deployments: "Deploying payments [version] to prod"
```

### Reference skill (domain knowledge)

```markdown
---
name: incident-runbook
description: "On-call runbook for the API. Use when an alert fires or when investigating a production incident."
---

## Severity levels
- P0: service down, >50% error rate → page on-call immediately
- P1: degraded, <50% error rate → alert in #incidents, fix within 1h
- P2: non-customer-facing → ticket, fix in next sprint

## First steps for any P0/P1
1. Check status page: status.company.com (internal)
2. Check Datadog dashboard: [link]
3. Roll back to last stable if cause unknown: `kubectl rollout undo deploy/api`
```

## The quality bar (what a good skill passes)

Before you publish, check:
- [ ] Description leads with what it does, then "Use when [specific trigger]."
- [ ] The skill does one thing: one procedure or one ability, not five.
- [ ] Body is tight; long or rarely-needed detail is in a reference, one level deep.
- [ ] Deterministic steps are scripts, not prose the agent regenerates.
- [ ] A leitwort names the behavior you want, used a few times.
- [ ] Instructions, not documentation: what you want, not everything you know.
- [ ] Consistent terminology throughout.
- [ ] No secrets, no time-sensitive facts.
- [ ] At least one concrete example.

Skillet checks the mechanical items automatically when you publish (the skill linter / Skill Score); the judgment items are on you.

## Publishing your skill

Once your SKILL.md reads well:

```bash
skillet publish @you/skill-name
```

Skillet runs the privacy scan, signs it with your key, and publishes it. Your skill page goes live immediately with "Add to Claude" and "Add to ChatGPT" install buttons.

For a v2 update, edit the file and publish again. Recipients see it as a graded diff and approve before it materializes.
