/**
 * Onboarding when the CLI got there first (plan U13; R27 R28 R29, KTD11).
 *
 * The app and the CLI share `~/.skillet`, so a computer the pasted line
 * already connected starts at sync with no second sign-in, and one nobody
 * connected leads with "Open my map", whose Save connects it. The pair code
 * stays as the fallback. Every CLI answer is mocked `auth status --json`
 * output, and the connection files' stamps are mocked `auth_file_stamps`; the
 * flow only ever sees them through the app's invoke.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOnboardingFlow,
  readOnboardingAuth,
  welcomeActionsHtml,
  welcomeAgents,
  welcomeAgentsHtml,
  type OnboardingStep,
} from './onboarding-flow'

const UNCONNECTED = JSON.stringify({
  ok: false,
  bearer: { kind: 'none', tokenPreview: null },
  identity: null,
  whoami: null,
  linked_machine: false,
  credential_rejected: false,
  device_label: null,
  hints: [],
})

/** What `auth status --json` says once `skillet map`'s Save connected this computer. */
const CONNECTED = JSON.stringify({
  bearer: { kind: 'device', tokenPreview: 'sk_dev_conta…' },
  identity: null,
  whoami: { handle: 'test-handle', avatar_url: null, device_id: 'd1', user_id: 'u1', author_key_id: null, scopes: [] },
  linked_machine: true,
  credential_rejected: false,
  device_label: 'test-machine',
  hints: [],
})

/**
 * The app's invoke, answering only what onboarding may call. `auth status`
 * answers from `answer`, and `connect()` is the map's Save landing: it writes
 * `device.json`, which moves that file's stamp. A pair-code connect is a test
 * failure here.
 */
function fakeApp(answer: string = UNCONNECTED) {
  const calls: string[] = []
  let writes = 0
  const invoke = vi.fn(async (cmd: string): Promise<unknown> => {
    calls.push(cmd)
    if (cmd === 'auth_status') return answer
    if (cmd === 'auth_file_stamps') return [writes === 0 ? null : `device.json@${writes}`, null]
    if (cmd === 'open_map') return ''
    throw new Error(`onboarding must not call ${cmd}`)
  })
  const connect = (next = CONNECTED): void => {
    answer = next
    writes++
  }
  return { invoke, calls, connect }
}

function flowOn(app: ReturnType<typeof fakeApp>) {
  const steps: OnboardingStep[] = []
  const onConnected = vi.fn()
  const flow = createOnboardingFlow({
    authStatus: () => app.invoke('auth_status') as Promise<string>,
    authStamps: () => app.invoke('auth_file_stamps') as Promise<(string | null)[]>,
    openMap: async () => {
      await app.invoke('open_map')
    },
    onStep: (step) => steps.push(step),
    onConnected,
    pollMs: 2_000,
  })
  return { flow, steps, onConnected }
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('onboarding after the line connected this computer (R27)', () => {
  it('a connected computer starts onboarding at sync', async () => {
    const app = fakeApp(CONNECTED)
    const { flow, steps, onConnected } = flowOn(app)
    await flow.start()
    expect(flow.step).toBe('sync')
    expect(steps).toEqual(['sync'])
    expect(onConnected).toHaveBeenCalledWith({ connected: true, handle: 'test-handle' }, 'already')
    expect(app.calls).toEqual(['auth_file_stamps', 'auth_status'])
  })

  it('reads auth status the way the tray does', () => {
    expect(readOnboardingAuth(CONNECTED)).toEqual({ connected: true, handle: 'test-handle' })
    expect(readOnboardingAuth(UNCONNECTED)).toEqual({ connected: false, handle: null })
    expect(readOnboardingAuth('')).toEqual({ connected: false, handle: null })
    expect(readOnboardingAuth('{"ok":false,"bearer":{"kind":"none","tokenPreview":null}}')).toEqual({
      connected: false,
      handle: null,
    })
  })
})

describe('onboarding on a computer nobody connected (KTD11)', () => {
  it('an unconnected computer\'s onboarding leads with "Open my map"; after a dropped-folder Save in a signed-in browser it connects through that Save\'s confirm with no pair code', async () => {
    vi.useFakeTimers()
    // Unconnected at launch, still unconnected at the first look after the
    // map opens, then connected: the browser was already signed in from the
    // dropped-folder Save, so the map's Save was one confirm.
    const app = fakeApp(UNCONNECTED)
    const { flow, steps, onConnected } = flowOn(app)
    await flow.start()
    expect(flow.step).toBe('welcome')

    document.body.innerHTML = welcomeActionsHtml()
    const buttons = [...document.querySelectorAll('button')]
    expect(buttons[0]!.id).toBe('ob-open-map')
    expect(buttons[0]!.textContent).toBe('Open my map')
    expect(buttons[0]!.classList.contains('ob-cta')).toBe(true)
    expect(document.getElementById('ob-pair')?.classList.contains('ob-skip')).toBe(true)

    expect(await flow.openMap()).toEqual({ ok: true })
    expect(flow.step).toBe('map')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(flow.step).toBe('map')
    // The map's Save lands: it writes this computer's connection, and the next look sees it.
    app.connect()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(flow.step).toBe('sync')
    expect(steps).toEqual(['welcome', 'map', 'sync'])
    expect(onConnected).toHaveBeenCalledTimes(1)
    expect(onConnected).toHaveBeenCalledWith({ connected: true, handle: 'test-handle' }, 'map')
    // Looks only stat the connection files; `auth status` runs again only once one changed.
    expect(app.calls).toEqual(['auth_file_stamps', 'auth_status', 'open_map', 'auth_file_stamps', 'auth_file_stamps', 'auth_status'])
    expect(app.calls).not.toContain('connect')

    // Connected: no more looking.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(app.calls).toHaveLength(6)
  })

  it('while the map is open and nothing writes the connection files, auth status never runs again', async () => {
    vi.useFakeTimers()
    const app = fakeApp(UNCONNECTED)
    const { flow, steps } = flowOn(app)
    await flow.start()
    await flow.openMap()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(flow.step).toBe('map')
    expect(steps).toEqual(['welcome', 'map'])
    expect(app.calls.filter((call) => call === 'auth_status')).toHaveLength(1)
    expect(app.calls.filter((call) => call === 'auth_file_stamps').length).toBeGreaterThan(20)
  })

  it('a credential the account did not confirm, or files it cannot stat, keep auth status asked at every look', async () => {
    vi.useFakeTimers()
    // A device token the registry couldn't confirm: confirming it later writes no file.
    const unconfirmed = JSON.stringify({ ...JSON.parse(UNCONNECTED), bearer: { kind: 'device', tokenPreview: 'sk_dev_conta…' } })
    const app = fakeApp(unconfirmed)
    const { flow } = flowOn(app)
    await flow.start()
    await flow.openMap()
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(app.calls.filter((call) => call === 'auth_status')).toHaveLength(3)

    const blind = fakeApp(UNCONNECTED)
    const steps: OnboardingStep[] = []
    const blindFlow = createOnboardingFlow({
      authStatus: () => blind.invoke('auth_status') as Promise<string>,
      authStamps: async () => {
        throw new Error('auth_file_stamps is not a command this app knows')
      },
      openMap: async () => undefined,
      onStep: (step) => steps.push(step),
      onConnected: vi.fn(),
      pollMs: 2_000,
    })
    await blindFlow.start()
    await blindFlow.openMap()
    blind.connect()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(blindFlow.step).toBe('sync')
    expect(steps).toEqual(['welcome', 'map', 'sync'])
  })

  it('keeps the pair code as the fallback, and stops waiting on the map once it is chosen', async () => {
    vi.useFakeTimers()
    const app = fakeApp(UNCONNECTED)
    const { flow, steps, onConnected } = flowOn(app)
    await flow.start()
    await flow.openMap()
    flow.usePairCode()
    expect(flow.step).toBe('link')
    const looked = app.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(app.calls).toHaveLength(looked)
    expect(steps).toEqual(['welcome', 'map', 'link'])
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('a map that would not open stays on welcome and says so', async () => {
    const app = fakeApp(UNCONNECTED)
    const steps: OnboardingStep[] = []
    const flow = createOnboardingFlow({
      authStatus: () => app.invoke('auth_status') as Promise<string>,
      authStamps: () => app.invoke('auth_file_stamps') as Promise<(string | null)[]>,
      openMap: async () => {
        throw new Error('skillet CLI not found')
      },
      onStep: (step) => steps.push(step),
      onConnected: vi.fn(),
    })
    await flow.start()
    const opened = await flow.openMap()
    expect(opened.ok).toBe(false)
    expect(opened.error).toMatch(/pair code/)
    expect(flow.step).toBe('welcome')
    expect(steps).toEqual(['welcome'])
  })

  it('an auth check that never answers still shows welcome', async () => {
    vi.useFakeTimers()
    const steps: OnboardingStep[] = []
    const flow = createOnboardingFlow({
      authStatus: () => new Promise<string>(() => undefined),
      authStamps: async () => [null, null],
      openMap: async () => undefined,
      onStep: (step) => steps.push(step),
      onConnected: vi.fn(),
    })
    const started = flow.start()
    await vi.advanceTimersByTimeAsync(5_000)
    await started
    expect(flow.step).toBe('welcome')
    expect(steps).toEqual(['welcome'])
  })
})

describe('the welcome chips count only what this computer has (R29)', () => {
  const logo = (name: string) => `<svg data-logo="${name}"></svg>`

  it('no detected tools shows no chips and one plain line', () => {
    document.body.innerHTML = welcomeAgentsHtml([], logo, 'this Mac')
    expect(document.querySelectorAll('.ob-agent')).toHaveLength(0)
    const lines = document.body.children
    expect(lines).toHaveLength(1)
    expect(lines[0]!.textContent).toBe('No AI tools on this Mac yet.')
  })

  it('shows the detected tools only, with no stock list and no "+ more"', () => {
    const agents = welcomeAgents(
      [
        { name: 'claude-code', label: 'Claude Code' },
        { name: 'codex', label: 'Universal' },
        { name: 'hermes' },
      ],
      (name) => (name === 'hermes' ? 'Hermes' : name),
    )
    expect(agents).toEqual([
      { name: 'claude-code', label: 'Claude Code' },
      { name: 'hermes', label: 'Hermes' },
    ])
    document.body.innerHTML = welcomeAgentsHtml(agents, logo, 'this Mac')
    const chips = [...document.querySelectorAll('.ob-agent')]
    expect(chips.map((c) => c.textContent)).toEqual(['Claude Code', 'Hermes'])
    expect(document.body.textContent).not.toMatch(/more|Cursor|Codex|Devin/)
  })

  it('escapes a label the CLI reports', () => {
    document.body.innerHTML = welcomeAgentsHtml([{ name: 'x', label: '<img src=x onerror=alert(1)>' }], logo, 'this Mac')
    expect(document.querySelector('img')).toBe(null)
    expect(document.querySelector('.ob-agent')!.textContent).toBe('<img src=x onerror=alert(1)>')
  })
})
