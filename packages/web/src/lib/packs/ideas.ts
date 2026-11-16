// Data for the kit-idea renders (/packs/ideas). Every skill is real and public;
// descriptions are shortened from each skill's own SKILL.md. Star counts are
// each repo's GitHub stars on 2026-11-12. Samples come from ./data.ts.

import { PACKS } from './data'
import type { PackSkill } from './types'

interface Maker {
  name: string
  handle: string
  avatarUrl: string
  repo: string
  stars: string
}

const COREY: Maker = {
  name: 'Corey Haines',
  handle: 'coreyhaines31',
  avatarUrl: 'https://avatars.githubusercontent.com/u/34802794?v=4',
  repo: 'coreyhaines31/marketingskills',
  stars: '60K',
}
const ANTHROPIC: Maker = {
  name: 'Anthropic',
  handle: 'anthropics',
  avatarUrl: 'https://avatars.githubusercontent.com/u/76263028?v=4',
  repo: 'anthropics/skills',
  stars: '194K',
}
const EMIL: Maker = {
  name: 'Emil Kowalski',
  handle: 'emilkowalski',
  avatarUrl: 'https://avatars.githubusercontent.com/u/36730035?v=4',
  repo: 'emilkowalski/skills',
  stars: '56K',
}
const MATT: Maker = {
  name: 'Matt Pocock',
  handle: 'mattpocock',
  avatarUrl: 'https://avatars.githubusercontent.com/u/28293365?v=4',
  repo: 'mattpocock/skills',
  stars: '323K',
}
const JAKUB: Maker = {
  name: 'Jakub Krehel',
  handle: 'jakubkrehel',
  avatarUrl: 'https://avatars.githubusercontent.com/u/87530089?v=4',
  repo: 'jakubkrehel/skills',
  stars: '12K',
}

const skill = (maker: Maker, path: string, name: string, description: string): PackSkill => ({
  slug: path.split('/').pop() ?? path,
  name,
  maker: maker.name,
  makerHandle: maker.handle,
  avatarUrl: maker.avatarUrl,
  sourceUrl: `https://github.com/${maker.repo}/blob/main/skills/${path}/SKILL.md`,
  description,
})

const marketing = PACKS[0]
const sampleOf = (job: string): string | undefined => {
  const s = marketing.slots.find((slot) => slot.job === job)?.sample
  if (!s) return undefined
  if (s.kind === 'post') return s.text.split('\n')[0]
  if (s.kind === 'email') return s.subject
  return s.headline
}

export interface Job {
  id: string
  label: string
  skill: PackSkill
  /** A line the skill really wrote, when there is one; otherwise the card shows what it does. */
  sample?: string
}

export const JOBS: Job[] = [
  { id: 'tweets', label: 'Tweets', skill: marketing.slots[0].skill, sample: sampleOf('Short posts') },
  { id: 'newsletters', label: 'Newsletters', skill: marketing.slots[1].skill, sample: sampleOf('Newsletter') },
  { id: 'cold-emails', label: 'Cold emails', skill: marketing.slots[2].skill, sample: sampleOf('Cold email') },
  { id: 'landing-pages', label: 'Landing pages', skill: marketing.slots[3].skill, sample: sampleOf('Landing page') },
  { id: 'ads', label: 'Ads', skill: marketing.slots[4].skill, sample: sampleOf('Ads') },
  { id: 'decks', label: 'Decks', skill: skill(ANTHROPIC, 'pptx', 'PPTX', 'Builds, reads and edits PowerPoint decks.') },
  { id: 'docs', label: 'Docs', skill: skill(ANTHROPIC, 'docx', 'DOCX', 'Writes, reads and edits Word documents.') },
  { id: 'spreadsheets', label: 'Spreadsheets', skill: skill(ANTHROPIC, 'xlsx', 'XLSX', 'Opens, fixes and builds spreadsheets.') },
  { id: 'pdfs', label: 'PDFs', skill: skill(ANTHROPIC, 'pdf', 'PDF', 'Reads, merges, splits and fills PDFs.') },
  {
    id: 'web-design',
    label: 'Web design',
    skill: skill(ANTHROPIC, 'frontend-design', 'Frontend Design', "Gives a page a look that doesn't read as a template."),
  },
  {
    id: 'animation',
    label: 'Animation',
    skill: skill(EMIL, 'animate', 'Animate', 'Builds an animation in the order that decides whether it feels right.'),
  },
  {
    id: 'ui-reviews',
    label: 'UI reviews',
    skill: skill(JAKUB, 'interface-review', 'Interface Review', 'Finds the interface problems a change introduced.'),
  },
  {
    id: 'code-reviews',
    label: 'Code reviews',
    skill: skill(MATT, 'engineering/code-review', 'Code Review', "Checks a change against the repo's standards and its spec."),
  },
  { id: 'tests', label: 'Tests', skill: skill(MATT, 'engineering/tdd', 'TDD', 'Builds features and fixes bugs test-first.') },
  { id: 'pr-bodies', label: 'PR descriptions', skill: skill(MATT, 'engineering/pr', 'PR', 'Writes the PR body.') },
  {
    id: 'bug-hunts',
    label: 'Bug hunts',
    skill: skill(MATT, 'engineering/diagnosing-bugs', 'Diagnosing Bugs', 'A loop for hard bugs and slow code.'),
  },
]

export const jobById = (id: string) => JOBS.find((j) => j.id === id)

/** One tap fills the jobs a role usually hands to AI. These are the packs. */
export const PRESETS = [
  { id: 'marketer', label: 'Marketer', color: PACKS[0].color, ink: PACKS[0].ink, jobs: ['tweets', 'newsletters', 'cold-emails', 'landing-pages', 'ads'] },
  { id: 'founder', label: 'Founder', color: PACKS[3].color, ink: PACKS[3].ink, jobs: ['decks', 'docs', 'spreadsheets', 'tweets', 'cold-emails'] },
  { id: 'designer', label: 'Designer', color: PACKS[1].color, ink: PACKS[1].ink, jobs: ['web-design', 'animation', 'ui-reviews', 'landing-pages'] },
  { id: 'engineer', label: 'Engineer', color: PACKS[2].color, ink: PACKS[2].ink, jobs: ['code-reviews', 'tests', 'pr-bodies', 'bug-hunts'] },
]

export interface PersonKit {
  maker: Maker
  name: string
  color: string
  ink: string
  slots: { job: string; skill: PackSkill }[]
}

export const PEOPLE_KITS: PersonKit[] = [
  {
    maker: COREY,
    name: 'Marketing',
    color: PACKS[0].color,
    ink: PACKS[0].ink,
    slots: marketing.slots.map((s) => ({ job: s.job, skill: s.skill })),
  },
  {
    maker: MATT,
    name: 'Engineering',
    color: PACKS[2].color,
    ink: PACKS[2].ink,
    slots: ['code-reviews', 'tests', 'pr-bodies', 'bug-hunts'].map((id) => ({ job: jobById(id)!.label, skill: jobById(id)!.skill })),
  },
  {
    maker: ANTHROPIC,
    name: 'Documents',
    color: PACKS[3].color,
    ink: PACKS[3].ink,
    slots: ['decks', 'docs', 'spreadsheets', 'pdfs'].map((id) => ({ job: jobById(id)!.label, skill: jobById(id)!.skill })),
  },
  {
    maker: EMIL,
    name: 'Motion',
    color: '#5b3df5',
    ink: '#ffffff',
    slots: [
      { job: 'Animation', skill: jobById('animation')!.skill },
      { job: 'Gestures', skill: skill(EMIL, 'gestures', 'Gestures', 'Drag, swipe and sheet interactions that track the finger.') },
      { job: 'Apple feel', skill: skill(EMIL, 'apple-design', 'Apple Design', "Apple's interface design and physical motion, for the web.") },
      { job: 'Motion reviews', skill: skill(EMIL, 'review-animations', 'Review Animations', 'Reviews motion code against a high bar.') },
    ],
  },
  {
    maker: JAKUB,
    name: 'Interfaces',
    color: PACKS[1].color,
    ink: PACKS[1].ink,
    slots: [
      { job: 'UI reviews', skill: jobById('ui-reviews')!.skill },
      { job: 'Type', skill: skill(JAKUB, 'better-typography', 'Better Typography', 'Sets and reviews how text renders.') },
      { job: 'Color', skill: skill(JAKUB, 'better-colors', 'Better Colors', 'Builds and checks colour systems and contrast.') },
      { job: 'Layout', skill: skill(JAKUB, 'better-layout', 'Better Layout', 'Grouping, alignment and responsive structure.') },
    ],
  },
]

/** Corrections from Taylor's memory notes that went into his merged writing skill. */
export const LEARNED_RULES = [
  'Onchain is one word.',
  'Say IMD, never IdentityMD.',
  'A pay button names the exact amount.',
]
