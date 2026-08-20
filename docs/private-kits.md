# Private kits: team onboarding

A **kit** is a named collection of skills that an owner controls. Skills in a kit are private: only the kit owner, invited members, and kit-key holders can sync them.

## Who this is for

- Team leads who want to publish shared runbooks and internal tools
- Agents or CI pipelines that need a scoped, revocable credential to pull a specific kit

---

## 1 — Owner: create a kit and publish a skill

```bash
# Publish a skill to the registry under your handle
skillet publish ./my-skill --slug my-tool

# Create a private kit
skillet kit create my-team-kit

# Add the skill to the kit
skillet kit add my-team-kit @you/my-tool
```

Only you (the kit owner) can modify the kit's contents or membership.

---

## 2 — Invite a teammate

```bash
skillet kit invite my-team-kit teammate-handle
```

The invite is pending until `teammate-handle` creates their Skillet account. Once they do, the invite automatically resolves to a kit membership and they can sync on their next `skillet sync`.

---

## 3 — Member: accept and sync

The invitation resolves automatically when the member claims their handle. No explicit accept step is needed.

```bash
# Sign in (email magic link) — session saved to ~/.skillet/session.json
skillet auth login --email you@example.com

# Or link a new machine with a pair code from skillet.md → Settings → Devices
skillet connect ABCD-1234

# Sync — picks up all kits you own or are a member of
skillet sync
```

The union manifest includes every skill from your kits and from every kit where you are a member. Skills from shared kits appear alongside your own skills in every supported runtime (Claude Code, Codex, Cursor, etc.).

---

## 4 — Headless agents: kit-keys

A **kit-key** (`skillet_k_…`) is a scoped, revocable credential that lets a headless agent or CI runner pull exactly one kit — nothing more.

### Mint a kit-key

```bash
skillet kit key mint my-team-kit --label ci-runner
# → skillet_k_<64 hex chars>
```

Store the token in your CI secret store (e.g. GitHub Actions `secrets.SKILLET_KIT_KEY`).

### Use a kit-key in CI

```yaml
- name: Sync Skillet skills
  env:
    SKILLET_TOKEN: ${{ secrets.SKILLET_KIT_KEY }}
    SKILLET_APPROVE_PRE: "1"   # auto-approve graded-diff gate in headless runs
  run: skillet sync
```

`SKILLET_APPROVE_PRE=1` bypasses the interactive graded-diff prompt and records approval in the lock file automatically. Do not set this in interactive sessions — it defeats the review gate.

### Revoke a kit-key

```bash
skillet kit key revoke my-team-kit <kit-key-id>
```

Revocation is immediate: the next `skillet sync` with the revoked token receives a 401 and pulls nothing. The agent's local state (already-approved bundles) is unaffected.

---

## Security model

| Principal | Sees in manifest | Can fetch content |
|-----------|-----------------|-------------------|
| Owner session | All own kits | Yes |
| Member session | Owned kits + member kits | Yes |
| Kit-key | Bound kit only | Yes (bound kit) |
| No token | — | 401 |

- Unauthorized content requests return 404 (not 403) — private kit existence is not probeable.
- Kit-key isolation is enforced at the manifest layer: a kit-key for kit-A never sees skills from kit-B, even if the same agent has both tokens.
- All bundles are Ed25519-signed by the author at publish time and verified client-side before materialization. TOFU pins the author key on first sync.

---

## Removing a member

```bash
skillet kit member remove my-team-kit teammate-handle
```

After removal, the member's next `skillet sync` will no longer receive kit skills in the union manifest. Already-materialized files on their machine are not deleted automatically.
