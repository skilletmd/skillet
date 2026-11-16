// The kit-as-jobs preview (/arena/slots), on real data: the skills that load on
// Taylor's Mac, grouped by the job they do, with how often each ran in the last
// 30 days (Skill tool calls in his Claude Code transcripts, Oct 13 to Nov 12,
// 2026). The merged writing skill and its drafts are real too: see
// slots-drafts.ts. The job names are made up.

import type { KitSkillEntry } from '@/lib/kits'
import { DRAFTS } from './slots-drafts'

export interface SlotSkill {
  author: string
  slug: string
  /** Display name, when the slug doesn't humanize well. */
  name?: string
  authorName: string
  avatarUrl: string | null
  category: string
  description: string
  /** Runs in the last 30 days on this Mac. */
  runs: number
}

/** One brief, written by today's skills and by the merged one, shown blind. */
export interface SlotRound {
  /** What the brief asks for, as the tally names it ("guide", "Judge tweet"). */
  label: string
  brief: string
  format: 'text' | 'markdown'
  today: string
  merged: string
  /** Puts today's version on the left. */
  todayFirst: boolean
}

export interface SlotMerge {
  /** The sheet's one line under the job name. */
  pitch: string
  /** The one skill that replaces every skill in the job. */
  result: SlotSkill
  /** Corrections from Taylor's memory files that no skill held yet. */
  notes: number
  rounds: SlotRound[]
}

export interface KitSlot {
  job: string
  /** Every skill that loads for this job, most runs first. */
  skills: SlotSkill[]
  merge?: SlotMerge
}

export const SLOTS_KIT = {
  id: 'preview-slots-kit',
  name: 'My kit',
  owner: 'taylor',
  ownerName: 'Taylor',
  ownerAvatar:
    'https://pub-5793f7ad27084cca99209bc8f7274036.r2.dev/729d9894e2d7258164f69e4ffe2035b92a188653017c00c8ff95c6c4c0ff0980',
  description: 'What my agents load on this Mac, one row per job.',
}

const gh = (handle: string) => `https://github.com/${handle}.png`

const skill = (
  author: string,
  authorName: string,
  avatarUrl: string | null,
  slug: string,
  category: string,
  runs: number,
  description: string,
  name?: string,
): SlotSkill => ({ author, slug, name, authorName, avatarUrl, category, description, runs })

const taylor = (slug: string, category: string, runs: number, description: string, name?: string) =>
  skill('taylor', 'Taylor', SLOTS_KIT.ownerAvatar, slug, category, runs, description, name)
const anthropic = (slug: string, category: string, runs: number, description: string, name?: string) =>
  skill('anthropics', 'Anthropic', gh('anthropics'), slug, category, runs, description, name)
const every = (slug: string, category: string, runs: number, description: string, name?: string) =>
  skill('EveryInc', 'Every', gh('EveryInc'), slug, category, runs, description, name)

export const KIT_SLOTS: KitSlot[] = [
  {
    job: 'Writing',
    skills: [
      taylor('founder-tweet-writer', 'writing', 13, 'Write tweets in my style.'),
      taylor('house-style', 'writing', 9, 'My house style for anything a stranger will read.', 'House Style'),
      every('ce-noslop', 'writing', 1, 'Rewrite prose so it carries no AI writing tells.', 'Noslop'),
    ],
    merge: {
      pitch: 'Second try: one skill in place of 3, rebuilt after your last picks. Pick blind.',
      result: taylor(
        'house-style',
        'writing',
        0,
        'One writing skill: tweets, copy, docs and edits, with my corrections built in.',
        'House Style',
      ),
      notes: 11,
      rounds: [
        {
          label: 'Codex tweet',
          brief: 'One tweet: IMD Worker can think with Codex now, not just Claude.',
          format: 'text',
          today: DRAFTS.codexToday,
          merged: DRAFTS.codexMerged,
          todayFirst: false,
        },
        {
          label: 'Judge tweet',
          brief: 'One tweet: Judge, yes-or-no answers for any smart contract, is live on Ethereum.',
          format: 'text',
          today: DRAFTS.judgeToday,
          merged: DRAFTS.judgeMerged,
          todayFirst: true,
        },
      ],
    },
  },
  {
    job: 'Browser',
    skills: [
      anthropic('claude-in-chrome', 'productivity', 30, 'Drive my Chrome: click, fill forms, read the console.'),
      skill('vercel-labs', 'Vercel Labs', gh('vercel-labs'), 'agent-browser', 'productivity', 10, 'A browser CLI for agents.'),
      anthropic('chrome-browser', 'productivity', 0, 'Chrome browser automation.'),
      anthropic('built-in-browser', 'productivity', 0, 'A browser built into the app.', 'Built-in Browser'),
      skill('superset', 'Superset', null, 'browser', 'productivity', 0, 'Browser automation for Superset panes.'),
    ],
  },
  { job: 'Interface design', skills: [taylor('gtm-ui', 'design', 25, 'My bar for websites and web apps.', 'GTM UI')] },
  { job: 'Product calls', skills: [taylor('gtm-product', 'product', 18, 'Name the core, grow it, cut the rest.', 'GTM Product')] },
  { job: 'Pull requests', skills: [taylor('world-class-pr', 'devops', 11, 'TLDR first, numbers, every change in the open.', 'World Class PR')] },
  { job: 'Music for a video', skills: [taylor('video-score', 'media', 7, "A score made from the film's own timeline.")] },
  { job: 'Films', skills: [taylor('gtm-film', 'media', 3, 'Story first, then a spec, a storyboard and a review.', 'GTM Film')] },
  {
    job: 'Code review',
    skills: [
      anthropic('code-review', 'quality', 2, 'Review the current diff for correctness bugs.'),
      every('ce-code-review', 'quality', 0, 'Review a diff for bugs, regressions and tests.', 'Code Review'),
    ],
  },
  { job: 'Critique a screen', skills: [taylor('screenshot-critique', 'design', 2, 'Critique a UI screenshot like an opinionated owner.')] },
  { job: 'Tighten a visual system', skills: [taylor('hairy-styles', 'design', 2, 'Count every design unit and box the strays.')] },
]

/** The same skills as plain kit entries, for today's list view. */
export const SLOTS_KIT_ENTRIES: KitSkillEntry[] = KIT_SLOTS.flatMap(({ skills }) =>
  skills.map((s) => ({
    skill_id: `${s.author}:${s.slug}`,
    pinned_hash: null,
    current_hash: null,
    added_at: 0,
    description: s.description,
    visibility: 'public' as const,
    category: s.category,
    author_name: s.authorName,
    author_avatar_url: s.avatarUrl,
  })),
)
