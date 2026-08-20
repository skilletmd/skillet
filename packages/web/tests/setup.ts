import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Tests run in the dev-auth posture: no real SKILLET_WEB_SIGNING_SECRET is set,
// so webInternalSecret() would fail closed. Opt into the same explicit dev-auth
// gate local dev uses; the signing path then uses a per-process random placeholder
// (the registry verifier ignores it in dev-auth mode). Tests asserting the
// fail-closed throw stub this back to undefined per-case.
process.env.SKILLET_ENABLE_DEV_AUTH ??= '1'

// A dev shell that points the desktop app at a local registry exports
// SKILLET_WEB_URL / SKILLET_REGISTRY_URL / SKILLET_DIR. Scrub them so the suite
// is hermetic against the developer's shell; tests exercising override paths
// set the vars themselves.
delete process.env.SKILLET_WEB_URL
delete process.env.SKILLET_REGISTRY_URL
delete process.env.SKILLET_DIR

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}))

vi.mock('server-only', () => ({}))

// Radix Tooltip.Root requires a TooltipProvider ancestor; the app mounts one
// once in the root layout (shared skip-delay). Give unit-test renders the same
// default so components using <Tooltip> render without each test wiring the
// provider. A test-supplied `wrapper` option still wins.
vi.mock('@testing-library/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@testing-library/react')>()
  const { TooltipProvider } = await import('@/components/ui/tooltip')
  const render = ((ui: Parameters<typeof actual.render>[0], options?: Parameters<typeof actual.render>[1]) =>
    actual.render(ui, { wrapper: TooltipProvider, ...options })) as typeof actual.render
  return { ...actual, render }
})

// Default next-auth stub so components that call `useSession` (e.g. the Add
// controls) render outside a SessionProvider in unit tests. Defaults to a
// signed-out session; tests that need a specific session declare their own
// per-file `vi.mock('next-auth/react', …)`, which overrides this.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated', update: vi.fn() }),
  SessionProvider: ({ children }: { children: unknown }) => children,
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
    get length() {
      return Object.keys(store).length
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// jsdom lacks the pointer-capture / scroll / resize-observer APIs that Radix
// (dropdown menus, popovers) calls during open/close. Stub them so menu tests run.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
Object.assign(HTMLElement.prototype, {
  hasPointerCapture: HTMLElement.prototype.hasPointerCapture ?? (() => false),
  setPointerCapture: HTMLElement.prototype.setPointerCapture ?? (() => {}),
  releasePointerCapture: HTMLElement.prototype.releasePointerCapture ?? (() => {}),
  scrollIntoView: HTMLElement.prototype.scrollIntoView ?? (() => {}),
})
