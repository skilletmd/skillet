import type { Metadata } from 'next'
import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/cn'
import s from '@/components/packs/packs.module.css'
import i from '@/components/packs/ideas/ideas.module.css'
import { BuildIdea } from '@/components/packs/ideas/build-idea'
import { LevelIdea } from '@/components/packs/ideas/level-idea'
import { PacksPhone } from '@/components/packs/ideas/packs-phone'
import { PeopleIdea } from '@/components/packs/ideas/people-idea'
import { TidyIdea } from '@/components/packs/ideas/tidy-idea'

export const metadata: Metadata = {
  title: 'Kits, not catalogs · Skillet',
  description: 'Five ways into one idea: your AI gets one skill per job, and you fill the slots.',
  robots: { index: false, follow: false },
}

const IDEAS = [
  { name: 'Packs', href: '/packs', line: 'Pick a premade pack for your job. Open it like cards, then swap any card.', Screen: PacksPhone },
  { name: 'Build', href: '/packs/ideas/build', line: 'Say what you hand to AI. Each job becomes a slot that fills itself.', Screen: BuildIdea },
  { name: 'Tidy', href: '/packs/ideas/tidy', line: 'Start from what you have. Skills fighting over one job fold into one.', Screen: TidyIdea },
  { name: 'Level up', href: '/packs/ideas/level', line: 'Each slot gets better at your work, and new versions win it blind.', Screen: LevelIdea },
  { name: 'People', href: '/packs/ideas/people', line: 'Copy the kit of someone you trust, then make it yours.', Screen: PeopleIdea },
]

// Each phone is the idea itself at 390 by 844, scaled to fit. The scaled box is
// the containing block for the page's pinned footer, so it stays in the phone;
// the inner box scrolls. (The app refuses to be framed, so no iframes.)
const SCALE = 332 / 390

/** The design board: every idea live, side by side, so one can be picked. */
export default function IdeasBoard() {
  return (
    <div className={cn(s.tokens, s.page)}>
      <header className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3 sm:px-8">
        <Link href="/" className="site-brand-link flex items-center font-mono text-base font-bold">
          <span className="site-logo-mark" aria-hidden="true" />
          Skillet
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-[1440px] px-4 pt-6 pb-16 sm:px-8 sm:pt-10">
        <h1 className="text-5xl leading-[1.05] font-bold tracking-[-0.045em] text-balance max-sm:text-4xl">
          Kits, not catalogs
        </h1>
        <p className="mt-3 max-w-[56ch] text-base leading-[1.5] text-pretty text-[var(--p-ink-2)]">
          Five ways into one idea: your AI gets one skill per job, and you fill the slots. Every phone below
          works, so tap around.
        </p>
        <ol className="-mx-4 mt-10 flex snap-x snap-mandatory scroll-px-4 gap-6 overflow-x-auto px-4 pb-8 sm:-mx-8 sm:scroll-px-8 sm:px-8">
          {IDEAS.map((idea, n) => (
            <li key={idea.name} className="w-[332px] shrink-0 snap-start">
              <h2 className="text-xl font-bold tracking-[-0.02em]">
                {n + 1}. {idea.name}
              </h2>
              <p className="mt-1 min-h-[42px] text-sm leading-[1.5] text-pretty text-[var(--p-ink-2)]">{idea.line}</p>
              <div className={cn(i.phone, 'mt-4')} style={{ width: 332, height: Math.round(844 * SCALE) }}>
                <div style={{ width: 390, height: 844, transform: `scale(${SCALE})`, transformOrigin: '0 0' }}>
                  <div className="h-full overflow-y-auto overscroll-contain">
                    <idea.Screen />
                  </div>
                </div>
              </div>
              <a href={idea.href} className="mt-3 inline-block text-sm font-medium underline underline-offset-2">
                Open full screen
              </a>
            </li>
          ))}
        </ol>
      </main>
    </div>
  )
}
