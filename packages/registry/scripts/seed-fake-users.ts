/**
 * Seed fake authors + public skills so the trust graph (follow / feed) has
 * people to find and follow. Idempotent: re-running refreshes the same rows.
 *
 *   cd packages/registry
 *   REGISTRY_DB_PATH=./registry.db npx tsx scripts/seed-fake-users.ts
 *
 * Writes directly to the registry DB via the same schema the server uses.
 * Each demo author gets a users row carrying a claimed primary author key, and
 * every version is signed with it — without a signature `skillet add` refuses the
 * install ("is unsigned — registry-served versions must carry an Ed25519
 * envelope", core/commands/add.ts), so an unsigned seed can be browsed but never
 * installed. Delete them later with --clear.
 */
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { canonicalContentHash, bundleSignatureBytes } from '@skillet/protocol';
import { blobHash } from '../src/db/index.js';
import { createPrismaClient } from '../src/db/prisma-client.js';
import { publishKitVersionPrisma } from '../src/lib/kit-mutations.js';

/** DER prefix for a PKCS#8 Ed25519 private key wrapping a raw 32-byte seed. */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * Deterministic Ed25519 key per seeded author, derived from the handle rather
 * than generated fresh. Clients TOFU-pin an author's key on first install, so a
 * new key on every seed run would break any dev machine that already installed a
 * seeded skill with a key_id mismatch. Same handle in, same key out, forever.
 *
 * key_id is the raw public key as hex — matching publicKeyToKeyId() in
 * core/signing/index.ts, which hexes the JWK `x` value. It is NOT a hash.
 */
function seedAuthorKey(handle: string): {
  privateKey: ReturnType<typeof createPrivateKey>;
  keyId: string;
  publicKeyB64: string;
} {
  const seed = createHash('sha256').update(`skillet-seed-author:${handle}`).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' }) as { x: string };
  const raw = Buffer.from(jwk.x, 'base64url');
  return { privateKey, keyId: raw.toString('hex'), publicKeyB64: raw.toString('base64') };
}

// Fake scan verdicts for a couple of seeded skills, so the flagged /
// quarantined treatments (badge, warning, "scan findings" modal) have real data
// to render. Keyed by `${author}/${slug}`. findings_json is a plain Finding[]
// (the reader computes the summary). Remove or expand as the demo needs.
const SCAN_SEED: Record<
  string,
  { status: 'flagged' | 'quarantined'; findings: Record<string, unknown>[] }
> = {
  'devops-dan/incident-timeline': {
    status: 'flagged',
    findings: [
      { category: 'excessive-agency', confidence: 'low', file: 'SKILL.md', lineStart: 6, lineEnd: 6, snippet: 'auto-resolve the incident', why: 'excessive-agency:auto-approve' },
      { category: 'excessive-agency', confidence: 'low', file: 'references/runbook.md', lineStart: 18, lineEnd: 18, snippet: 'keep retrying until it clears', why: 'excessive-agency:loop' },
      { category: 'exfil', confidence: 'medium', file: 'references/runbook.md', lineStart: 47, lineEnd: 47, snippet: 'POST the summary to the status webhook', why: 'exfil:fetch-external' },
    ],
  },
  'devops-dan/terraform-review': {
    status: 'quarantined',
    findings: [
      { category: 'risky-call', confidence: 'high', file: 'SKILL.md', lineStart: 7, lineEnd: 7, snippet: 'run `terraform apply -auto-approve`', why: 'risky-call:shell' },
      { category: 'privilege-escalation', confidence: 'high', file: 'references/patterns.md', lineStart: 22, lineEnd: 22, snippet: 'escalate with sudo when blocked', why: 'privilege-escalation:sudo' },
    ],
  },
};

// A follow web among the fake people, so second-degree signals and follow-feed
// activity have data. [follower, target] pairs.
const FOLLOW_WEB: Array<[string, string]> = [
  ['grace-reviews', 'devops-dan'],
  ['grace-reviews', 'pm-priya'],
  ['grace-reviews', 'data-deniz'],
  ['devops-dan', 'grace-reviews'],
  ['devops-dan', 'data-deniz'],
  ['pm-priya', 'grace-reviews'],
  ['pm-priya', 'maya-writes'],
  ['pm-priya', 'sales-sam'],
  ['maya-writes', 'pm-priya'],
  ['maya-writes', 'sales-sam'],
  ['sales-sam', 'pm-priya'],
  ['sales-sam', 'maya-writes'],
  ['data-deniz', 'devops-dan'],
  ['data-deniz', 'grace-reviews'],
];
const seedUserId = (handle: string) => `seeduser-${handle}`;

interface SeedSkill {
  slug: string;
  description: string;
  body: string;
  installs: number;
  /** Pre-assigned taxonomy category (seed skills bypass publish/classify). */
  category: string;
}
interface SeedAuthor {
  handle: string;
  name: string;
  skills: SeedSkill[];
}

const AUTHORS: SeedAuthor[] = [
  {
    handle: 'maya-writes',
    name: 'Maya Chen',
    skills: [
      { slug: 'tighten-prose', description: 'Cut the flab from any draft without losing the voice.', installs: 4820, category: 'writing', body: 'Rewrite the passage to be tighter. Remove hedging, AI-ese, and repetition. Keep the author voice.' },
      { slug: 'newsletter-voice', description: 'Turn rough notes into a warm, punchy newsletter section.', installs: 2110, category: 'writing', body: 'Draft a newsletter section from these notes. Lead with the hook. One idea per paragraph.' },
      { slug: 'blog-outline', description: 'Outline a blog post that actually has a spine.', installs: 1340, category: 'writing', body: 'Produce a blog outline: a single thesis, 3-5 sections that each earn their place, and a close.' },
    ],
  },
  {
    handle: 'devops-dan',
    name: 'Dan Okafor',
    skills: [
      { slug: 'k8s-debug', description: 'Triage a misbehaving pod from logs and describe output.', installs: 6730, category: 'devops', body: 'Given kubectl describe + logs, diagnose the failing pod. State the most likely cause first.' },
      { slug: 'terraform-review', description: 'Review a Terraform plan for blast radius before apply.', installs: 3980, category: 'devops', body: 'Review this terraform plan. Flag destructive changes, drift, and anything that needs a second pair of eyes.' },
      { slug: 'incident-timeline', description: 'Build a clean incident timeline from a messy channel.', installs: 1890, category: 'devops', body: 'Reconstruct an incident timeline from these messages. Times, actions, who, and the resolution.' },
    ],
  },
  {
    handle: 'grace-reviews',
    name: 'Grace Liu',
    skills: [
      { slug: 'pr-review-strict', description: 'A strict, kind PR reviewer that catches the real bugs.', installs: 9120, category: 'quality', body: 'Review this diff. Correctness first, then edge cases, then style. Be specific and cite lines.' },
      { slug: 'security-pass', description: 'Second-pass security review for auth and input handling.', installs: 5240, category: 'security', body: 'Scan this change for auth, injection, and input-validation issues. Assume hostile input.' },
      { slug: 'test-coverage-gaps', description: 'Find the untested edge cases that will bite you.', installs: 2670, category: 'quality', body: 'List the edge cases this code does not test yet, ranked by likelihood of a real bug.' },
    ],
  },
  {
    handle: 'sales-sam',
    name: 'Sam Rivera',
    skills: [
      { slug: 'discovery-call-notes', description: 'Turn a messy call transcript into structured discovery notes.', installs: 3110, category: 'sales', body: 'From this transcript, extract pain, budget, timeline, stakeholders, and next steps.' },
      { slug: 'account-research', description: 'Pre-call account brief from public sources.', installs: 2240, category: 'sales', body: 'Build a one-page account brief: what they do, recent news, likely pains, and a hook.' },
      { slug: 'cold-email-rewrite', description: 'Rewrite a cold email so it sounds human and lands.', installs: 1560, category: 'sales', body: 'Rewrite this cold email. One clear ask, no fluff, a reason to reply now.' },
    ],
  },
  {
    handle: 'pm-priya',
    name: 'Priya Nair',
    skills: [
      { slug: 'prd-draft', description: 'Draft a tight PRD from a one-line feature idea.', installs: 7430, category: 'product', body: 'Draft a PRD: problem, who it is for, the smallest viable solution, and what we are NOT doing.' },
      { slug: 'user-story-split', description: 'Split a big story into shippable slices.', installs: 2980, category: 'product', body: 'Split this story into independently shippable slices, each with a clear acceptance check.' },
      { slug: 'launch-checklist', description: 'Generate a launch checklist sized to the risk.', installs: 1720, category: 'product', body: 'Produce a launch checklist scaled to this change: comms, rollback, metrics, owners.' },
    ],
  },
  {
    handle: 'data-deniz',
    name: 'Deniz Yilmaz',
    skills: [
      { slug: 'sql-explain', description: 'Explain a gnarly SQL query in plain English.', installs: 4410, category: 'database', body: 'Explain what this SQL does step by step, then flag anything slow or wrong.' },
      { slug: 'metric-definition', description: 'Pin down a fuzzy metric so the whole team agrees.', installs: 1980, category: 'database', body: 'Define this metric precisely: numerator, denominator, filters, and the edge cases.' },
    ],
  },
];

interface SeedKit {
  id: string;
  owner: string;
  name: string;
  description: string;
  /** Skill ids ("author:slug") to bundle — must be seeded skills above. */
  skills: string[];
  /** How many subscribers to seed (drives the "Subscribed by …" count). */
  subscribers: number;
}

// Public kits so the directory has real bundles with real subscriber counts
// (the count is a live COUNT over kit_subscriptions, so we seed actual rows).
const KITS: SeedKit[] = [
  {
    id: 'kit-ship-review',
    owner: 'grace-reviews',
    name: 'Ship Review',
    description: 'The bench you run a diff past before it merges: correctness, security, and the tests you forgot.',
    skills: ['grace-reviews:pr-review-strict', 'grace-reviews:security-pass', 'grace-reviews:test-coverage-gaps', 'devops-dan:k8s-debug'],
    subscribers: 34,
  },
  {
    id: 'kit-writers-room',
    owner: 'maya-writes',
    name: "Writer's Room",
    description: 'Turn rough notes into prose that still sounds like you.',
    skills: ['maya-writes:tighten-prose', 'maya-writes:newsletter-voice', 'maya-writes:blog-outline'],
    subscribers: 21,
  },
  {
    id: 'kit-pm-starter',
    owner: 'pm-priya',
    name: 'PM Starter',
    description: 'Fuzzy idea to shippable slices, with a launch plan that fits the risk.',
    skills: ['pm-priya:prd-draft', 'pm-priya:user-story-split', 'pm-priya:launch-checklist', 'sales-sam:discovery-call-notes'],
    subscribers: 18,
  },
  {
    id: 'kit-data-desk',
    owner: 'data-deniz',
    name: 'Data Desk',
    description: 'Read the query, pin the metric, settle the argument.',
    skills: ['data-deniz:sql-explain', 'data-deniz:metric-definition'],
    subscribers: 12,
  },
];
// Library web: seeded people subscribing to OTHER people's kits, so each
// profile's Library tab renders with real content (kit_subscriptions, kind='kit').
// [subscriber handle, kit id] — the subscriber must not own the kit.
const LIBRARY_KIT_WEB: Array<[string, string]> = [
  ['pm-priya', 'kit-ship-review'],
  ['pm-priya', 'kit-writers-room'],
  ['pm-priya', 'kit-data-desk'],
  ['grace-reviews', 'kit-pm-starter'],
  ['grace-reviews', 'kit-data-desk'],
  ['devops-dan', 'kit-ship-review'],
  ['devops-dan', 'kit-data-desk'],
  ['maya-writes', 'kit-pm-starter'],
  ['maya-writes', 'kit-ship-review'],
  ['sales-sam', 'kit-pm-starter'],
  ['sales-sam', 'kit-writers-room'],
  ['data-deniz', 'kit-ship-review'],
  ['data-deniz', 'kit-pm-starter'],
];

// Library web: seeded people subscribing to an author's whole output
// (kit_subscriptions, kind='author'). [subscriber handle, author handle] —
// the subscriber must not be the author.
const LIBRARY_AUTHOR_WEB: Array<[string, string]> = [
  ['pm-priya', 'maya-writes'],
  ['pm-priya', 'sales-sam'],
  ['grace-reviews', 'devops-dan'],
  ['devops-dan', 'grace-reviews'],
  ['maya-writes', 'pm-priya'],
  ['sales-sam', 'pm-priya'],
  ['data-deniz', 'devops-dan'],
];

// Library web: individual skills each seeded person saved one-click (members of
// their private "saved" kit). [saver handle, skill id] — public skills owned by
// someone else, so they render on the saver's Library tab as social proof.
const LIBRARY_SKILL_WEB: Array<[string, string]> = [
  ['pm-priya', 'grace-reviews:pr-review-strict'],
  ['pm-priya', 'maya-writes:tighten-prose'],
  ['pm-priya', 'devops-dan:k8s-debug'],
  ['grace-reviews', 'pm-priya:prd-draft'],
  ['grace-reviews', 'data-deniz:sql-explain'],
  ['devops-dan', 'grace-reviews:security-pass'],
  ['devops-dan', 'data-deniz:sql-explain'],
  ['maya-writes', 'pm-priya:prd-draft'],
  ['maya-writes', 'sales-sam:cold-email-rewrite'],
  ['sales-sam', 'maya-writes:newsletter-voice'],
  ['sales-sam', 'pm-priya:user-story-split'],
  ['data-deniz', 'devops-dan:terraform-review'],
  ['data-deniz', 'grace-reviews:test-coverage-gaps'],
];
const savedKitId = (handle: string) => `kit-saved-${handle}`;

// Inbound activity targeting a real account so its Notifications page renders:
// some seeded people follow them, subscribe to one of their public kits, and
// subscribe to their skills (author-kit). Set via `--notify <your-handle>` to
// target your own signed-in account; defaults to a seeded demo author so the
// page renders out of the box. No-op when the account / a public kit doesn't exist.
const notifyArg = process.argv.indexOf('--notify');
const NOTIFY_TARGET =
  notifyArg !== -1 && process.argv[notifyArg + 1]
    ? process.argv[notifyArg + 1].replace(/^@/, '')
    : 'maya-writes';
const NOTIFY_FOLLOWERS = ['grace-reviews', 'devops-dan', 'pm-priya'];
const NOTIFY_KIT_SUBS = ['maya-writes', 'sales-sam', 'data-deniz'];
const NOTIFY_AUTHOR_SUBS = ['pm-priya', 'devops-dan'];

// Lightweight subscriber accounts (no author row, no skills) that exist only to
// give kits a believable subscriber count. Sized to the busiest kit.
const SUBSCRIBER_POOL = 40;
const subUserId = (n: number) => `seedsub-${n}`;

const nowSec = () => Math.floor(Date.now() / 1000);

// A minimal SKILL.md so the detail view / file listing has real content. The catalog
// reads description from the skills row; this is the on-disk bundle we hash + store.
function skillMd(s: SeedSkill): Buffer {
  return Buffer.from(`---\nname: ${s.slug}\ndescription: ${s.description}\n---\n\n${s.body}\n`, 'utf8');
}

async function run(): Promise<void> {
  const clear = process.argv.includes('--clear');
  const prisma = createPrismaClient();
  const handles = AUTHORS.map((a) => a.handle);
  const kitIds = [...KITS.map((k) => k.id), ...handles.map(savedKitId)];
  try {
    if (clear) {
      // Delete in FK-dependency order — several relations are NoAction, not Cascade.
      await prisma.kit_subscriptions.deleteMany({ where: { OR: [{ kit_id: { in: kitIds } }, { author_id: { in: handles } }] } });
      await prisma.kit_skills.deleteMany({ where: { kit_id: { in: kitIds } } });
      await prisma.kits.deleteMany({ where: { owner_id: { in: handles } } });
      await prisma.follows.deleteMany({ where: { subject_id: { in: handles } } });
      await prisma.follow_counts.deleteMany({ where: { subject_id: { in: handles } } });
      await prisma.skill_versions.deleteMany({ where: { skills: { author_id: { in: handles } } } });
      await prisma.skills.deleteMany({ where: { author_id: { in: handles } } });
      await prisma.users.deleteMany({ where: { OR: [{ id: { startsWith: 'seeduser-' } }, { id: { startsWith: 'seedsub-' } }] } });
      await prisma.authors.deleteMany({ where: { id: { in: handles } } });
      console.log(`Cleared ${handles.length} seeded authors, their skills, and the demo social graph.`);
      return;
    }

    for (const a of AUTHORS) {
      await prisma.authors.upsert({
        where: { id: a.handle },
        create: { id: a.handle, name: a.name },
        update: { name: a.name },
      });
      // The manifest route resolves the signing key with
      // `users.findFirst({ where: { handle } })`, so a seeded author needs a users
      // row under its own handle or the served author_key_id/public_key stay null
      // and every version reads as unsigned. The primary key lives on users
      // (db/index.ts getPrimaryAuthorKeyPrisma) — deliberately NOT an author_keys
      // row, which carries no publish authority.
      const key = seedAuthorKey(a.handle);
      await prisma.users.upsert({
        where: { id: seedUserId(a.handle) },
        create: {
          id: seedUserId(a.handle),
          handle: a.handle,
          author_key_id: key.keyId,
          author_public_key: key.publicKeyB64,
        },
        update: {
          handle: a.handle,
          author_key_id: key.keyId,
          author_public_key: key.publicKeyB64,
        },
      });
    }

    let skillCount = 0;
    for (const a of AUTHORS) {
      const authorKey = seedAuthorKey(a.handle);
      for (const s of a.skills) {
        const skillId = `${a.handle}:${s.slug}`;
        const body = skillMd(s);
        const versionHash = canonicalContentHash(new Map([['SKILL.md', new Uint8Array(body)]]));
        const bh = blobHash(body);

        await prisma.blobs.upsert({
          where: { hash: bh },
          create: { hash: bh, bytes: body, size: body.length, storage_loc: 'inline' },
          update: {},
        });
        await prisma.skills.upsert({
          where: { id: skillId },
          create: {
            id: skillId, author_id: a.handle, slug: s.slug, description: s.description,
            category: s.category, visibility: 'public', install_count: s.installs, latest_hash: versionHash,
          },
          update: {
            description: s.description, category: s.category, visibility: 'public',
            install_count: s.installs, latest_hash: versionHash,
          },
        });
        // v2 bundle signature: a canonical struct binding key + ref + version +
        // content_hash, so a signature cannot replay onto another name or
        // identity. Every seeded skill has exactly one version, hence ordinal 1.
        // Setting author_key_id is what makes resolveSigVersion() serve this as
        // v2 — the sig_version column is inferred from it, not stored here.
        const signature = sign(
          null,
          bundleSignatureBytes({
            typ: 'skillet-bundle-v1',
            author_key_id: authorKey.keyId,
            ref: `@${a.handle}/${s.slug}`,
            version: 1,
            content_hash: versionHash,
          }),
          authorKey.privateKey,
        ).toString('base64');
        const versionSig = {
          signature_alg: 'ed25519',
          signature_key_id: authorKey.keyId,
          signature_b64: signature,
          author_key_id: authorKey.keyId,
        };
        await prisma.skill_versions.upsert({
          where: { skill_id_hash: { skill_id: skillId, hash: versionHash } },
          create: { skill_id: skillId, hash: versionHash, metadata_json: '{}', published_by: a.handle, ...versionSig },
          // Re-seeding must repair rows written by an older unsigned seed, so the
          // update leg carries the signature too rather than being a no-op.
          update: versionSig,
        });
        await prisma.skill_version_files.upsert({
          where: { skill_id_version_hash_path: { skill_id: skillId, version_hash: versionHash, path: 'SKILL.md' } },
          create: { skill_id: skillId, version_hash: versionHash, path: 'SKILL.md', blob_hash: bh },
          update: { blob_hash: bh },
        });

        // Every version needs a scan row. A missing row reads as 'pending'
        // (serve-guards.ts), which 409s the download with "Harm scan has not
        // completed" — so without this the catalog browses but cannot be
        // installed. The handful of deliberately flagged/quarantined demo skills
        // keep their seeded verdict; everything else scans clean.
        const scan = SCAN_SEED[`${a.handle}/${s.slug}`] ?? { status: 'clean' as const, findings: [] };
        await prisma.skill_version_scans.upsert({
          where: { skill_id_skill_version_id: { skill_id: skillId, skill_version_id: versionHash } },
          create: {
            skill_id: skillId, skill_version_id: versionHash, status: scan.status,
            findings_json: JSON.stringify(scan.findings), scanned_at: nowSec(),
          },
          update: { status: scan.status, findings_json: JSON.stringify(scan.findings), scanned_at: nowSec() },
        });
        skillCount++;
      }
    }

    // ---- social graph: users backing follows/subs (authors have no users row) ----
    const seedUserIds = new Set<string>();
    const wantUser = (h: string) => seedUserIds.add(seedUserId(h));
    for (const [f] of FOLLOW_WEB) wantUser(f);
    for (const [s] of LIBRARY_KIT_WEB) wantUser(s);
    for (const [s] of LIBRARY_AUTHOR_WEB) wantUser(s);
    for (const [s] of LIBRARY_SKILL_WEB) wantUser(s);
    for (const h of [...NOTIFY_FOLLOWERS, ...NOTIFY_KIT_SUBS, ...NOTIFY_AUTHOR_SUBS]) wantUser(h);
    const poolSize = Math.max(0, ...KITS.map((k) => k.subscribers));
    for (let i = 0; i < poolSize; i++) seedUserIds.add(subUserId(i));
    for (const id of seedUserIds) {
      await prisma.users.upsert({ where: { id }, create: { id }, update: {} });
    }

    // follows (+ inbound notify followers) and the denormalized follow_counts cache
    const followEdges: Array<[string, string]> = [
      ...FOLLOW_WEB,
      ...NOTIFY_FOLLOWERS.map((f) => [f, NOTIFY_TARGET] as [string, string]),
    ];
    const followersOf = new Map<string, Set<string>>();
    for (const [f, t] of followEdges) {
      await prisma.follows.upsert({
        where: { follower_user_id_subject_kind_subject_id: { follower_user_id: seedUserId(f), subject_kind: 'author', subject_id: t } },
        create: { follower_user_id: seedUserId(f), subject_kind: 'author', subject_id: t },
        update: {},
      });
      (followersOf.get(t) ?? followersOf.set(t, new Set()).get(t)!).add(f);
    }

    // public demo kits + their skills
    for (const k of KITS) {
      const slug = k.id.replace(/^kit-/, '');
      await prisma.kits.upsert({
        where: { id: k.id },
        create: { id: k.id, owner_id: k.owner, name: k.name, description: k.description, visibility: 'public', kind: 'manual', slug },
        update: { name: k.name, description: k.description, visibility: 'public', slug },
      });
      for (const skillId of k.skills) {
        await prisma.kit_skills.upsert({
          where: { kit_id_skill_id: { kit_id: k.id, skill_id: skillId } },
          create: { kit_id: k.id, skill_id: skillId },
          update: {},
        });
      }
      // Publish a version snapshot, exactly as the app does on a real publish.
      // subscriptionSkillRowsPrisma resolves a subscribed kit's contents from
      // the latest kit_versions snapshot, NOT from live kit_skills — with no
      // snapshot it hits `if (!ver) continue` and the subscription contributes
      // nothing. So without this a demo kit browses fine and subscribes fine,
      // yet syncs nothing to the subscriber's devices. Reuses the real helper so
      // the snapshot shape cannot drift from the publish path; it no-ops when
      // membership is unchanged, which keeps re-seeding idempotent.
      await publishKitVersionPrisma(prisma, k.id, 'seeded kit', k.owner);
    }

    // per-user "Saved" kits (kind='saved') holding one-click-saved skills
    const savedByUser = new Map<string, string[]>();
    for (const [saver, skillId] of LIBRARY_SKILL_WEB) {
      (savedByUser.get(saver) ?? savedByUser.set(saver, []).get(saver)!).push(skillId);
    }
    for (const [saver, skillIds] of savedByUser) {
      const kitId = savedKitId(saver);
      await prisma.kits.upsert({
        where: { id: kitId },
        create: { id: kitId, owner_id: saver, name: 'Saved', visibility: 'private', kind: 'saved' },
        update: {},
      });
      for (const skillId of skillIds) {
        await prisma.kit_skills.upsert({
          where: { kit_id_skill_id: { kit_id: kitId, skill_id: skillId } },
          create: { kit_id: kitId, skill_id: skillId },
          update: {},
        });
      }
    }

    // subscriptions: library kit-subs + author-subs, notify subs, and per-kit pools
    // (each kit's "N subscribers" is a live COUNT over kit_subscriptions rows).
    const putSub = (id: string, data: { user_id: string; kind: string; kit_id?: string; author_id?: string }) =>
      prisma.kit_subscriptions.upsert({ where: { id }, create: { id, ...data }, update: {} });
    for (const [subr, kitId] of LIBRARY_KIT_WEB) await putSub(`sub-kit-${subr}-${kitId}`, { user_id: seedUserId(subr), kind: 'kit', kit_id: kitId });
    for (const [subr, author] of LIBRARY_AUTHOR_WEB) await putSub(`sub-author-${subr}-${author}`, { user_id: seedUserId(subr), kind: 'author', author_id: author });
    for (const s of NOTIFY_KIT_SUBS) await putSub(`sub-notify-kit-${s}`, { user_id: seedUserId(s), kind: 'kit', kit_id: 'kit-writers-room' });
    for (const s of NOTIFY_AUTHOR_SUBS) await putSub(`sub-notify-author-${s}`, { user_id: seedUserId(s), kind: 'author', author_id: NOTIFY_TARGET });
    for (const k of KITS) {
      for (let i = 0; i < k.subscribers; i++) await putSub(`sub-pool-${k.id}-${i}`, { user_id: subUserId(i), kind: 'kit', kit_id: k.id });
    }

    // author-subscriber counts for the denormalized follow_counts cache
    const authorSubs = new Map<string, number>();
    for (const [, author] of LIBRARY_AUTHOR_WEB) authorSubs.set(author, (authorSubs.get(author) ?? 0) + 1);
    authorSubs.set(NOTIFY_TARGET, (authorSubs.get(NOTIFY_TARGET) ?? 0) + NOTIFY_AUTHOR_SUBS.length);
    for (const author of new Set<string>([...followersOf.keys(), ...authorSubs.keys()])) {
      const followers = followersOf.get(author)?.size ?? 0;
      const subscribers = authorSubs.get(author) ?? 0;
      await prisma.follow_counts.upsert({
        where: { subject_kind_subject_id: { subject_kind: 'author', subject_id: author } },
        create: { subject_kind: 'author', subject_id: author, followers, subscribers },
        update: { followers, subscribers },
      });
    }

    console.log(`Seeded ${AUTHORS.length} authors, ${skillCount} public skills, ${KITS.length} kits, ${followEdges.length} follows (idempotent).`);
    console.log('Browse, feed, profiles, follows, kits, and library all render.');
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
