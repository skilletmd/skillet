'use client'

import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { CommandBlock } from '@/components/command-block'
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
import { AppleLogo, WindowsLogo } from '@/components/os-logos'
import { Avatar } from '@/components/ui/avatar'
import { detectInstallPlatform, type InstallPlatform } from '@/lib/install-platform'

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

const PEOPLE: readonly Person[] = [
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
export function SummonDemo() {
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
// Three full-width tabs the visitor self-selects by where they work, each
// previewing its coverage with the real product logos.
const TABS: ReadonlyArray<{
  id: 'terminal' | 'desktop' | 'chat'
  label: string
  icons: IconComponent[]
}> = [
  { id: 'terminal', label: 'Terminal', icons: [ClaudeCodeLogo, CodexLogo, CursorLogo] },
  { id: 'desktop', label: 'Desktop App', icons: [AppleLogo, WindowsLogo] },
  { id: 'chat', label: 'Chat', icons: [OpenAiLogo, ClaudeLogo] },
]

const PMS = [
  { id: 'npx', label: 'npx', command: 'npx skilletmd', prompt: '$' as string | null },
  { id: 'pnpm', label: 'pnpm', command: 'pnpm dlx skilletmd', prompt: '$' as string | null },
  { id: 'yarn', label: 'yarn', command: 'yarn dlx skilletmd', prompt: '$' as string | null },
  { id: 'bun', label: 'bun', command: 'bunx skilletmd', prompt: '$' as string | null },
  {
    id: 'agent',
    label: 'agent instructions',
    command: 'Run `npx skilletmd` to add the Skillet skill, so I can summon with /skillet @handle.',
    prompt: null as string | null,
  },
] as const

const ACTION =
  'inline-flex items-center gap-2 rounded-lg border border-(--line) bg-(--surface) px-3 py-2 text-sm font-medium text-(--ink) transition-colors hover:border-(--ink-2)'

const DOWNLOADS = [
  { id: 'mac', short: 'Mac', Logo: AppleLogo },
  { id: 'windows', short: 'Windows', Logo: WindowsLogo },
] as const

export function InstallBox() {
  const reduce = useReducedMotion()
  const [tab, setTab] = useState<'terminal' | 'desktop' | 'chat'>('terminal')
  const [pm, setPm] = useState('npx')
  const [os, setOs] = useState<InstallPlatform | null>(null)
  const pmEntry = PMS.find((x) => x.id === pm)!
  const managers = PMS.filter((x) => x.id !== 'agent')
  const agentPm = PMS.find((x) => x.id === 'agent')!
  const pmClass = (id: string) =>
    `transition-colors hover:text-(--ink) ${pm === id ? 'font-semibold text-(--ink)' : ''}`

  // OS is a client-only signal; SSR + first paint default to Mac-first, then
  // reorder to the viewer's platform after hydration.
  useEffect(() => {
    setOs(detectInstallPlatform(navigator.userAgent, navigator.platform))
  }, [])
  const downloads = os === 'windows' ? [DOWNLOADS[1], DOWNLOADS[0]] : DOWNLOADS

  return (
    <div className="mx-auto mt-10 w-full max-w-[420px] lg:mx-0">
      {/* Section header: title left, tab selector right, on one line. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 className="pb-1 text-base font-semibold text-(--ink)">Install Skillet</h2>
        <div className="flex items-center gap-5">
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative pb-1 text-xs font-medium transition-colors ${
                  active ? 'text-(--ink)' : 'text-(--ink-2) hover:text-(--ink)'
                }`}
              >
                {t.label}
                {/* One shared underline that slides between tabs, instead of
                    blinking off under the old tab and on under the new one. */}
                {active && (
                  <motion.span
                    layoutId="install-tab-underline"
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-(--ink)"
                    transition={
                      reduce
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 480, damping: 38, mass: 0.7 }
                    }
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Fixed height so switching tabs (Terminal is taller) doesn't shift the page. */}
      <div className="mt-1 min-h-[96px] text-left">
        {/* mode="wait" so the outgoing panel is gone before the next arrives.
            Opacity only, no layout animation: the min-height above already holds
            the box steady, so nothing needs to measure or move. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.12, ease: [0.16, 1, 0.3, 1] }}
          >
            {tab === 'terminal' && (
              <>
                <CommandBlock
                  command={pmEntry.command}
                  accent="skilletmd"
                  prompt={pmEntry.prompt}
                  size="sm"
                  wrap
                  bare
                  className="bg-(--surface)"
                />
                <div className="mt-2 flex items-center justify-between px-1 text-xs text-(--ink-2)">
                  <div className="flex items-center gap-3">
                    {managers.map((x) => (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => setPm(x.id)}
                        className={pmClass(x.id)}
                      >
                        {x.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPm(agentPm.id)}
                    className={pmClass(agentPm.id)}
                  >
                    {agentPm.label}
                  </button>
                </div>
              </>
            )}

            {tab === 'desktop' && (
              <div className="flex flex-col items-start gap-2.5">
                <p className="text-xs text-(--ink-2)">
                  Get the app. It syncs every agent automatically.
                </p>
                <div className="flex flex-wrap gap-2">
                  {downloads.map((d, i) => (
                    <Link key={d.id} href="/install" className={ACTION}>
                      <d.Logo className="h-4 w-4" />
                      {i === 0 ? `Download for ${d.short}` : d.short}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {tab === 'chat' && (
              <div className="flex flex-col items-start gap-2.5">
                <p className="text-xs text-(--ink-2)">
                  Follow the setup guide, or connect over{' '}
                  <Link
                    href="/docs/mcp"
                    className="font-medium text-(--ink) underline decoration-(--line) underline-offset-2 transition-colors hover:text-(--accent)"
                  >
                    MCP
                  </Link>
                  .
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link href="/docs/runtimes/chatgpt" className={ACTION}>
                    <OpenAiLogo className="h-4 w-4" />
                    ChatGPT
                  </Link>
                  <Link href="/docs/runtimes/claude-ai" className={ACTION}>
                    <ClaudeLogo className="h-4 w-4" />
                    Claude.ai
                  </Link>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
