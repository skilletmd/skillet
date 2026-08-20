# Security

Skillet is a local-first skill sync platform. Skills are third-party instruction bundles that AI agents read and execute. This document summarizes our threat model and the controls that matter most.

## Trust boundaries

| Boundary | What we trust | What we verify |
|----------|---------------|----------------|
| Registry publish | Author identity at claim time | Ed25519 signature (v2 binds ref + version + hash), bundle path allowlist, sync secret gate, async harm scan |
| Registry serve | Nothing about stored bytes | Re-hash blobs, scan verdict, live ACL on every fetch |
| Client pull | Pinned author primary key (TOFU) | Signature chain, revoked device keys, bundle path validation at write |
| Client materialize | Nothing without crypto | `verifyForMaterialize`, scan quarantine gate, trust policy for human review only |
| Web | Session + admin allowlist | `/admin` proxy gate, fail-closed web-internal secret, markdown link scheme allowlist, **CSP enforce** ([details](./docs/security/content-security-policy.md)) |

## Primary threat: supply chain

A malicious skill reaching a subscriber's agent runtime is the dominant risk. Controls are layered:

1. **Serve-boundary integrity** — the registry re-verifies blob bytes and scan status before every download.
2. **Signature binding (v2)** — signatures attest author, ref, version, and content hash (legacy v1 content-hash-only signatures remain accepted during migration).
3. **Trust policy** — auto-apply is scoped to pinned authors; session-attested and unpinned authors require explicit review.
4. **Bundle shape allowlist** — dotfiles, `.git/`, hooks, and agent-control filenames are rejected at validate time.
5. **Adapter hardening** — Cursor `.mdc` emission uses YAML block scalars; managed agent-instruction files are not silently mutated by skill content.

## Known limitations & trust assumptions

The guarantees above are real, but they stop where these begin. A self-hoster, auditor, or subscriber should know exactly where the trust bottoms out.

**Key trust is TOFU, anchored to the registry.** The client pins an author's public key the first time it syncs a skill from that author (`core/src/commands/sync.ts`); every later fetch is verified against the pinned key, and a key change fails loud (`key_id_mismatch`). But the *first* fetch trusts whatever key the registry serves — there is no out-of-band key verification. A malicious or compromised registry can therefore serve an attacker-minted key plus a matching signature for an author you have never synced, and it will verify clean. Signatures protect against substitution *after* first pin, not against a hostile registry on first use. A key-transparency log or signed author-key directory is the natural hardening and is not yet built.

**Quarantine is the only takedown; unlist and suspend are not.** Moderation is a manual admin action in the `/admin` Reports queue — nothing is enforced automatically on report volume. Only `quarantined` blocks downloads (for a skill across all versions, or for a single version the scanner judged dangerous). `unlisted` hides a skill from discovery but it stays directly fetchable by anyone who already holds its `@author/slug` reference, and suspending an author unlists their skills rather than quarantining them. So to actually stop delivery of a malicious skill — including to clients that already pinned its reference in a lockfile — an admin must **quarantine** it, not merely unlist or suspend.

**Replay protection is per-process — run a single registry instance.** Internal web-BFF→registry calls are signed with a timestamp (±30s) and a single-use nonce, but the nonce store is an in-memory map in one process (`registry/src/auth/web-internal-sig.ts`). Under horizontal scaling a captured request could be replayed against a sibling instance within the window. Run a single registry instance until a shared nonce backend (e.g. Redis) lands, and keep the internal signing routes off the public internet — see the README "Operations" section.

## Reporting

Report suspected vulnerabilities through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. This delivers the report privately to the maintainers.

Please do not open public issues for exploitable findings before coordinated disclosure. We aim to acknowledge a report within 72 hours and will agree a disclosure timeline with you before any details are made public.
