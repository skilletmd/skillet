# Skillet welcome flow — growth spec (Dropbox-derived)

The ask is identical to Dropbox's: install background software that touches your
filesystem. Dropbox's four moves, mapped onto the current flow
(`welcome-flow.tsx`: Get app → Connect → Add first skill → trust → done).

## North-star activation event

**One skill synced to one runtime on one machine.** (Dropbox: "one file in one
folder on one device.") This already exists — it's `setSynced(true)` in step 3.
Everything upstream exists only to reach it fast; everything downstream exists
only because it happened. Instrument *this* event, not "app downloaded."

---

## 1. Prove the sync before asking for the install — the biggest gap

Dropbox's highest-leverage move was the screencast: value proven *before* anyone
downloaded. Waitlist went 5K→75K overnight. The risky step was gated behind
proof.

Today step 1 is "Get the app" with a description paragraph — we *tell*, we don't
*show*. The download CTA fires before the visitor has seen a skill land in Claude.

**Change:** Above or inside step 1, autoplay a silent ~15s loop of the real
thing — add a skill on web → chips flip syncing→live in Claude/Cursor/Codex on a
real machine. The `DeviceMini` + status-chip animation in `runSync` is already
the exact visual; capture it as a video/Lottie. The button then reads as "I want
that," not "install unknown software."

> Copy under the CTA stays benefit-first: *"Add a skill once. It shows up in
> every AI tool on this computer."*

## 2. Make the activation event the emotional peak, then immediately leverage it

`setSynced(true)` is the aha moment. Right now it reveals "Synced everywhere,"
then a trust panel disappears and "Follow people / From here" appears. The peak
is under-used.

**Change:** At the `synced` reveal, lead with the win in concrete terms —
*"`write-a-skill` is now live in Claude, Cursor, and Codex."* Name the runtimes
that actually lit up (we have them in `status`). This is the moment to ask for
the next thing (move 3), because delight is highest here.

## 3. Add a two-sided referral loop — gated on the friend's first sync

Completely absent today. Dropbox: 500MB to **both** sides, reward paid only when
the friend **installed the app**, not on signup. ~35% of daily signups, +60%
permanent lift. The reward physically dragged invitees through the install.

**Change:** Add a share step to the `synced` "From here" block, *before* the
generic actions:

- **Reward:** something Skillet-native and free at the margin — extra private
  skill slots, a team seat, increased sync limits, or pro days. Mirror Dropbox's
  "storage was the most-requested thing, and free at the margin" logic: pick the
  reward users already want more of.
- **Trigger:** payout fires on the **invitee's first successful sync**
  (`setSynced` on their machine), not on signup. Reuse the activation event as
  the referral-completion event. One metric, two jobs.
- **Both sides** get it. Referrer and referee.

## 4. Frame the share around the user's benefit, surface it where the value lives

Dropbox said **"Get more space,"** not "Invite your friends." Placed at the aha
moment, in Settings, and inside the desktop app — reward granted instantly,
in-product.

**Change:**
- Headline the share with what *they* get: *"Get [reward] — add a teammate"*,
  not "Invite friends."
- Surface the same prompt in three places, not just welcome: the **desktop app**
  (post-sync), web **Settings**, and this flow. Dropbox's reach came from the
  prompt being everywhere value was felt.
- Grant the reward natively and instantly — show the counter tick up in-product,
  no coupon/email.

---

## Trust — keep it, tighten it (move 5: over-invest in first experience)

Sean Ellis: ~50% of product-dev into onboarding; *"no good first experience → no
second experience."* For a filesystem tool the install→first-sync window *is* the
first experience.

`TrustPanel` ("Private, safe, yours") is right, but it currently shows only
*before* sync and vanishes after. For a tool that writes to disk, be explicit and
keep it reachable:

- State plainly what gets read/written and what never leaves the machine — the
  filesystem-trust analog of Dropbox's "it just works" transparency.
- Visible sync status (we have it) is itself trust-building — the user watches
  exactly what changed. Lean on it.

---

## Build order (highest leverage first)

1. **Pre-install demo video in step 1.** Biggest gap, directly mirrors Dropbox's
   single best move. Capture the existing `runSync` animation.
2. **Two-sided referral, gated on invitee's first sync.** New growth loop; reuses
   the activation event as the completion trigger.
3. **Sharpen the `synced` peak** — name the runtimes, then surface the share
   there first.
4. **Benefit-framed share copy + surface in desktop app and Settings.**

## What the sources could *not* tell us (validate ourselves)

- Dropbox's actual install→activation conversion delta from video-first vs
  download-first — tactic confirmed, numbers not. Instrument our own funnel.
- How much of the referral lift came from invitees *completing the install* vs
  just signing up. Track invitee-sync completion as its own number.
