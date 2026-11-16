// The kit framework (sections of work, each with job slots) and Taylor's real
// skills placed on it. The sections and jobs, their order and their names come
// from @skillet/protocol/jobs, keyed by job id; the colours are the web's.
// Runs are Skill tool calls in his Claude Code transcripts, Oct 13 to Nov 12,
// 2026. Which slot each skill sits in is my sort, from each skill's own
// description; anything that is not a job lands in Other.

import { JOB_SECTIONS, TOOLS_SECTION, type Job, type JobId, type JobSection, type SectionId } from '@skillet/protocol/jobs'
import { PACKS } from './data'

export interface MapSkill {
  name: string
  /** Who made it, as shown under the name. */
  by: string
  avatarUrl: string | null
  runs: number
}

/** A job on the map (its id, name and `many` from protocol) and the skills in it. */
export interface MapSlot extends Job {
  skills: MapSkill[]
}

export interface MapSection {
  id: SectionId
  name: string
  color: string
  ink: string
  slots: MapSlot[]
}

/** Each section's band colour and the ink on it. */
export const SECTION_HUES: Record<SectionId, { color: string; ink: string }> = {
  writing: { color: '#2f57e8', ink: '#ffffff' },
  marketing: { color: PACKS[0].color, ink: '#ffffff' },
  sales: { color: '#0c7f50', ink: '#ffffff' },
  design: { color: '#5b3df5', ink: '#ffffff' },
  development: { color: '#0b7285', ink: '#ffffff' },
  research: { color: '#b4417a', ink: '#ffffff' },
  business: { color: '#f5b11a', ink: '#1b1609' },
  media: { color: '#c9356d', ink: '#ffffff' },
  tools: { color: '#3f3b36', ink: '#ffffff' },
}

const TAYLOR = 'https://pub-5793f7ad27084cca99209bc8f7274036.r2.dev/729d9894e2d7258164f69e4ffe2035b92a188653017c00c8ff95c6c4c0ff0980'
const ANTHROPIC = 'https://avatars.githubusercontent.com/u/76263028?v=4'
const EVERY = 'https://github.com/EveryInc.png'
const COREY = 'https://avatars.githubusercontent.com/u/34802794?v=4'

const mine = (name: string, runs: number): MapSkill => ({ name, by: 'Taylor', avatarUrl: TAYLOR, runs })
const anthropic = (name: string, runs: number): MapSkill => ({ name, by: 'Anthropic', avatarUrl: ANTHROPIC, runs })
const every = (name: string, runs: number): MapSkill => ({ name, by: 'Every', avatarUrl: EVERY, runs })
const other = (name: string, by: string, runs: number): MapSkill => ({ name, by, avatarUrl: null, runs })

/** Taylor's skills by the job they sit in. A job not listed here is empty. */
const TAYLOR_SKILLS: Partial<Record<JobId, MapSkill[]>> = {
  'writing.short-posts': [mine('Founder Tweet Writer', 13)],
  'writing.long-reads': [mine('GTM Story', 2)],
  'writing.editing': [mine('House Style', 9), every('Noslop', 1)],
  'marketing.social': [mine('Thread', 3)],
  'sales.prospecting': [mine('Event Recon', 1)],
  'design.interfaces': [mine('GTM UI', 25)],
  'design.design-reviews': [mine('Screenshot Critique', 2)],
  'design.visual-system': [mine('Hairy Styles', 2)],
  'design.images': [mine('Stageshow', 2)],
  'design.motion': [other('Interface Craft', 'Josh Puckett', 0), other('Apple Design', 'Emil Kowalski', 0)],
  'design.decks': [anthropic('PPTX', 0)],
  'development.code-review': [anthropic('Code Review', 2), every('Code Review', 0)],
  'development.tests': [every('Test Browser', 0)],
  'development.debugging': [every('Debug', 0)],
  'development.pull-requests': [mine('World Class PR', 11), every('Commit Push PR', 0), mine('PR Handoff', 1)],
  'development.specs': [every('Plan', 0)],
  'development.security': [anthropic('Security Review', 0)],
  'development.platforms': [
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
  'research.web-research': [anthropic('Deep Research', 0)],
  'research.data-analysis': [other('Dataviz', 'Built in', 2)],
  'business.strategy': [mine('GTM Product', 18)],
  'business.finance': [mine('Refresh Books', 0)],
  'business.docs-and-pdfs': [anthropic('Docs', 2), anthropic('DOCX', 0), anthropic('PDF', 0)],
  'business.spreadsheets': [anthropic('XLSX', 0)],
  'media.video': [mine('GTM Film', 3)],
  'media.music-and-audio': [mine('Video Score', 7)],
  'tools.browser': [
    anthropic('Claude in Chrome', 30),
    other('Agent Browser', 'Vercel Labs', 10),
    anthropic('Chrome Browser', 0),
    anthropic('Built-in Browser', 0),
    other('Browser', 'Superset', 0),
  ],
  'tools.computer': [anthropic('Computer Use', 3)],
}

const placed = (sec: JobSection): MapSection => ({
  id: sec.id,
  name: sec.name,
  ...SECTION_HUES[sec.id],
  slots: sec.jobs.map((job) => ({ ...job, skills: TAYLOR_SKILLS[job.id] ?? [] })),
})

export const TAYLOR_KIT: MapSection[] = JOB_SECTIONS.map(placed)

/** Not jobs: things the AI operates. Each holds as many as you like. */
export const TAYLOR_TOOLS: MapSection = placed(TOOLS_SECTION)

/** "Take" for Marketing: Corey Haines' real skills for each Marketing slot. */
export const TAKE_MARKETING: Partial<Record<JobId, MapSkill>> = {
  'marketing.landing-pages': { name: 'Copywriting', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  'marketing.ads': { name: 'Ad Creative', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  'marketing.newsletters': { name: 'Emails', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  'marketing.launches': { name: 'Launch', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  'marketing.seo': { name: 'SEO Audit', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  'marketing.social': { name: 'Social', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
}

/** Where a pasted skill lands, read from words in its link. */
export function sortSkillLink(link: string): JobId {
  const l = link.toLowerCase()
  const rules: [RegExp, JobId][] = [
    [/cold|outreach|prospect/, 'sales.cold-outreach'],
    [/email|newsletter/, 'writing.emails'],
    [/seo/, 'marketing.seo'],
    [/\bads?\b|ad-creative|advert/, 'marketing.ads'],
    [/landing|copywrit/, 'marketing.landing-pages'],
    [/test|tdd/, 'development.tests'],
    [/debug|bug/, 'development.debugging'],
    [/review/, 'development.code-review'],
    [/deck|slide|pptx/, 'design.decks'],
    [/podcast/, 'media.podcasts'],
    [/thumbnail/, 'media.thumbnails'],
    [/meeting|notes/, 'business.meetings'],
    [/summar/, 'research.summaries'],
    [/script/, 'writing.scripts'],
  ]
  for (const [re, id] of rules) if (re.test(l)) return id
  return 'writing.docs'
}

/** Real skills that can fill an empty slot, by job. One each for now. */
export const PICKS: Partial<Record<JobId, MapSkill>> = {
  ...TAKE_MARKETING,
  'writing.emails': { name: 'Emails', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  'sales.cold-outreach': { name: 'Cold Email', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  'research.competitors': { name: 'Competitors', by: 'Corey Haines', avatarUrl: COREY, runs: 0 },
  'writing.docs': { name: 'Doc Coauthoring', by: 'Anthropic', avatarUrl: ANTHROPIC, runs: 0 },
}
