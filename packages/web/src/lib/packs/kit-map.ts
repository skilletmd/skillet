// The kit framework (sections of work, each with job slots) and Taylor's real
// skills placed on it. Runs are Skill tool calls in his Claude Code transcripts,
// Oct 13 to Nov 12, 2026. Which slot each skill sits in is my sort, from each
// skill's own description; anything that is not a job lands in Other.

import { PACKS } from './data'

export interface MapSkill {
  name: string
  /** Who made it, as shown under the name. */
  by: string
  avatarUrl: string | null
  runs: number
}

export interface MapSlot {
  job: string
  skills: MapSkill[]
  /** Holds as many as you like (one per platform or tool). */
  many?: boolean
}

export interface MapSection {
  id: string
  name: string
  color: string
  ink: string
  slots: MapSlot[]
}

const TAYLOR = 'https://pub-5793f7ad27084cca99209bc8f7274036.r2.dev/729d9894e2d7258164f69e4ffe2035b92a188653017c00c8ff95c6c4c0ff0980'
const ANTHROPIC = 'https://avatars.githubusercontent.com/u/76263028?v=4'
const EVERY = 'https://github.com/EveryInc.png'
const COREY = 'https://avatars.githubusercontent.com/u/34802794?v=4'

const mine = (name: string, runs: number): MapSkill => ({ name, by: 'Taylor', avatarUrl: TAYLOR, runs })
const anthropic = (name: string, runs: number): MapSkill => ({ name, by: 'Anthropic', avatarUrl: ANTHROPIC, runs })
const every = (name: string, runs: number): MapSkill => ({ name, by: 'Every', avatarUrl: EVERY, runs })
const other = (name: string, by: string, runs: number): MapSkill => ({ name, by, avatarUrl: null, runs })
const slot = (job: string, ...skills: MapSkill[]): MapSlot => ({ job, skills })

export const TAYLOR_KIT: MapSection[] = [
  {
    id: 'writing',
    name: 'Writing',
    color: '#2f57e8',
    ink: '#ffffff',
    slots: [
      slot('Short posts', mine('Founder Tweet Writer', 13)),
      slot('Long reads', mine('GTM Story', 2)),
      slot('Emails'),
      slot('Editing', mine('House Style', 9), every('Noslop', 1)),
      slot('Docs'),
      slot('Scripts'),
    ],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    color: PACKS[0].color,
    ink: '#ffffff',
    slots: [
      slot('Landing pages'),
      slot('Ads'),
      slot('Newsletters'),
      slot('Launches'),
      slot('SEO'),
      slot('Social', mine('Thread', 3)),
    ],
  },
  {
    id: 'sales',
    name: 'Sales',
    color: '#0c7f50',
    ink: '#ffffff',
    slots: [
      slot('Prospecting', mine('Event Recon', 1)),
      slot('Cold outreach'),
      slot('Follow-ups'),
      slot('Call notes'),
      slot('Proposals'),
    ],
  },
  {
    id: 'design',
    name: 'Design',
    color: '#5b3df5',
    ink: '#ffffff',
    slots: [
      slot('Interfaces', mine('GTM UI', 25)),
      slot('Design reviews', mine('Screenshot Critique', 2)),
      slot('Visual system', mine('Hairy Styles', 2)),
      slot('Images', mine('Stageshow', 2)),
      slot('Motion', other('Interface Craft', 'Josh Puckett', 0), other('Apple Design', 'Emil Kowalski', 0)),
      slot('Decks', anthropic('PPTX', 0)),
    ],
  },
  {
    id: 'development',
    name: 'Development',
    color: '#0b7285',
    ink: '#ffffff',
    slots: [
      slot('Code review', anthropic('Code Review', 2), every('Code Review', 0)),
      slot('Tests', every('Test Browser', 0)),
      slot('Debugging', every('Debug', 0)),
      slot('Pull requests', mine('World Class PR', 11), every('Commit Push PR', 0), mine('PR Handoff', 1)),
      slot('Specs', every('Plan', 0)),
      slot('Security', anthropic('Security Review', 0)),
      {
        job: 'Platforms',
        many: true,
        skills: [
          anthropic('Claude API', 3),
          other('Wrangler', 'Cloudflare', 1),
          other('CF CLI', 'Cloudflare', 1),
          other('Durable Objects', 'Cloudflare', 1),
          other('Next.js on Cloudflare', 'Cloudflare', 1),
          other('Web Perf', 'Cloudflare', 1),
          other('Remotion', 'Remotion', 1),
          other('Cloudflare', 'Cloudflare', 0),
          other('Workers Best Practices', 'Cloudflare', 0),
          other('Agents SDK', 'Cloudflare', 0),
          other('Sandbox SDK', 'Cloudflare', 0),
          other('Sandbox Next', 'Cloudflare', 0),
          other('Sandbox Stable', 'Cloudflare', 0),
          other('Sandbox Migrate', 'Cloudflare', 0),
          other('Turnstile', 'Cloudflare', 0),
          other('ast-grep', 'ast-grep', 0),
        ],
      },
    ],
  },
  {
    id: 'research',
    name: 'Research',
    color: '#b4417a',
    ink: '#ffffff',
    slots: [
      slot('Web research', anthropic('Deep Research', 0)),
      slot('Data analysis', other('Dataviz', 'Built in', 2)),
      slot('Summaries'),
      slot('Competitors'),
      slot('Reports'),
    ],
  },
  {
    id: 'business',
    name: 'Business',
    color: '#f5b11a',
    ink: '#1b1609',
    slots: [
      slot('Strategy', mine('GTM Product', 18)),
      slot('Planning'),
      slot('Meetings'),
      slot('Hiring'),
      slot('Finance', mine('Refresh Books', 0)),
      slot('Docs and PDFs', anthropic('Docs', 2), anthropic('DOCX', 0), anthropic('PDF', 0)),
      slot('Spreadsheets', anthropic('XLSX', 0)),
    ],
  },
  {
    id: 'media',
    name: 'Media',
    color: '#c9356d',
    ink: '#ffffff',
    slots: [slot('Video', mine('GTM Film', 3)), slot('Music and audio', mine('Video Score', 7)), slot('Podcasts'), slot('Thumbnails')],
  },
]

/** Not jobs: things the AI operates. Each holds as many as you like. */
export const TAYLOR_TOOLS: MapSection = {
  id: 'tools',
  name: 'Tools',
  color: '#3f3b36',
  ink: '#ffffff',
  slots: [
    {
      job: 'Browser',
      many: true,
      skills: [
        anthropic('Claude in Chrome', 30),
        other('Agent Browser', 'Vercel Labs', 10),
        anthropic('Chrome Browser', 0),
        anthropic('Built-in Browser', 0),
        other('Browser', 'Superset', 0),
      ],
    },
    { job: 'Computer', many: true, skills: [anthropic('Computer Use', 3)] },
  ],
}

/** "Take" for Marketing: Corey Haines' real skills for each Marketing slot. */
export const TAKE_MARKETING: Record<string, MapSkill> = {
  'Landing pages': { name: 'Copywriting', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  Ads: { name: 'Ad Creative', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  Newsletters: { name: 'Emails', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  Launches: { name: 'Launch', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  SEO: { name: 'SEO Audit', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  Social: { name: 'Social', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
}

/** Where a pasted skill lands, read from words in its link. */
export function sortSkillLink(link: string): { section: string; job: string } {
  const l = link.toLowerCase()
  const rules: [RegExp, string, string][] = [
    [/cold|outreach|prospect/, 'sales', 'Cold outreach'],
    [/email|newsletter/, 'writing', 'Emails'],
    [/seo/, 'marketing', 'SEO'],
    [/\bads?\b|ad-creative|advert/, 'marketing', 'Ads'],
    [/landing|copywrit/, 'marketing', 'Landing pages'],
    [/test|tdd/, 'development', 'Tests'],
    [/debug|bug/, 'development', 'Debugging'],
    [/review/, 'development', 'Code review'],
    [/deck|slide|pptx/, 'design', 'Decks'],
    [/podcast/, 'media', 'Podcasts'],
    [/thumbnail/, 'media', 'Thumbnails'],
    [/meeting|notes/, 'business', 'Meetings'],
    [/summar/, 'research', 'Summaries'],
    [/script/, 'writing', 'Scripts'],
  ]
  for (const [re, section, job] of rules) if (re.test(l)) return { section, job }
  return { section: 'writing', job: 'Docs' }
}

/** Real skills that can fill an empty slot, by job. One each for now. */
export const PICKS: Record<string, MapSkill> = {
  ...TAKE_MARKETING,
  Emails: { name: 'Emails', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  'Cold outreach': { name: 'Cold Email', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  Competitors: { name: 'Competitors', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  Docs: { name: 'Doc Coauthoring', by: 'Anthropic', avatarUrl: ANTHROPIC, runs: 0 },
}
