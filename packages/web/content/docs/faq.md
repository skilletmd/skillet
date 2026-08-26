---
title: FAQ
description: Quick answers to the questions that don't fit anywhere else.
order: 7
section: Using Skillet
image: /docs/faq.png
---

Quick answers to a few common questions. Everything else has its own page; start with [What is Skillet?](/docs)

## Do I need to be a developer?

No. Install the app, then add any skill with one click, or use the **Add to Claude** and **Add to ChatGPT** buttons on a skill page. See [Install](/docs/install).

## Is it free?

Yes to start. Sign up (passwordless, takes seconds), pair your machine with one code, and bring in the skills you already have. No payment. The protocol and CLI are open source, and individual use (sync, add, publish) is free. No ads. Skillet doesn't make money off who looks at your skills.

## A skill isn't showing up in my AI tool. What do I check?

Usually the tool was already open when the skill landed; start a new chat or session. If Skillet couldn't find where your tool keeps skills, it tells you in plain language and points to the fix. See [Runtimes](/docs/runtimes) for where each tool expects skills.

## Windows says "running scripts is disabled on this system". What now?

That is Windows PowerShell refusing to load npm's `.ps1` shim, so `npx` and `npm` stop before Skillet runs. Nothing is broken and nothing installed wrongly. Either use the `.cmd` shims the policy doesn't gate (`npx.cmd skilletmd`), or allow local scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, which needs no admin rights. The tray app avoids it entirely: it bundles the CLI, so it needs neither Node nor npm. See [Install](/docs/install).

## How do I remove a skill?

Remove it from your kit and run `skillet sync`. It stops being written to your tools. Files already on your machine stay in place; Skillet doesn't delete them out from under you.

## Can my teammates or admins see my personal skills?

No. Your own private skills and personal private kits are yours alone. Being on a team never reaches into what you own personally. Team roles only apply to skills and kits owned *by the team*. You share something only by publishing it or adding it to a shared kit. See [Teams and shared kits](/docs/teams).

## What can each team role do?

Members can see and run everything in the team's private kits, but they're read-only: they can't publish or change what's shared. Owners and admins can publish, change visibility, and manage a kit's contents and members. Anyone can **propose a change** to a teammate's skill; the owner reviews it before it publishes. Full table in [Teams and shared kits](/docs/teams).
