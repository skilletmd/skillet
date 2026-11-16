// The packs preview's data. Marketing is real: five public skills from Corey
// Haines' marketingskills repo (MIT), and each sample is what that skill wrote
// on 2026-11-12 (`claude -p`, Opus, only that skill loaded) for one made-up
// brief, kept verbatim. The other packs list the jobs they will hold and have
// no skills yet.

import type { Pack, PackSkill } from './types'

export const SAMPLE_BRAND = {
  name: 'Ridgeline Coffee',
  initial: 'R',
  brief: 'Ridgeline Coffee, a made-up neighborhood coffee subscription',
}

const corey = (slug: string, name: string, description: string): PackSkill => ({
  slug,
  name,
  maker: 'Corey Haines',
  makerHandle: 'coreyhaines31',
  avatarUrl: 'https://avatars.githubusercontent.com/u/34802794?v=4',
  sourceUrl: `https://github.com/coreyhaines31/marketingskills/blob/main/skills/${slug}/SKILL.md`,
  description,
})

export const PACKS: Pack[] = [
  {
    id: 'marketing',
    number: '01',
    name: 'Marketing',
    color: '#d43d17',
    ink: '#ffffff',
    jobs: ['Short posts', 'Newsletter', 'Cold email', 'Landing page', 'Ads'],
    slots: [
      {
        job: 'Short posts',
        skill: corey('social', 'Social', 'Posts for X, LinkedIn, Instagram and TikTok, in the format each one favors.'),
        sample: {
          kind: 'post',
          text: "Night Shift, our new decaf, comes out Friday, December 4. It's for the cup you want after dinner.\n\nLike all our coffee, it's roasted on Tuesday and delivered by bike on Friday. A bag is $18, and you can skip any week.",
        },
      },
      {
        job: 'Newsletter',
        skill: corey('emails', 'Emails', 'Emails and sequences: what to send, when to send it, and whether it works.'),
        sample: {
          kind: 'email',
          subject: 'Night Shift, our new decaf, comes out December 4',
          body: "Night Shift is a decaf for the after-dinner cup you've been skipping so you can sleep. We roast the first batch on Tuesday, December 1, and it goes out on the bikes that Friday. Add an $18 bag to your December 4 delivery before Tuesday's roast.",
        },
      },
      {
        job: 'Cold email',
        skill: corey('cold-email', 'Cold Email', 'Cold outreach to businesses: the opener, the reason to write, the follow-up.'),
        sample: {
          kind: 'email',
          subject: 'friday coffee',
          body: "Hi [Name],\n\nYour studio's right on our Friday bike route. You'd get beans roasted that Tuesday for $18 a bag, and you can skip any week nobody's in. 400 of your neighbors already subscribe.\n\nOur new decaf, Night Shift, comes out Friday, December 4. Want the studio on that delivery?\n\n[Your name], Ridgeline Coffee, [street address]\n\nReply \"stop\" and I won't email again.",
        },
      },
      {
        job: 'Landing page',
        skill: corey('copywriting', 'Copywriting', 'Copy for homepages, landing pages and pricing: the headline, the promise, the button.'),
        sample: {
          kind: 'hero',
          headline: 'Roasted Tuesday, biked to your door Friday',
          sub: 'Join 400 neighbors who pay $18 a bag and can skip any week.',
          button: 'Start My Friday Delivery',
        },
      },
      {
        job: 'Ads',
        skill: corey('ad-creative', 'Ad Creative', 'Ad headlines and text, and which ones to run or kill.'),
        sample: {
          kind: 'ad',
          headline: 'Roasted Tuesday. At your door Friday.',
          body: '400 neighbors already get Ridgeline Coffee delivered by bike. It\'s $18 a bag, and you can skip any week. Our new decaf, Night Shift, comes out December 4.',
        },
      },
    ],
  },
  {
    id: 'writing',
    number: '02',
    name: 'Writing',
    color: '#2f57e8',
    ink: '#ffffff',
    jobs: ['Short form', 'Long form', 'Edits', 'Headlines', 'Threads'],
    slots: [],
  },
  {
    id: 'sales',
    number: '03',
    name: 'Sales',
    color: '#0c7f50',
    ink: '#ffffff',
    jobs: ['Prospect research', 'First emails', 'Follow-ups', 'Call notes', 'Proposals'],
    slots: [],
  },
  {
    id: 'founder',
    number: '04',
    name: 'Founder',
    color: '#f5b11a',
    ink: '#1b1609',
    jobs: ['Investor updates', 'Pitch decks', 'Hiring posts', 'Launch notes', 'Board memos'],
    slots: [],
  },
]
