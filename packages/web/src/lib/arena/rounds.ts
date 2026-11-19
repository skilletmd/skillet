/**
 * Arena rounds: two versions of a skill do the same real work, and people pick
 * the better result blind. This module is the whole data layer for the arena
 * preview, so every page reads from one place and a registry API can replace it
 * later without touching the components.
 *
 * Everything here is EXAMPLE DATA. The pages say so in a banner. The vote pairs
 * use real before/after screenshots of eight IMD launch sites (the design-critic
 * work), standing in for the two versions' output.
 *
 * No React and no Node imports: proxy.ts imports ARENA_ROUND_SLUGS from here to
 * decide real 404s before render.
 */

export type ArenaStatus = 'open' | 'upcoming' | 'closed'
export type Side = 'A' | 'B'
export type Pick = Side | 'tie'
export type JuryKind = 'jury' | 'holders' | 'public' | 'machines'

export interface ArenaVersion {
  side: Side
  /** What this version is in the round: "Current", "Challenger", "Before the edit". */
  role: string
  name: string
  version: string
  author: string
  /** Short bundle hash, frozen when the round locks. */
  hash: string
  /** Skill page, when the version is published on Skillet. */
  href?: string
  note: string
}

export interface ArenaJury {
  kind: JuryKind
  name: string
  who: string
  /** What the jury's votes do. Only the jury decides. */
  counts: 'Decides' | 'Cross-check' | 'Shown only' | 'Evidence only'
  voters: number
  /** Expected voters, when the jury is a fixed panel. */
  of?: number
  /** Closed rounds: how often this group picked what the jury picked, in %. */
  agreement?: number
  /** Closed rounds, public only: share that picked version B, in %. */
  shareB?: number
  note?: string
}

export interface PairShot {
  phone: string
  desktop: string
}

export interface ArenaPair {
  n: number
  site: string
  brief: string
  /** Which version this voter sees on the left. Sides are shuffled per voter. */
  left: Side
  shots?: Record<Side, PairShot>
  /** Closed rounds: each group's pick for this pair. */
  picks?: Partial<Record<JuryKind, Pick>>
}

export interface ArenaResult {
  verdict: 'won' | 'lost' | 'no-call'
  /** Pairs the jury gave to B, to A, and called a tie. */
  b: number
  a: number
  ties: number
  /** How often people on the jury agreed with each other, in %. The bar a
   *  machine panel has to reach before its votes count. */
  peopleAgreement: number
  headline: string
  summary: string
  next: string
}

export interface ArenaRound {
  slug: string
  network: 'IMD'
  title: string
  area: string
  question: string
  judgedBy: 'people' | 'planted-bugs'
  status: ArenaStatus
  /** Display dates. Absolute on purpose: server components can't read the clock. */
  dates: { locks: string; closes?: string; closed?: string }
  draw: { count: number; from: string; block?: number }
  versions: [ArenaVersion, ArenaVersion]
  juries: ArenaJury[]
  /** Pairs in the round; the preview may show fewer. */
  pairCount: number
  pairs: ArenaPair[]
  result?: ArenaResult
  /** Versions entered this round, winners and losers. One per author. */
  entries: number
  /** Hard-check rounds: what decides instead of a vote. */
  judge?: string
}

const shot = (site: string, take: 'before' | 'after'): PairShot => ({
  phone: `/arena-demo/${site}-${take}-390.webp`,
  desktop: `/arena-demo/${site}-${take}-1440.webp`,
})

/** A as the plain review left the site, B as design-critic left it. */
const shots = (site: string): Record<Side, PairShot> => ({
  A: shot(site, 'before'),
  B: shot(site, 'after'),
})

const designReview: ArenaRound = {
  slug: 'design-review',
  network: 'IMD',
  title: 'Design review',
  area: 'Websites',
  question: "Does design-critic's review beat a plain review?",
  judgedBy: 'people',
  status: 'open',
  dates: { locks: 'Oct 7', closes: 'Oct 10' },
  draw: { count: 48, from: "IMD's 169 live launch sites", block: 26_140_000 },
  versions: [
    {
      side: 'A',
      role: 'Current',
      name: 'plain-review',
      version: 'v1',
      author: 'identity-md',
      hash: '3e91c4a0',
      note: 'A plain review the maintainer wrote.',
    },
    {
      side: 'B',
      role: 'Challenger',
      name: 'design-critic',
      version: 'v3',
      author: 'taylor',
      hash: '8a07d11f',
      note: 'Reads the brief, then checks the site at phone and desktop width.',
    },
  ],
  juries: [
    {
      kind: 'jury',
      name: 'Jury',
      who: '7 people the maintainer picked',
      counts: 'Decides',
      voters: 3,
      of: 7,
    },
    {
      kind: 'holders',
      name: 'Holders',
      who: 'IMD seat holders, one vote per wallet',
      counts: 'Cross-check',
      voters: 128,
    },
    {
      kind: 'public',
      name: 'Public',
      who: 'Anyone signed in to Skillet',
      counts: 'Shown only',
      voters: 640,
    },
    {
      kind: 'machines',
      name: 'Machines',
      who: '5 IMD machines, two model families',
      counts: 'Evidence only',
      voters: 5,
      of: 5,
    },
  ],
  pairCount: 48,
  entries: 2,
  pairs: [
    {
      n: 1,
      site: 'Pepe Village',
      brief:
        'A small, playable 3D village game with Pepe characters. Visual quality first: cartoon 3D, pastel buildings, a pond.',
      left: 'B',
      shots: shots('pepe-village-demo'),
    },
    {
      n: 2,
      site: 'Paid vote',
      brief:
        'A very simple site: sign in with a wallet, vote, see the top 3 voters. ASCII style, no extra words.',
      left: 'A',
      shots: shots('paid-vote-on-the-record'),
    },
    {
      n: 3,
      site: 'Flappy Pepe',
      brief:
        'Flappy Bird, but the bird is a Pepe. Players enter a username, and every run goes on a leaderboard.',
      left: 'A',
      shots: shots('flappy-pepe-one-more-try'),
    },
    {
      n: 4,
      site: 'Swarm hackathon',
      brief:
        "A just-for-fun 14-day community hackathon. Say plainly that it isn't the official IMD hackathon.",
      left: 'B',
      shots: shots('hack'),
    },
    {
      n: 5,
      site: 'Requester cookbook',
      brief:
        'A cookbook for people and agents who pay the IMD swarm: getting started, one recipe per action, every error code.',
      left: 'B',
      shots: shots('imd-requester-cookbook'),
    },
    {
      n: 6,
      site: "Pepe's Lucky Club",
      brief:
        'A giant Pepe prize machine with a crowd of small Pepes. The player Pepe presses the button when you hit play.',
      left: 'A',
      shots: shots('pepe-s-lucky-club-the-good-vibes'),
    },
    {
      n: 7,
      site: 'Signal',
      brief:
        'The best posts and articles about IMD. Green background, with Pepes armed with AI working together as a video.',
      left: 'A',
      shots: shots('signal-the-identity-md-reading-r'),
    },
    {
      n: 8,
      site: 'The Swamp',
      brief:
        'The best posts and articles about IMD, themed as Pepes armed with AI, on a green background.',
      left: 'B',
      shots: shots('the-swamp-the-identity-md-readin'),
    },
  ],
}

const frontendEdit: ArenaRound = {
  slug: 'frontend-edit',
  network: 'IMD',
  title: 'Frontend edit',
  area: 'Dapp frontends',
  question: 'Did the last edit to frontend-for-contract help?',
  judgedBy: 'people',
  status: 'closed',
  dates: { locks: 'Sep 30', closed: 'Oct 3' },
  draw: { count: 48, from: "IMD's live launch frontends", block: 26_090_000 },
  versions: [
    {
      side: 'A',
      role: 'Before the edit',
      name: 'frontend-for-contract',
      version: 'v7',
      author: 'identity-md',
      hash: 'c2b84e17',
      href: '/identity-md/frontend-for-contract',
      note: 'The version before the last change.',
    },
    {
      side: 'B',
      role: 'After the edit',
      name: 'frontend-for-contract',
      version: 'v8',
      author: 'identity-md',
      hash: '5d0fa932',
      href: '/identity-md/frontend-for-contract',
      note: 'Adds a rule for wallet states after a failed launch.',
    },
  ],
  juries: [
    {
      kind: 'jury',
      name: 'Jury',
      who: '7 people the maintainer picked',
      counts: 'Decides',
      voters: 7,
      of: 7,
    },
    {
      kind: 'holders',
      name: 'Holders',
      who: 'IMD seat holders, one vote per wallet',
      counts: 'Cross-check',
      voters: 212,
      agreement: 81,
    },
    {
      kind: 'public',
      name: 'Public',
      who: 'Anyone signed in to Skillet',
      counts: 'Shown only',
      voters: 1240,
      shareB: 63,
    },
    {
      kind: 'machines',
      name: 'Machines',
      who: '5 IMD machines, two model families',
      counts: 'Evidence only',
      voters: 5,
      of: 5,
      agreement: 74,
      note: 'Below the 79% people reached with each other, so not trusted for frontends yet.',
    },
  ],
  pairCount: 48,
  entries: 2,
  result: {
    verdict: 'no-call',
    b: 25,
    a: 15,
    ties: 8,
    peopleAgreement: 79,
    headline: 'No call',
    summary: 'v8 won 25 pairs to 15. With 40 pairs decided, it needed 26 to rule out luck.',
    next: 'A narrow edge needs more pairs. The next round doubles the briefs.',
  },
  pairs: [
    {
      n: 1,
      site: 'ETH Pulse',
      brief: 'Ethereum at a glance.',
      left: 'A',
      picks: { jury: 'B', holders: 'B', machines: 'B', public: 'B' },
    },
    {
      n: 2,
      site: 'Counter',
      brief: 'A counter you already know.',
      left: 'B',
      picks: { jury: 'A', holders: 'A', machines: 'B', public: 'A' },
    },
    {
      n: 3,
      site: 'Genesis',
      brief: 'A genesis mint page.',
      left: 'A',
      picks: { jury: 'B', holders: 'B', machines: 'B', public: 'B' },
    },
    {
      n: 4,
      site: 'Tower stack',
      brief: 'A tower stacking game.',
      left: 'B',
      picks: { jury: 'tie', holders: 'B', machines: 'A', public: 'B' },
    },
    {
      n: 5,
      site: 'Comp protocol',
      brief: 'A rewards protocol dashboard.',
      left: 'A',
      picks: { jury: 'B', holders: 'B', machines: 'B', public: 'B' },
    },
    {
      n: 6,
      site: 'Pepe Collective',
      brief: 'Small frogs, big plans.',
      left: 'B',
      picks: { jury: 'A', holders: 'A', machines: 'A', public: 'B' },
    },
    {
      n: 7,
      site: 'Surf Surf',
      brief: 'Catch a wave, have a say.',
      left: 'A',
      picks: { jury: 'B', holders: 'tie', machines: 'B', public: 'B' },
    },
    {
      n: 8,
      site: 'HL Radar',
      brief: 'Hyperliquid funding rates.',
      left: 'B',
      picks: { jury: 'B', holders: 'B', machines: 'A', public: 'A' },
    },
    {
      n: 9,
      site: 'Rye Rise',
      brief: 'A neighborhood bakery.',
      left: 'A',
      picks: { jury: 'A', holders: 'A', machines: 'A', public: 'A' },
    },
    {
      n: 10,
      site: 'Swarm Alpha',
      brief: 'What the swarm is building.',
      left: 'B',
      picks: { jury: 'B', holders: 'B', machines: 'B', public: 'B' },
    },
    {
      n: 11,
      site: 'Grid',
      brief: 'A grid game.',
      left: 'A',
      picks: { jury: 'tie', holders: 'tie', machines: 'B', public: 'A' },
    },
    {
      n: 12,
      site: 'Cookbook, Chinese',
      brief: 'The requester cookbook in Chinese.',
      left: 'B',
      picks: { jury: 'B', holders: 'A', machines: 'B', public: 'B' },
    },
  ],
}

const auditPanel: ArenaRound = {
  slug: 'audit-panel',
  network: 'IMD',
  title: 'Audit panel',
  area: 'Contracts',
  question: "Does Pashov's latest auditor find more planted bugs?",
  judgedBy: 'planted-bugs',
  status: 'upcoming',
  dates: { locks: 'Oct 12' },
  draw: { count: 20, from: 'contracts written for this round, never deployed' },
  versions: [
    {
      side: 'A',
      role: 'Current',
      name: 'audit-panel',
      version: 'v4',
      author: 'identity-md',
      hash: '91ce0b3a',
      note: "Four specialists and a judge, as IMD's launches run today.",
    },
    {
      side: 'B',
      role: 'Challenger',
      name: 'audit-panel',
      version: 'v5',
      author: 'identity-md',
      hash: 'e47f2c05',
      note: "Swaps in Pashov's latest auditor as a specialist.",
    },
  ],
  juries: [],
  judge:
    'Each contract hides 3 planted bugs. The version that finds more of them, with no more false alarms, wins. Nobody votes.',
  pairCount: 20,
  pairs: [],
  entries: 2,
}

export const ARENA_ROUNDS: readonly ArenaRound[] = [designReview, auditPanel, frontendEdit]

export const ARENA_ROUND_SLUGS: ReadonlySet<string> = new Set(ARENA_ROUNDS.map((r) => r.slug))

export function findRound(slug: string): ArenaRound | null {
  return ARENA_ROUNDS.find((r) => r.slug === slug) ?? null
}

export function roundHref(slug: string): string {
  return `/arena/${slug}`
}

export function voteHref(slug: string): string {
  return `/arena/${slug}/vote`
}

/**
 * The jury's bar: the fewest pairs B must win, out of the pairs the jury
 * decided (ties left out), for luck to explain it less than 5% of the time.
 * Exact one-sided sign test, so the page never shows a hand-typed threshold.
 */
export function neededFor(decided: number): number {
  const pmf: number[] = []
  let p = Math.pow(0.5, decided)
  for (let k = 0; k <= decided; k++) {
    pmf.push(p)
    p = (p * (decided - k)) / (k + 1)
  }
  let tail = 0
  for (let k = decided; k >= 0; k--) {
    tail += pmf[k]!
    if (tail > 0.05) return k + 1
  }
  return 0
}

/** The bar at the decided-pair counts a 48-brief round usually lands on. */
export const ARENA_BAR: ReadonlyArray<{ decided: number; needed: number }> = [
  48, 44, 40, 36, 32,
].map((decided) => ({ decided, needed: neededFor(decided) }))

/** Arena rounds a skill took part in, for its page. Matched by author + name. */
export function roundsForSkill(author: string, slug: string): ArenaRound[] {
  return ARENA_ROUNDS.filter((r) => r.versions.some((v) => v.author === author && v.name === slug))
}
