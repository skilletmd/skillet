'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CommandBlock } from '@/components/command-block'
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard'
import { CopyGlyph, CopiedGlyph } from '@/components/ui/copy-glyph'
// Static, not `await import(...)`. Server actions are designed to be imported
// straight into a client component; dynamically importing a 'use server' module
// makes Turbopack emit a `require` the browser cannot resolve, which surfaces as
// a runtime "require is not defined" the moment the panel opens.
import {
  enableMcpLinkAction,
  disableMcpLinkAction,
} from '@/app/(consumer)/settings/connectors-actions'
import {
  ClaudeLogo,
  OpenAiLogo,
} from '@/components/brand-logos'
import { AppleLogo, WindowsLogo } from '@/components/os-logos'
import { detectInstallPlatform, type InstallPlatform } from '@/lib/install-platform'

/** Which door gets the solid treatment. Not a selector: every door is always
 *  there, this only decides which one is the recommended answer. */
type Door = 'desktop' | 'terminal' | 'chat'

/**
 * How to paste the link into each cloud client, condensed from `/docs/mcp`.
 *
 * `steps` is only what it takes to get connected; `after` is what you do once it
 * is. Mixed together they read as a seven-step chore, and the usage lines
 * inflated the count at the exact moment someone decides whether to bother.
 */
const RUNTIME_STEPS = [
  {
    name: 'ChatGPT',
    Logo: OpenAiLogo,
    // These are the WEB steps (chatgpt.com). The desktop app has a different
    // form: "Add MCP Server" with a STDIO / Streamable HTTP type toggle, where
    // Streamable HTTP is the right one (STDIO launches a local process, which is
    // `skillet mcp` on loopback, not the hosted link).
    // Deep link straight to the New Plugin modal, which saves two navigation
    // steps. Found by reading the URL while the modal was open.
    open: {
      href: 'https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins',
      label: 'Open the New Plugin form in ChatGPT',
    },
    // The icon field is optional and the only part of looking like a real
    // connector that does not need OpenAI's review. Unlisted servers otherwise
    // sit in the Apps list with a generic glyph next to Slack and GitHub.
    icon: { href: '/brand/skillet-connector-icon.png', label: 'Grab the Skillet icon' },
    steps: [
      // Hard prerequisite, not optional: the New Plugin form rejects an
      // unverified connector until this is on. Removed once because a tester
      // already had it enabled and never hit the wall.
      'In ChatGPT, turn on Settings → Security and login → Developer mode',
      'Open the New Plugin form in ChatGPT',
      'Name it Skillet, keep Connection on Server URL, and paste your private MCP link',
      // The dropdown defaults to OAuth. Left alone the connection fails, and it
      // is the one field with a wrong default.
      'Set Authentication to None, tick "I understand and want to continue", then Create',
      'On the Add Skillet to ChatGPT screen, click Connect',
    ],
    // Slash, not at-sign: `/` is ChatGPT's own command affordance and is the
    // form verified working. Claude uses `@` for connector mentions.
    after: 'Type /skillet plus what you want to use.',
    example: '/skillet help me with my brand',
  },
  {
    name: 'Claude.ai',
    Logo: ClaudeLogo,
    steps: [
      'In Claude.ai, open Settings → Connectors → Add custom connector',
      'Name it Skillet, paste your private MCP link, and click Continue',
      'Leave Authentication on None, then add it and Connect on the Skillet card',
      'Set Read-only tools to Always allow, so Claude stops asking every time',
      'In a chat, toggle Skillet on from ＋ → Connectors',
    ],
    icon: { href: '/brand/skillet-connector-icon.png', label: 'Grab the Skillet icon' },
    // `@skillet` works because step 3 names the connector Skillet. Renaming the
    // step without renaming this breaks the mention.
    after: 'Type @skillet plus what you want to use.',
    example: '@skillet revise my writing',
  },
] as const

/**
 * Display form of the link: the middle of the token elided.
 *
 * 32 bytes of hex does not get more readable at any length, and this card ends
 * up in screenshots. The copy still carries the whole thing. Mirrors the
 * registry's own `redactMcpUrl`, which blanks the same segment in its logs.
 */
function redactToken(url: string): string {
  return url.replace(/(\/mcp\/)([^/?#]+)/, (_m, prefix: string, token: string) =>
    token.length <= 16 ? `${prefix}${token}` : `${prefix}${token.slice(0, 12)}\u2026${token.slice(-4)}`,
  )
}
const DOWNLOADS = [
  { id: 'mac', short: 'Mac', Logo: AppleLogo },
  { id: 'windows', short: 'Windows', Logo: WindowsLogo },
] as const

export function InstallActions({
  signedIn = false,
  mcpUrl = null,
  layout = 'row',
}: {
  signedIn?: boolean
  /** The viewer's live MCP link when it is already on. Null means off. */
  mcpUrl?: string | null
  /**
   * `row` when the doors have the page's full width and fit on one line.
   * `pairs` for a narrow column, where a flex wrap strands the fourth door on
   * its own line and reads as a bug. The 2x2 it produces lands on the grouping
   * that is already true: this machine on top, the cloud underneath.
   */
  layout?: 'row' | 'pairs'
}) {
  const reduce = useReducedMotion()
  const [os, setOs] = useState<InstallPlatform | null>(null)
  // Which cloud client's steps are open, if any. The doors are the tabs: an
  // inner "Chat" abstraction that then asked which one was a level of nesting
  // for a question the brand names already answer.
  const [openClient, setOpenClient] = useState<string | null>(null)
  const [mcp, setMcp] = useState<string | null>(mcpUrl)
  const { copied, copy } = useCopyToClipboard()

  useEffect(() => {
    setOs(detectInstallPlatform(navigator.userAgent, navigator.platform))
  }, [])

  const isMobile = os === 'mobile'
  const desktop = os === 'windows' ? DOWNLOADS[1] : DOWNLOADS[0]
  // Before detection lands, lead with the download: it is the right answer for
  // most visitors, and it is the least wrong for the rest.
  const lead: Door = isMobile ? 'chat' : os === 'linux' ? 'terminal' : 'desktop'

  // One geometry for all four. They are peers, and the recommendation is carried
  // by fill alone; differing padding made the same-sized decision look like
  // different-sized decisions.
  const pairs = layout === 'pairs'
  const base = `inline-flex items-center gap-2 rounded-lg py-2 text-sm transition-colors${
    // Left, not centered. Grid items stretch to equal width, and centering four
    // labels of different lengths puts their icons at four different offsets,
    // so there is nothing to scan down. Flush left gives one column of icons and
    // one starting x for every label, which is what a list of places wants.
    // A little more side padding than the row version, since these are wide.
    pairs ? ' px-3.5' : ' px-3'
  }`
  const primary = `${base} bg-(--ink) font-semibold text-(--surface) hover:opacity-90`
  const secondary = `${base} border border-(--line) bg-(--surface) font-medium text-(--ink) hover:border-(--ink-2)`
  // Open, not "has a menu". A chevron promises something drops from the button;
  // the panel opens below the whole row. A selected state says which one you are
  // looking at without claiming anything about where it appears.
  const openDoor = `${base} border border-(--ink) bg-(--accent-bg) font-semibold text-(--ink)`

  return (
    <div>
      {/* One row, four places. The grouping is real (the app and the CLI reach
          the agents on THIS computer, the other two reach the cloud over MCP,
          and installing one does nothing for the other) but it does not need
          marking: the heading above says "where", so the buttons read as places
          already. A labelled two-row version said the same thing twice for double
          the height, and a wider gap between the pairs read as inconsistent
          spacing rather than as grouping. Even gaps, and the words carry it. */}
      <div className={pairs ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap items-center gap-2'}>
        {!isMobile && (
          <Link
            href={signedIn ? '/setup' : '/install'}
            className={lead === 'desktop' ? primary : secondary}
          >
            <desktop.Logo className="h-4 w-4" />
            {/* The category standard when there is room for it, and the only
                door here that puts a file on your machine, so the one verb
                among three nouns is earned. The row layout keeps the short
                form: four content-sized buttons share a line there. */}
            {pairs ? `Download for ${desktop.short}` : `${desktop.short} app`}
          </Link>
        )}

        {!isMobile && (
          <button
            type="button"
            onClick={() => void copy('npx skilletmd')}
            className={`${lead === 'terminal' ? primary : secondary} font-mono`}
            aria-label="Copy the install command"
          >
            <TerminalGlyph />
            npx skilletmd
            {/* Below the label in contrast. It is pure affordance: the command
                carries the meaning, this only says the button copies. Brand
                marks do NOT get this treatment, since being recognised at a
                glance is their whole job. */}
            <span
              aria-hidden="true"
              className={`inline-flex h-4 w-4 items-center justify-center text-(--ink-2)${
                // Pinned to the far edge when the button is stretched: mid-button
                // it reads as part of the command rather than as the button's own
                // affordance. In a content-sized row there is no gap to cross, so
                // it stays adjacent there.
                pairs ? ' ml-auto' : ''
              }`}
            >
              {copied ? <CopiedGlyph /> : <CopyGlyph />}
            </span>
            <span className="sr-only" role="status">
              {copied ? 'Copied' : ''}
            </span>
          </button>
        )}

        {RUNTIME_STEPS.map((r) =>
          signedIn ? (
            <button
              key={r.name}
              type="button"
              onClick={() => setOpenClient((v) => (v === r.name ? null : r.name))}
              aria-expanded={openClient === r.name}
              className={openClient === r.name ? openDoor : lead === 'chat' ? primary : secondary}
            >
              <r.Logo className="h-4 w-4" />
              {r.name}
            </button>
          ) : (
            <Link key={r.name} href="/docs/mcp" className={lead === 'chat' ? primary : secondary}>
              <r.Logo className="h-4 w-4" />
              {r.name}
            </Link>
          ),
        )}
      </div>

      {/* Grows the card open only after a press you chose to make, and collapses
          the same way. Same spring as the bar around it, critically damped: a
          click carries no momentum, so bounce would be decoration. */}
      <AnimatePresence initial={false}>
        {openClient && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={reduce ? { duration: 0.12 } : { type: 'spring', bounce: 0, duration: 0.35 }}
            className="overflow-hidden"
          >
            <div className="pt-3">
              <ChatPanelBody url={mcp} setUrl={setMcp} client={openClient} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * A prompt, not a brand.
 *
 * The other three doors each map to one product, so they wear its mark. This one
 * reaches eight runtimes (Claude Code, Cursor, Codex, Devin, Hermes, OpenClaw,
 * OpenCode, Windsurf), and picking any single logo would make the broadest door
 * look like the narrowest.
 */
function TerminalGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" aria-hidden="true">
      <path
        d="M3 4.5L6.5 8L3 11.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.5 11.5H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * What Chat opens onto: the link, where to paste it, and a way back off.
 *
 * The enable fires on mount, which is to say on expand. `enableMcpLinkAction`
 * mints on first call and returns the live link after, so React double-invoking
 * effects in development costs a redundant request and nothing else.
 */
function ChatPanelBody({
  url,
  setUrl,
  client,
}: {
  url: string | null
  setUrl: (v: string | null) => void
  /** Which client's steps to show. Chosen by which door you opened. */
  client: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { copied, copy } = useCopyToClipboard()

  const run = useCallback(
    async (which: 'enable' | 'disable') => {
      setBusy(true)
      setError(null)
      try {
        const res =
          which === 'enable' ? await enableMcpLinkAction() : await disableMcpLinkAction()
        if (!res.ok) {
          setError(res.error ?? 'Could not change that. Try again.')
          return
        }
        setUrl(which === 'enable' ? (res.url ?? null) : null)
      } catch {
        setError('Could not change that. Try again.')
      } finally {
        setBusy(false)
      }
    },
    [setUrl],
  )

  const enabledRef = useRef(false)
  useEffect(() => {
    if (url || enabledRef.current) return
    enabledRef.current = true
    void run('enable')
  }, [url, run])

  if (!url) {
    return (
      <p className="text-xs text-(--ink-2)">
        {error ? (
          <>
            <span className="text-(--danger)">{error}</span>{' '}
            <button
              type="button"
              onClick={() => void run('enable')}
              className="font-medium text-(--ink) underline decoration-(--line) underline-offset-2"
            >
              Retry
            </button>
          </>
        ) : (
          'Turning MCP on…'
        )}
      </p>
    )
  }

  const steps = RUNTIME_STEPS.find((r) => r.name === client) ?? RUNTIME_STEPS[0]

  return (
    <div className="flex w-full flex-col items-start gap-4">
      {/* Copying IS step one. The link used to float above the list with nothing
          telling you to take it, so the sequence started at "open Settings" while
          your clipboard was empty. Steps are text-sm, not text-xs: this is the
          one thing on the page you read while doing something in another window,
          and it was the smallest text on screen. */}
      <ol className="flex w-full flex-col gap-3">
        <Step n={1} label="Copy your private MCP link">
          <button
            type="button"
            onClick={() => void copy(url)}
            className="flex w-full max-w-[360px] items-center gap-2 rounded-lg border border-(--line) bg-(--bg) px-3 py-2 text-left font-mono text-xs text-(--ink) transition-colors hover:border-(--ink-2)"
            aria-label="Copy your private MCP link"
          >
            {/* Shown redacted, copied whole. */}
            <span className="min-w-0 flex-1 truncate">{redactToken(url)}</span>
            <span
              aria-hidden="true"
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-(--ink-2)"
            >
              {copied ? <CopiedGlyph /> : <CopyGlyph />}
            </span>
          </button>
        </Step>
        {steps.steps.map((step, i) =>
          i === 1 && 'open' in steps && steps.open ? (
            <Step key={step} n={i + 2} label="">
              <a
                href={steps.open.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-(--ink) underline decoration-(--line) underline-offset-2 transition-colors hover:text-(--accent)"
              >
                {steps.open.label} ↗
              </a>
            </Step>
          ) : (
            <Step key={step} n={i + 2} label={step} />
          ),
        )}
      </ol>

      {/* Outside the numbers on purpose: everything above gets you connected,
          this is the payoff. A number here would read as one more chore. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm leading-[1.45] text-(--ink)">{steps.after}</p>
        <p className="text-sm text-(--ink-2)">
          Ex:{' '}
          <code className="rounded-md border border-(--line) bg-(--bg) px-1.5 py-0.5 font-mono text-xs text-(--ink)">
            {steps.example}
          </code>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--ink-2)">
        <Link
          href="/docs/mcp"
          className="font-medium underline decoration-(--line) underline-offset-2 transition-colors hover:text-(--ink)"
        >
          Full guide
        </Link>
        {/* Admin, not part of the task, so it sits at the end rather than above
            the thing you came for. */}
        <span>
          MCP is on.{' '}
          <button
            type="button"
            onClick={() => void run('disable')}
            disabled={busy}
            title="Revokes the link and disconnects any connected client"
            className="font-medium underline decoration-(--line) underline-offset-2 transition-colors hover:text-(--ink) disabled:opacity-60"
          >
            {busy ? 'Turning off…' : 'Turn it off'}
          </button>
        </span>
      </div>
      {error && <p className="text-xs text-(--danger)">{error}</p>}
    </div>
  )
}

/** One numbered step. The number is a real element, not a list marker, so it
 *  keeps its column when a step wraps to two lines. */
function Step({
  n,
  label,
  children,
}: {
  n: number
  label: string
  children?: React.ReactNode
}) {
  return (
    <li className="flex w-full gap-2.5">
      <span className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--accent-bg) text-xs font-semibold text-(--ink)">
        {n}
      </span>
      <span className="min-w-0 flex-1">
        {label && <span className="block text-sm leading-[1.45] text-(--ink)">{label}</span>}
        {children && <span className={label ? 'mt-2 block' : 'block'}>{children}</span>}
      </span>
    </li>
  )
}

