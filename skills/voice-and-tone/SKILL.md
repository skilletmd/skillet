---
name: voice-and-tone
description: "Mailchimp-style voice and tone for reader-facing writing — plainspoken, genuine, clear over clever. Use when writing or auditing docs, UI copy, emails, help articles, or any text a customer reads."
user-invocable: true
---

# voice-and-tone

Adapted from Mailchimp's voice-and-tone guide. The core idea: **one voice, many tones.** Your voice — who you are — never changes. Your tone — how you say it — flexes to match what the reader is feeling right now. Someone reading a getting-started page is curious; someone reading an error page is stressed. Same voice, different tone.

The overriding rule: **it's always more important to be clear than entertaining.** When clarity and cleverness conflict, clarity wins every time.

## The voice

Four traits. Hold all four at once.

- **Plainspoken.** Strip the fluff. No hype, no fluffy metaphors, no emotional manipulation. The reader came to get something done — value their time and their intelligence. Say the true thing in the plainest words that carry it.
- **Genuine.** Talk to the reader like a knowledgeable friend, not a brand. Warm, familiar, accessible. Meet them where they are without dumbing it down.
- **Translator.** You understand the complex machinery; the reader shouldn't have to. Take the jargon, the protocol detail, the internal term — and render it in language anyone can act on. This is the highest-leverage move in technical docs.
- **Dry humor, sparingly.** Straight-faced and subtle when it fits. Never force it — **forced humor is worse than none.** If a joke costs an ounce of clarity, drop it.

## Writing principles — clear, useful, friendly

Lead with these when drafting or auditing:

1. **Get to the point.** Put what the reader needs in the first line. Don't warm up, don't set the scene. If they read only the opening sentence, they should still get the answer.
2. **Write simply.** Short sentences. Common words. Prefer "use" over "utilize," "help" over "facilitate," "about" over "regarding." If a shorter word works, use it.
3. **Be concise.** Cut throat-clearing ("It's worth noting that," "In order to," "At this point in time"). Cut hedges ("we think you might possibly"). Every word earns its place.
4. **Active voice, real subject.** "A skill is published by you" → "You publish a skill." Name who does what.
5. **Be specific.** Replace vague claims with the fact behind them: not "syncs quickly" but "syncs in under a second"; not "works everywhere" but "works in Claude, Cursor, and Codex."
6. **Break up the text.** Short paragraphs. Headings that answer a question. Lists for steps. A wall of text reads as work.
7. **Write for all readers.** Some skim, some read every word, some are brand new. Front-load the essentials, keep one idea per paragraph, define a term the first time it appears.
8. **Stay positive.** Tell people what they *can* do, not just what they can't. "To publish, first claim a handle" beats "You can't publish without a handle."

## Tone: match the reader's state

Before writing a passage, ask **what is the reader feeling here?**

- **Onboarding / first success** → encouraging, momentum-building. They're curious but unsure. Celebrate the small win.
- **Reference / how-to** → calm, neutral, efficient. They want the answer, not personality.
- **Errors / trust / safety / things went wrong** → plain, direct, reassuring. Drop all humor. Say what happened, why, and the next step. Never make a stressed reader decode a joke.

## Using this to audit docs

For each doc, score it against the checklist and flag specific lines:

- [ ] **Point first?** Does the opening paragraph answer "what is this and why do I care"? Or does it warm up?
- [ ] **Plain words?** Any jargon used without translating it? Any `utilize`/`leverage`/`facilitate`/`in order to`?
- [ ] **Concise?** Sentences over ~25 words, throat-clearing openers, hedges, redundant pairs?
- [ ] **Active voice?** Passive constructions hiding who acts?
- [ ] **Specific?** Vague claims ("fast," "seamless," "powerful") that should be a concrete fact?
- [ ] **Scannable?** Long paragraphs that should be lists; headings that are nouns ("Configuration") instead of questions or tasks ("Configure your runtime")?
- [ ] **Right tone for the reader's state?** A trust/safety or error page that's too jokey; an onboarding page that's cold.
- [ ] **Reader, not "the user."** Address the reader as "you." Cold third-person "the user must…" distances them.

Report findings as **`file:line` → problem → suggested rewrite.** Don't rewrite the whole doc unless asked; show the high-leverage fixes first.

## Before / after

Jargon, passive, buried point:
> *Before:* "Skills are able to be synchronized across runtimes by the CLI, which facilitates the propagation of updates to all configured environments."
> *After:* "Publish once, and the CLI syncs your skill to every tool you use — Claude, Cursor, Codex."

Throat-clearing, vague:
> *Before:* "It's worth noting that Skillet is a powerful platform that makes it easy to manage your skills in a seamless way."
> *After:* "Skillet keeps your skills in one place and syncs them everywhere you work."

Cold tone on a stressful page:
> *Before:* "Invalid signature. Authentication failed."
> *After:* "We couldn't verify this skill's signature, so we didn't install it. This usually means the file was changed after signing. Try re-downloading from the author's page."

## What not to do

- Don't strip warmth chasing brevity. **Plainspoken, not curt.** Genuine is a voice trait too.
- Don't cut the caveat that keeps a claim honest. Clarity includes the truth.
- Don't add personality to a page where the reader is stressed. Tone serves the reader, not the writer.
