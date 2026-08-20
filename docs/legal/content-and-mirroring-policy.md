# Content & Mirroring Policy

_Effective August 20, 2026._

Skillet hosts two kinds of skill content: skills people **publish directly** to
us, and skills we **mirror** from public GitHub repositories. This page explains
how each works, how we attribute sources, and how to claim or remove content.

## What we mirror, and what we don't

We mirror a public GitHub repository's skills into our catalog **only when all of
these are true**:

- The repository is **public** and reachable.
- It is the owner's **own** repository (not a fork).
- It carries a **permissive, redistributable license** — the SPDX license must be
  one we recognize as permitting redistribution (e.g. MIT, Apache-2.0, BSD, ISC,
  MPL-2.0, 0BSD, Unlicense, CC0). A repository with **no license**, an
  unrecognized license, or a copyleft/no-redistribution license is **not
  mirrored** — under default copyright, "no license" means all rights reserved and
  we have no right to republish it.
- It contains a valid `SKILL.md`.

Mirrored skills keep syncing from their source until the source's owner claims
them (see below).

## Attribution

Every mirrored skill links back to its **canonical GitHub source** and names the
**original author** and the **source license**. We do not strip authorship or
license notices — preserving them is both required by the permissive licenses we
rely on and core to how trust works on Skillet.

## Importing vs. mirroring

- **Import (copy):** Any signed-in user can import a skill from a GitHub URL into
  their own account. Imports are **private to you by default.** We do not
  republish an imported skill publicly on your behalf, because you may not own the
  source or it may not carry a redistributable license.
- **Publish publicly:** To make skills public and keep them auto-synced, connect
  GitHub and publish from a repository **you own**. That path runs the same
  ownership + license checks described above.

## Claiming a mirrored profile or skill

If we mirror your work, you can **claim** it by proving control of the source on
GitHub (org owner or repo admin). Claiming makes you the owner of the namespace on
Skillet and stops further automatic syncing unless you opt back in.

## Removal

If you are the rights holder and want mirrored content changed or removed:

- **Fastest:** change or remove the license/skill at the GitHub source — the
  mirror follows the source.
- **Directly:** use the report/removal flow on the skill, or contact
  **`skilletdotmd [at] gmail [dot] com`**. For copyright specifically, see our
  [DMCA / Copyright Policy](./dmca-policy.md).

We remove mirrored content promptly on a valid request from its rights holder.

## Malicious or unsafe content

Every published and mirrored skill is scanned for security issues, and unsafe
versions are held from installation. To report abuse or a harmful skill, use the
report flow or contact **`skilletdotmd [at] gmail [dot] com`**. See also our
[Terms of Service](./terms-of-service.md).
