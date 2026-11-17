/**
 * Onboarding's first steps when the CLI may have been there first (plan U13;
 * R27 R28 R29, KTD11).
 *
 * The app and the CLI share `~/.skillet`, so onboarding reads `auth status`
 * before it shows a step. A computer the pasted line already connected starts
 * at sync, with no second sign-in (R27). One nobody connected leads with
 * "Open my map", the same `skillet map` the line runs (R28). Its Save
 * connects the computer through the browser, which after a dropped-folder
 * Save is already signed in, so that's one confirm. While the map is open,
 * onboarding looks at `auth status` every few seconds and moves to sync the
 * moment the Save lands. The pair code stays as the fallback.
 */
import { parseCliJson } from './cli-json'
import { escapeHtml } from './escape-html'
import { resolveTrayAuthPresentation, type TrayAuthInput } from './tray-auth-presentation'

/** `start` is the blank moment before `auth status` answers. `map`: the map is open and onboarding waits for its Save. */
export type OnboardingStep = 'start' | 'welcome' | 'map' | 'link' | 'sync' | 'permission'

export interface OnboardingAuth {
  connected: boolean
  handle: string | null
}

const NOT_CONNECTED: OnboardingAuth = { connected: false, handle: null }

/** `auth status --json`, read with the tray's own rule for a connected computer. Anything unreadable is not connected. */
export function readOnboardingAuth(raw: string): OnboardingAuth {
  let auth: unknown
  try {
    auth = parseCliJson<unknown>(raw, 'auth status')
  } catch {
    return NOT_CONNECTED
  }
  if (typeof auth !== 'object' || auth === null || !('bearer' in auth)) return NOT_CONNECTED
  const shown = resolveTrayAuthPresentation(auth as TrayAuthInput)
  return shown.tier === 'linked' ? { connected: true, handle: shown.displayHandle } : NOT_CONNECTED
}

// ── The welcome step ────────────────────────────────────────────────────────

export interface WelcomeAgent {
  name: string
  label: string
}

/** The detected tools for the welcome row (R29). "Universal" is a shared folder, not a tool anyone knows. */
export function welcomeAgents(
  detected: readonly { name: string; label?: string }[],
  pretty: (name: string) => string,
): WelcomeAgent[] {
  const agents: WelcomeAgent[] = []
  for (const agent of detected) {
    const label = agent.label ?? pretty(agent.name)
    if (label === 'Universal' || agents.some((a) => a.label === label)) continue
    agents.push({ name: agent.name, label })
  }
  return agents
}

/** One lockup per tool this computer has, or one plain line when it has none. Never a stock list. */
export function welcomeAgentsHtml(
  agents: readonly WelcomeAgent[],
  logo: (name: string) => string | null,
  noun: string,
): string {
  if (agents.length === 0) return `<div class="ob-note">${escapeHtml(`No AI tools on ${noun} yet.`)}</div>`
  const chips = agents
    .map((a) => `<span class="ob-agent">${logo(a.name) ?? ''}${escapeHtml(a.label)}</span>`)
    .join('')
  return `<div class="ob-agents">${chips}</div>`
}

/**
 * The lead action and its fallback. `reopen` is the map step's label for the
 * same button: the map is already open in the browser.
 */
export function welcomeActionsHtml(noun = 'this computer', opts: { reopen?: boolean; message?: string } = {}): string {
  const message = opts.message ? `<div class="ob-msg">${escapeHtml(opts.message)}</div>` : ''
  return `${message}<button class="ob-cta" id="ob-open-map">${opts.reopen ? 'Open it again' : 'Open my map'}</button>
        <div class="ob-fine">${escapeHtml(`Nothing leaves ${noun} until you save.`)}</div>
        <button class="ob-skip" id="ob-pair">Use a pair code</button>`
}

// ── The flow ────────────────────────────────────────────────────────────────

export interface OnboardingFlowDeps {
  /** `auth status --json` (Tauri `auth_status`). */
  authStatus(): Promise<string>
  /** Start `skillet map` (Tauri `open_map`). */
  openMap(): Promise<unknown>
  /** Every step change, to repaint. */
  onStep(step: OnboardingStep): void
  /** Connected with no pair code: it already was, or the map's Save just did it. Called before the step moves to sync. */
  onConnected(auth: OnboardingAuth, how: 'already' | 'map'): void
  /** How often to look at `auth status` while the map is open. */
  pollMs?: number
  /** How long the first `auth status` may take before welcome shows anyway. */
  startWaitMs?: number
  /** How long to keep looking: the map closes itself after 30 idle minutes. */
  waitMs?: number
}

export interface OnboardingFlow {
  readonly step: OnboardingStep
  /** Read `auth status` and pick the first step. */
  start(): Promise<void>
  /** Open the map and wait for its Save. */
  openMap(): Promise<{ ok: boolean; error?: string }>
  /** The fallback: the pair-code step. */
  usePairCode(): void
  go(step: OnboardingStep): void
  stop(): void
}

export function createOnboardingFlow(deps: OnboardingFlowDeps): OnboardingFlow {
  const pollMs = deps.pollMs ?? 3_000
  const startWaitMs = deps.startWaitMs ?? 4_000
  const waitMs = deps.waitMs ?? 35 * 60_000
  let step: OnboardingStep = 'start'
  let timer: ReturnType<typeof setTimeout> | null = null
  let waitingSince = 0

  const stopWaiting = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const go = (next: OnboardingStep): void => {
    if (next !== 'map') stopWaiting()
    if (step === next) return
    step = next
    deps.onStep(next)
  }
  const connect = (auth: OnboardingAuth, how: 'already' | 'map'): void => {
    stopWaiting()
    deps.onConnected(auth, how)
    go('sync')
  }
  const read = async (): Promise<OnboardingAuth> => {
    try {
      return readOnboardingAuth(await deps.authStatus())
    } catch {
      return NOT_CONNECTED
    }
  }

  const look = async (): Promise<void> => {
    timer = null
    if (step !== 'map') return
    const auth = await read()
    // The person moved on while the CLI answered.
    if (step !== 'map') return
    if (auth.connected) {
      connect(auth, 'map')
      return
    }
    if (Date.now() - waitingSince < waitMs && timer === null) timer = setTimeout(() => void look(), pollMs)
  }

  return {
    get step() {
      return step
    },
    async start() {
      const answer = read()
      let fallback: ReturnType<typeof setTimeout> | undefined
      const slow = new Promise<null>((done) => {
        fallback = setTimeout(() => done(null), startWaitMs)
      })
      const auth = await Promise.race([answer, slow])
      clearTimeout(fallback)
      if (auth === null) {
        go('welcome')
        // A late answer that says connected still moves someone who hasn't started.
        void answer.then((late) => {
          if (late.connected && step === 'welcome') connect(late, 'already')
        })
        return
      }
      if (auth.connected) connect(auth, 'already')
      else go('welcome')
    },
    async openMap() {
      try {
        await deps.openMap()
      } catch {
        return { ok: false, error: 'Your map didn’t open. Use a pair code instead.' }
      }
      waitingSince = Date.now()
      go('map')
      if (timer === null) timer = setTimeout(() => void look(), pollMs)
      return { ok: true }
    },
    usePairCode() {
      go('link')
    },
    go,
    stop: stopWaiting,
  }
}
