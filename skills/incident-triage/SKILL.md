---
name: incident-triage
description: "Structures the first 15 minutes of a production incident — stabilize, communicate, diagnose, in that order. Use when an alert fires, an outage is reported, or you're the first responder to a production problem."
user-invocable: true
---

# incident-triage

In an incident, the instinct is to find the root cause. That's the third job, not the first. Stop the bleeding, tell people, then diagnose. This skill keeps that order under pressure.

## When to use

You're first to a production problem: an alert fired, a customer reported an outage, or something is visibly broken in prod.

## Minute 0–2 — Declare and own it

- Say it in the incident channel: "I'm on the API 500s, I have it." One owner, named, now.
- Set a severity so everyone calibrates:
  - **SEV1** — customer-facing outage or data at risk. Page others now.
  - **SEV2** — degraded, some users affected. Fix this hour.
  - **SEV3** — internal or cosmetic. File a ticket.

## Minute 2–8 — Stabilize before you understand

You do not need the root cause to stop the bleeding.

- **Did it just start?** Look at what changed: the last deploy, a feature flag, a config push, a traffic spike. Recent change is the cause far more often than not.
- **Can you roll back?** A rollback you can do in 30 seconds beats a fix you understand in 30 minutes. Roll back first, diagnose after — but check for a forward-only database migration first; rolling code back over one can make things worse.
- **Can you shed load or turn the feature off?** Flag off the broken path, rate-limit the hot endpoint, fail over to a replica.

## Throughout — Communicate while you work

Post a one-line update every 10 minutes, even when there's no news:

```
[SEV1] API 500s on checkout. Rolled back deploy abc123 at 14:32.
Error rate dropping. Next update 14:45.
```

People fill silence with worst-case guesses. A boring update is worth ten Slack DMs you won't have time to answer.

## Diagnose

Once it's stable, find the cause with evidence, not hunches:

1. **When did it start?** Pin the timestamp from the metric, then find what shipped at that minute.
2. **What's the blast radius?** One endpoint or all of them? One region, one customer, one tenant?
3. **Read the error, not the symptom.** The 500 is the symptom; the stack trace or the saturated connection pool is the cause.

## After it's over

- Restore anything you turned off to stabilize (the flag, the rate limit).
- Write the timeline while it's fresh: detected → declared → mitigated → resolved, with timestamps.
- The postmortem is about the system that let it happen, not the person who pushed the button.
