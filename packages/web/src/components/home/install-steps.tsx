'use client'

import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type ComponentType } from 'react'
import {
  ClaudeCodeLogo,
  ClaudeLogo,
  CodexLogo,
  CopilotLogo,
  CursorLogo,
  GeminiLogo,
  HermesLogo,
  OpenAiLogo,
  WindsurfLogo,
} from '@/components/brand-logos'
import { Avatar } from '@/components/ui/avatar'

// Real, recognizable authors from the crawled mirror library (mirror-sources.json).
// specialty + slug point at the person's real mirrored skill, so the reply links
// to an actual /@handle/skill page. reply.pre / reply.post wrap the linked
// specialty and vary per person so it doesn't read as one templated line.
type Person = {
  handle: string
  name: string
  specialty: string
  task: string
  slug: string
  reply: { pre: string; post: string }
}

/** The cast that plays when too few real authors qualify. */
const FALLBACK_PEOPLE: readonly Person[] = [
  {
    handle: 'addyosmani',
    name: 'Addy Osmani',
    specialty: 'web quality',
    task: 'audit my Core Web Vitals',
    slug: 'web-quality-skills',
    reply: { pre: 'On it, running my ', post: ' skill to check your Core Web Vitals.' },
  },
  {
    handle: 'mattpocock',
    name: 'Matt Pocock',
    specialty: 'code review',
    task: 'review my PR',
    slug: 'code-review',
    reply: { pre: 'On it, taking my ', post: ' skill through your PR.' },
  },
  {
    handle: 'emilkowalski',
    name: 'Emil Kowalski',
    specialty: 'animation',
    task: 'make this modal feel alive',
    slug: 'improve-animations',
    reply: { pre: 'Let me use my ', post: ' skill to bring that modal to life.' },
  },
  {
    handle: 'antfu',
    name: 'Anthony Fu',
    specialty: 'tooling',
    task: 'set up my tooling',
    slug: 'skills',
    reply: { pre: 'Sure, my ', post: ' skill will get you set up.' },
  },
  {
    handle: 'garrytan',
    name: 'Garry Tan',
    specialty: 'shipping',
    task: 'ship my feature',
    slug: 'ship',
    reply: { pre: 'On it, my ', post: ' skill will get your feature out the door.' },
  },
]

/** Below this many eligible authors, play the hardcoded script instead. */
const MIN_CAST = 3

// Texting rhythm, in ms.
const SYSTEM_MS = 1000
const TYPING_OUT_MS = 1700
const GAP_MS = 1000
const TYPING_IN_MS = 2100
const NEXT_MS = 4600

type IconComponent = ComponentType<{ className?: string }>
// pending = still "typing" (bubble shows dots); the bubble element stays mounted
// and only its content swaps to the real text, so the avatar never re-mounts.
type Message = { id: number; kind: 'system' | 'out' | 'in'; person: Person; pending?: boolean }

function CheckMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Typing dots. Dark bubble (your side) wants light dots; the light reply bubble
// (their side) wants ink dots. Height matches one line of the bubble it stands
// in for, so swapping the typing bubble for the real one doesn't jump the thread.
function Dots({ tone, className }: { tone: 'light' | 'dark'; className?: string }) {
  // 'light' = the dots inside the "you" bubble, so they track its text token
  // rather than a hardcoded white (which would vanish on the light teal in dark
  // mode). 'dark' = the reply bubble, which stays on the page's ink scale.
  const dot = `summon-dot h-1.5 w-1.5 rounded-full ${tone === 'light' ? 'bg-(--summon-you-ink)/70' : 'bg-(--ink-2)'}`
  return (
    <span className={`flex items-center gap-1 ${className ?? ''}`}>
      <span className={dot} />
      <span className={dot} style={{ animationDelay: '150ms' }} />
      <span className={dot} style={{ animationDelay: '300ms' }} />
    </span>
  )
}

// One expert's exchange, in the order it plays: you ask, Skillet loads their
// skills, they reply.
function seedPerson(person: Person, startId: number): Message[] {
  return [
    { id: startId, kind: 'out', person },
    { id: startId + 1, kind: 'system', person },
    { id: startId + 2, kind: 'in', person },
  ]
}

// ── The proof: a self-running summon thread, framed as a product surface ──────
// Contained in a soft card with a "your agent" window chrome so it reads as a
// thing you're looking at, not text you read through. Reduced-motion shows a
// static pair of exchanges.
/**
 * Replies for a generated cast, rotated so the thread does not read as one
 * template repeated down the page.
 *
 * The hardcoded entries name the object of the work ("to check your Core Web
 * Vitals", "through your PR"), which is what makes them feel like a real agent
 * answering. A generated reply cannot: it knows the skill, not what the skill
 * is about. So these vary the opener and the rhythm and stop there, rather than
 * substituting enthusiasm for the specificity they cannot have.
 *
 * Deliberately no "10x you" / "level you up" / "make you smarter" register.
 * A reply that promises an outcome the skill has not produced yet is the one
 * thing this widget cannot afford, since its whole job is being true about real
 * people's work.
 */
const GENERATED_REPLIES: ReadonlyArray<{ pre: string; post: string }> = [
  { pre: 'On it, using my ', post: ' skill.' },
  { pre: 'Sure, my ', post: ' skill covers this.' },
  { pre: 'Let me take that through my ', post: ' skill.' },
  { pre: 'Got it. Running my ', post: ' skill now.' },
  { pre: 'On it, my ', post: ' skill is built for this.' },
  { pre: 'Happy to. My ', post: ' skill handles it.' },
]

/**
 * Turn stored suggestions into the hero's cast.
 *
 * `specialty` is the link text, so it is the slug read back as words.
 *
 * The reply rotates by position rather than at random: the cast is stable
 * across renders, so a random pick would reshuffle the same person's line
 * between visits and could hand two people in a row the same sentence.
 */
export interface SuggestionRow {
  handle: string
  name: string
  task: string
  slug: string
}

export function peopleFromSuggestions(rows: SuggestionRow[]): Person[] {
  return rows.map((r, i) => ({
    handle: r.handle,
    name: r.name,
    specialty: r.slug.replace(/[-_]+/g, ' '),
    task: r.task,
    slug: r.slug,
    reply: GENERATED_REPLIES[i % GENERATED_REPLIES.length]!,
  }))
}

/**
 * `people` overrides the hardcoded cast when enough real authors qualify.
 *
 * All-or-nothing by design: a half-real cast is harder to reason about than
 * either, and the hardcoded script is the floor this can never render below.
 */
export function SummonDemo({ people }: { people?: SuggestionRow[] } = {}) {
  // Mapped here, not by the caller: this module is `'use client'`, so a server
  // component cannot invoke its functions -- only pass it plain data.
  const cast = people ? peopleFromSuggestions(people) : []
  const PEOPLE = cast.length >= MIN_CAST ? cast : FALLBACK_PEOPLE
  const reduce = useReducedMotion()
  const [msgs, setMsgs] = useState<Message[]>(() => [
    ...seedPerson(PEOPLE[0]!, 0),
    ...seedPerson(PEOPLE[1]!, 3),
  ])
  const running = useRef(false)

  useEffect(() => {
    if (reduce || running.current) return
    running.current = true
    let personIdx = 2
    let nextId = 6
    let timer: ReturnType<typeof setTimeout>

    const push = (kind: Message['kind'], person: Person, pending: boolean) => {
      const id = nextId++
      setMsgs((m) =>
        m.some((x) => x.id === id) ? m : [...m, { id, kind, person, pending }].slice(-7),
      )
      return id
    }
    const settle = (id: number) =>
      setMsgs((m) => m.map((x) => (x.id === id ? { ...x, pending: false } : x)))

    const runPerson = () => {
      const person = PEOPLE[personIdx % PEOPLE.length]!
      const outId = push('out', person, true)
      timer = setTimeout(() => {
        settle(outId)
        timer = setTimeout(() => {
          push('system', person, false)
          timer = setTimeout(() => {
            const inId = push('in', person, true)
            timer = setTimeout(() => {
              settle(inId)
              personIdx++
              timer = setTimeout(runPerson, NEXT_MS)
            }, TYPING_IN_MS)
          }, SYSTEM_MS)
        }, GAP_MS)
      }, TYPING_OUT_MS)
    }

    timer = setTimeout(runPerson, NEXT_MS)
    return () => {
      clearTimeout(timer)
      running.current = false
    }
  }, [reduce])

  const spring = reduce
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 520, damping: 34, mass: 0.8 } as const)

  return (
    <div className="mx-auto mt-10 w-full max-w-[540px] lg:mt-0">
      <div className="overflow-hidden rounded-2xl border border-(--line) bg-(--surface) shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-(--line) bg-(--bg) px-4 py-3">
          <span className="text-xs font-medium text-(--ink-2)">Skillet lives in your agent</span>
          <span
            className="flex items-center gap-2 text-(--ink-2)"
            aria-hidden="true"
            title="Runs in any agent"
          >
            <ClaudeCodeLogo className="h-3.5 w-3.5" />
            <OpenAiLogo className="h-3.5 w-3.5" />
            <CursorLogo className="h-3.5 w-3.5" />
            <CodexLogo className="h-3.5 w-3.5" />
            <WindsurfLogo className="h-3.5 w-3.5" />
            <CopilotLogo className="h-3.5 w-3.5" />
            <GeminiLogo className="h-3.5 w-3.5" />
            <HermesLogo className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="relative h-[244px] overflow-hidden px-4 pb-4 text-left">
          <div className="flex h-full flex-col justify-end gap-2.5 [-webkit-mask-image:linear-gradient(to_bottom,transparent,#000_16%)] [mask-image:linear-gradient(to_bottom,transparent,#000_16%)]">
            <AnimatePresence initial={false} mode="popLayout">
              {msgs.map((m) => (
                <motion.div
                  key={m.id}
                  layout
                  initial={reduce ? false : { opacity: 0, y: 12, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                  transition={spring}
                  className={
                    m.kind === 'system'
                      ? 'flex justify-center py-1.5'
                      : m.kind === 'out'
                        ? 'flex justify-end'
                        : 'flex items-end gap-2'
                  }
                >
                  {m.kind === 'system' ? (
                    <span className="inline-flex items-center gap-1.5 text-2xs text-(--ink-2)">
                      <CheckMark className="h-3 w-3 shrink-0" />
                      <span>
                        Loaded{' '}
                        <Link
                          href={`/${m.person.handle}`}
                          className="font-medium text-(--ink) hover:underline"
                        >
                          {m.person.name}
                        </Link>
                        {"'s skills into your agent"}
                      </span>
                    </span>
                  ) : m.kind === 'out' ? (
                    <div className="max-w-[85%] break-words rounded-2xl rounded-br-md bg-(--summon-you) px-3.5 py-2.5 font-mono text-xs leading-relaxed text-(--summon-you-ink)">
                      {m.pending ? (
                        <Dots tone="light" className="h-5" />
                      ) : (
                        <>
                          /skillet @{m.person.handle} {m.person.task}
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <Avatar
                        src={`https://github.com/${m.person.handle}.png`}
                        name={m.person.name}
                        colorKey={m.person.handle}
                        size="sm"
                        className="shrink-0"
                      />
                      {/* --card-soft, not --bg: the demo card is --surface, and
                          --bg sits ~4 points off it, so the reply side was
                          barely a bubble at all. --card-soft is the token that
                          already means "a surface that steps back from the
                          card". */}
                      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-(--card-soft) px-3.5 py-2.5 text-sm text-(--ink)">
                        {m.pending ? (
                          <Dots tone="dark" className="h-5" />
                        ) : (
                          <>
                            {m.person.reply.pre}
                            <Link
                              href={`/${m.person.handle}/${m.person.slug}`}
                              className="font-medium underline decoration-(--line) underline-offset-2 transition-colors hover:text-(--accent)"
                            >
                              {m.person.specialty}
                            </Link>
                            {m.person.reply.post}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── The action: the install card, quieter, below ─────────────────────────────
/**
 * The homepage's install affordance. A thin wrapper now: the picker itself is
 * shared with the kit page's post-add bar, because install told three different
 * ways in three places is how three places drift.
 */
