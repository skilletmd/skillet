import type { AuthorProfile, Skill, SkillCatalogResponse, SkillSummary } from './types'
import { registryFetchOrigin } from './registry-origin'

// Prefer REGISTRY_URL (loopback on prod) over NEXT_PUBLIC_* so SSR never
// hairpins through Cloudflare. Empty ⇒ seed mock data (local / CI).
export const REGISTRY_BASE_URL = registryFetchOrigin()

export const MOCK_SKILLS: Skill[] = [
  {
    author: 'skillet',
    slug: 'skillet-sync',
    title: 'skillet-sync',
    description:
      'Coach skill for Skillet. Teaches the sync model, key commands, and how skills travel across runtimes. Trigger when a user asks how Skillet works, how to sync skills, or how to share a skill with someone.',
    installCount: 0,
    latestVersion: 'v2',
    versions: [
      {
        version: 'v2',
        publishedAt: '2026-06-13T10:25:00Z',
        changelog: 'Add troubleshooting section',
      },
      { version: 'v1', publishedAt: '2026-06-13T10:23:00Z', changelog: 'Initial publish' },
    ],
    tags: ['coaching', 'onboarding', 'sync'],
    categories: ['workflow', 'productivity'],
    publishedAt: '2026-06-13T10:23:00Z',
    updatedAt: '2026-06-13T10:25:00Z',
  },
  {
    author: 'skillet',
    slug: 'skillet-onboarding',
    title: 'skillet-onboarding',
    description:
      'Step-by-step onboarding for new Skillet users. Trigger on first run, when someone asks how to get started with Skillet, or when setting up Skillet in a new environment.',
    installCount: 0,
    latestVersion: 'v1',
    versions: [
      { version: 'v1', publishedAt: '2026-06-13T10:23:00Z', changelog: 'Initial publish' },
    ],
    tags: ['onboarding', 'coaching', 'quickstart'],
    categories: ['workflow', 'productivity'],
    publishedAt: '2026-06-13T10:23:00Z',
    updatedAt: '2026-06-13T10:23:00Z',
  },
  {
    author: 'skillet',
    slug: 'pr-handoff',
    title: 'pr-handoff',
    description:
      'Generates a complete pull request description pre-filled with what changed, why, how to test locally, and an acceptance criteria checklist. Use before opening or updating any PR.',
    installCount: 0,
    latestVersion: 'v1',
    versions: [
      { version: 'v1', publishedAt: '2026-06-13T10:23:00Z', changelog: 'Initial publish' },
    ],
    tags: ['pr', 'code-review', 'git', 'workflow'],
    categories: ['code-quality', 'workflow'],
    publishedAt: '2026-06-13T10:23:00Z',
    updatedAt: '2026-06-13T10:23:00Z',
  },
  {
    author: 'skillet',
    slug: 'write-a-skill',
    title: 'write-a-skill',
    description:
      'Helps you write a good SKILL.md. Covers frontmatter fields, trigger description, scope, and common mistakes. Use when creating a new skill or improving an existing one.',
    installCount: 0,
    latestVersion: 'v1',
    versions: [
      { version: 'v1', publishedAt: '2026-06-13T10:23:00Z', changelog: 'Initial publish' },
    ],
    tags: ['authoring', 'skills', 'documentation', 'meta'],
    categories: ['workflow', 'productivity'],
    publishedAt: '2026-06-13T10:23:00Z',
    updatedAt: '2026-06-13T10:23:00Z',
  },
  {
    author: 'taylor',
    slug: 'deploy-ritual',
    title: 'Deploy Ritual',
    description:
      "Pre-deploy checklist and rollout commands for production releases. Catches the things you forget when you're rushing.",
    installCount: 771,
    latestVersion: '1.4.0',
    versions: [
      { version: '1.4.0', publishedAt: '2026-06-05T11:00:00Z', changelog: 'Add canary step' },
      { version: '1.3.0', publishedAt: '2026-04-20T09:00:00Z', changelog: 'Rollback procedure' },
    ],
    tags: ['deploy', 'ops', 'checklist'],
    categories: ['ops', 'workflow'],
    installUrl: 'https://registry.skillet.md/install/taylor/deploy-ritual',
    signatureStatus: 'verified',
    security: {
      status: 'clean',
      scannedAt: '2026-06-05T11:05:00Z',
      findingCount: 0,
      findings: [],
    },
    publishedAt: '2026-04-20T09:00:00Z',
    updatedAt: '2026-06-05T11:00:00Z',
  },
  {
    author: 'ada',
    slug: 'writing-voice',
    title: 'Writing Voice',
    description:
      'Editorial voice: cadence, banned words, and how to end a paragraph. Carries the human tone into every draft.',
    installCount: 418,
    latestVersion: '3.0.1',
    versions: [
      {
        version: '3.0.1',
        publishedAt: '2026-06-08T14:00:00Z',
        changelog: 'Updated banned-words list',
      },
      { version: '3.0.0', publishedAt: '2026-05-01T10:00:00Z', changelog: 'Rewrite from scratch' },
    ],
    tags: ['writing', 'voice', 'content'],
    categories: ['writing', 'productivity'],
    installUrl: 'https://registry.skillet.md/install/ada/writing-voice',
    signatureStatus: 'verified',
    security: {
      status: 'flagged',
      scannedAt: '2026-06-08T14:05:00Z',
      findingCount: 2,
      findings: [
        {
          category: 'exfil',
          confidence: 'low',
          file: 'scripts/sync.sh',
          line: 12,
          why: 'Reaches an external URL to fetch a word list. Common for tools that update their own data; read the call before installing.',
        },
        {
          category: 'risky-call',
          confidence: 'medium',
          file: 'scripts/sync.sh',
          line: 34,
          why: 'Interpolates a variable into a shell command. Safe if the input is trusted; worth a glance to confirm it cannot be influenced externally.',
        },
      ],
    },
    publishedAt: '2026-05-01T10:00:00Z',
    updatedAt: '2026-06-08T14:00:00Z',
  },
  {
    author: 'marco',
    slug: 'incident-comms',
    title: 'Incident Comms',
    description:
      'Status-page updates and customer emails during an outage, in the right tone. Keeps the message calm and honest.',
    installCount: 329,
    latestVersion: '1.2.0',
    versions: [
      {
        version: '1.2.0',
        publishedAt: '2026-05-25T16:00:00Z',
        changelog: 'Add postmortem template',
      },
      {
        version: '1.1.0',
        publishedAt: '2026-03-10T08:00:00Z',
        changelog: 'Initial public release',
      },
    ],
    tags: ['incident', 'ops', 'writing'],
    categories: ['ops', 'writing'],
    installUrl: 'https://registry.skillet.md/install/marco/incident-comms',
    signatureStatus: 'verified',
    publishedAt: '2026-03-10T08:00:00Z',
    updatedAt: '2026-05-25T16:00:00Z',
  },
  {
    author: 'skillethq',
    slug: 'docker-patterns',
    title: 'Docker Patterns',
    description:
      'Multi-stage Dockerfile best practices, .dockerignore templates, and Compose patterns for local dev parity.',
    installCount: 612,
    latestVersion: '2.1.0',
    versions: [
      { version: '2.1.0', publishedAt: '2026-06-11T07:00:00Z', changelog: 'BuildKit cache mounts' },
      { version: '2.0.0', publishedAt: '2026-04-01T00:00:00Z', changelog: 'Major rewrite' },
    ],
    tags: ['docker', 'devops', 'tooling'],
    categories: ['tooling', 'ops'],
    installUrl: 'https://registry.skillet.md/install/skillethq/docker-patterns',
    signatureStatus: 'verified',
    publishedAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-06-11T07:00:00Z',
  },
  {
    author: 'jules',
    slug: 'sql-style',
    title: 'SQL Style',
    description:
      'SQL formatting conventions: keyword casing, CTE structure, and how to name columns so queries read like prose.',
    installCount: 204,
    latestVersion: '1.0.2',
    versions: [
      {
        version: '1.0.2',
        publishedAt: '2026-06-09T10:00:00Z',
        changelog: 'Window function examples',
      },
      { version: '1.0.1', publishedAt: '2026-05-14T12:00:00Z', changelog: 'Fix CTE example' },
      { version: '1.0.0', publishedAt: '2026-04-30T00:00:00Z', changelog: 'Initial release' },
    ],
    tags: ['sql', 'style', 'data'],
    categories: ['tooling', 'code-quality'],
    installUrl: 'https://registry.skillet.md/install/jules/sql-style',
    signatureStatus: 'unverified',
    security: {
      status: 'flagged',
      scannedAt: '2026-06-09T10:05:00Z',
      findingCount: 1,
      findings: [
        {
          category: 'supply-chain',
          confidence: 'low',
          file: 'package.json',
          why: 'supply-chain: a dependency is fetched from an unverified source. Often a false positive for unused code paths; verify the version in use.',
        },
      ],
    },
    publishedAt: '2026-04-30T00:00:00Z',
    updatedAt: '2026-06-09T10:00:00Z',
  },
]

export const MOCK_AUTHORS: AuthorProfile[] = [
  {
    username: 'skillet',
    displayName: 'Skillet',
    bio: 'Official skills from the Skillet team.',
    avatarUrl: undefined,
    skills: MOCK_SKILLS.filter((s) => s.author === 'skillet'),
    totalInstalls: 0,
    joinedAt: '2026-06-13T00:00:00Z',
  },
  {
    username: 'skillethq',
    displayName: 'Skillet HQ',
    bio: 'Official skills from the Skillet team.',
    avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4',
    skills: MOCK_SKILLS.filter((s) => s.author === 'skillethq'),
    totalInstalls: MOCK_SKILLS.filter((s) => s.author === 'skillethq').reduce(
      (n, s) => n + s.installCount,
      0,
    ),
    joinedAt: '2026-01-01T00:00:00Z',
    verified: true,
    keyId: 'ed25519:abc123def456',
  },
]

// ---------------------------------------------------------------------------
// Live registry wiring (public read endpoints).
//
// The registry serves snake_case JSON; the web renders the camelCase Skill /
// AuthorProfile UI shapes (plus the snake_case SkillSummary directly on the
// catalog/directory). Flipping the whole site from mock to live is a
// config-only change: set REGISTRY_URL (and optionally NEXT_PUBLIC_REGISTRY_URL
// as legacy). When unset (local dev / CI) every accessor falls back to seed mocks.
// ---------------------------------------------------------------------------

/**
 * Thrown when a *configured* live registry can't be reached or answers non-OK.
 * The directory renders its error boundary instead of falling back to seed
 * skills: fabricated rows masquerading as real published skills is worse than
 * an honest "couldn't load" on a public page. The seed mock is only ever served
 * when no registry is configured at all (local dev / CI).
 */

/** Derive a public {@link SkillSummary} from a mock {@link Skill} row. */
function toSummary(skill: Skill): SkillSummary {
  return {
    author: skill.author,
    slug: skill.slug,
    skill_id: `${skill.author}:${skill.slug}`,
    title: skill.title,
    description: skill.description,
    visibility: skill.visibility ?? 'public',
    latest_hash: null,
    install_count: skill.installCount,
    created_at: Math.floor(new Date(skill.publishedAt).getTime() / 1000),
    signatureStatus: skill.signatureStatus ?? 'unverified',
    scanStatus: skill.security?.status,
    securityFindingCount: skill.security?.findingCount,
  }
}

export function buildMockCatalog({
  limit,
  offset,
  q,
}: {
  limit: number
  offset: number
  q: string
}): SkillCatalogResponse {
  const needle = q.toLowerCase()
  const matched = MOCK_SKILLS.filter((s) =>
    needle
      ? s.slug.toLowerCase().includes(needle) ||
        (s.description ?? '').toLowerCase().includes(needle)
      : true,
  ).sort(
    (a, b) =>
      b.installCount - a.installCount ||
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  )

  return {
    skills: matched.slice(offset, offset + limit).map(toSummary),
    total: matched.length,
    limit,
    offset,
  }
}
