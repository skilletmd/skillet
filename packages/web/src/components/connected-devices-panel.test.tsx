import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConnectedDevicesPanel } from './connected-devices-panel'

const devicePending = {
  device_id: 'dev-1',
  label: 'MacBook',
  created_at: 100,
  agents: [] as string[],
  agents_reported_at: null as number | null,
}

const deviceReported = {
  ...devicePending,
  agents: ['cursor', 'claude-code'],
  agents_reported_at: 1_700_000_000,
}

const emptyMine = { owned: [], member: [], subscribed: [], author_kits: [] }

const REGISTRY_DEVICES_LIST = /\/api\/registry\/api\/v1\/devices$/

function isDevicesListRequest(url: string): boolean {
  return REGISTRY_DEVICES_LIST.test(url.replace(/\?.*$/, ''))
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

describe('ConnectedDevicesPanel', () => {
  let devicesFetchCount = 0
  let devicesBody: typeof devicePending | typeof deviceReported = devicePending

  beforeEach(() => {
    devicesFetchCount = 0
    devicesBody = devicePending
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/devices/dev-1/sync')) {
          return jsonResponse({ excluded: [] })
        }
        if (url.includes('/kits/mine')) {
          return jsonResponse(emptyMine)
        }
        if (url.includes('/delegations')) {
          return jsonResponse({ delegations: [] })
        }
        if (isDevicesListRequest(url)) {
          devicesFetchCount += 1
          if (devicesFetchCount > 1) {
            devicesBody = deviceReported
          }
          return jsonResponse({ devices: [devicesBody] })
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }) as unknown as typeof fetch,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows runtimes after polling when sync reports agents', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<ConnectedDevicesPanel />)

    await waitFor(() => {
      expect(screen.getByText(/No runtimes/)).toBeInTheDocument()
    })

    await vi.advanceTimersByTimeAsync(3000)

    await waitFor(() => {
      expect(screen.getByTitle('Cursor')).toBeInTheDocument()
    })
    expect(screen.getByTitle('Claude Code')).toBeInTheDocument()
  })

  it('does not poll when every sync device already reported runtimes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    devicesBody = deviceReported

    render(<ConnectedDevicesPanel />)

    await waitFor(() => {
      expect(screen.getByTitle('Cursor')).toBeInTheDocument()
    })

    const countAfterLoad = devicesFetchCount
    await vi.advanceTimersByTimeAsync(12_000)
    expect(devicesFetchCount).toBe(countAfterLoad)
  })

  it('stops runtime polling after the max wait when sync never reports', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/devices/dev-1/sync')) {
          return jsonResponse({ excluded: [] })
        }
        if (url.includes('/kits/mine')) {
          return jsonResponse(emptyMine)
        }
        if (url.includes('/delegations')) {
          return jsonResponse({ delegations: [] })
        }
        if (isDevicesListRequest(url)) {
          devicesFetchCount += 1
          return jsonResponse({ devices: [devicePending] })
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }) as unknown as typeof fetch,
    )

    render(<ConnectedDevicesPanel />)

    await waitFor(() => {
      expect(screen.getByText(/No runtimes/)).toBeInTheDocument()
    })

    const countAfterLoad = devicesFetchCount
    await vi.advanceTimersByTimeAsync(40 * 3000 + 1000)
    expect(devicesFetchCount).toBe(countAfterLoad + 40)

    await vi.advanceTimersByTimeAsync(12_000)
    expect(devicesFetchCount).toBe(countAfterLoad + 40)
  })

  it('keeps showing the placeholder when a poll fetch fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (isDevicesListRequest(url)) {
        devicesFetchCount += 1
        if (devicesFetchCount === 1) {
          return jsonResponse({ devices: [devicePending] })
        }
        return { ok: false, status: 500, json: async () => ({}) }
      }
      if (url.includes('/delegations')) return jsonResponse({ delegations: [] })
      if (url.includes('/kits/mine')) return jsonResponse(emptyMine)
      if (url.includes('/sync')) return jsonResponse({ excluded: [] })
      return { ok: false, status: 404, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    render(<ConnectedDevicesPanel />)

    await waitFor(() => {
      expect(screen.getByText(/No runtimes/)).toBeInTheDocument()
    })

    await vi.advanceTimersByTimeAsync(3000)

    expect(screen.getByText(/No runtimes/)).toBeInTheDocument()
  })

  it('closes the Connect hub when the pairing it opened completes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let minted = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/connect/codes')) {
          minted = true
          return jsonResponse({
            code: '99MZGKAU',
            expires_at: Math.floor(Date.now() / 1000) + 300,
            ttl_sec: 300,
          })
        }
        if (url.includes('/delegations')) return jsonResponse({ delegations: [] })
        if (url.includes('/sync')) return jsonResponse({ excluded: [] })
        if (url.includes('/kits/mine')) return jsonResponse(emptyMine)
        if (isDevicesListRequest(url)) {
          return jsonResponse({
            devices: minted
              ? [deviceReported, { ...deviceReported, device_id: 'dev-2', label: 'devbox' }]
              : [deviceReported],
          })
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }) as unknown as typeof fetch,
    )

    render(<ConnectedDevicesPanel />)
    await waitFor(() => {
      expect(screen.getByText('MacBook')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Connection' }))
    await waitFor(() => {
      expect(screen.getByText(/Where should your skills go/)).toBeInTheDocument()
    })

    // Next poll delivers the freshly-paired device → toast + hub closes.
    await vi.advanceTimersByTimeAsync(3000)
    await waitFor(() => {
      expect(screen.getByText(/Connected devbox/)).toBeInTheDocument()
    })
    expect(screen.getByText('devbox')).toBeInTheDocument()
    // The hub slides shut (HUB_COLLAPSE_MS) before unmounting.
    await waitFor(() => {
      expect(screen.queryByText(/Where should your skills go/)).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Add Connection' })).toBeInTheDocument()
  })

  it('toasts when a device disconnects itself and the tab regains focus', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/delegations')) return jsonResponse({ delegations: [] })
        if (url.includes('/sync')) return jsonResponse({ excluded: [] })
        if (url.includes('/kits/mine')) return jsonResponse(emptyMine)
        if (isDevicesListRequest(url)) {
          calls += 1
          // First load has the device; after the desktop signs out, gone.
          return jsonResponse({ devices: calls === 1 ? [deviceReported] : [] })
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }) as unknown as typeof fetch,
    )

    render(<ConnectedDevicesPanel />)
    await waitFor(() => {
      expect(screen.getByText('MacBook')).toBeInTheDocument()
    })

    fireEvent(window, new Event('focus'))

    await waitFor(() => {
      expect(screen.getByText(/MacBook disconnected/)).toBeInTheDocument()
    })
    expect(screen.queryByText('MacBook')).not.toBeInTheDocument()
  })

  it('does not toast when one half of a collapsed machine signs out', async () => {
    // Desktop + CLI share a machine_id and collapse to one card whose
    // representative is the most-recently-seen row. Signing out the desktop
    // swaps the representative to the CLI row; that must read as "nothing
    // changed", not remove+add (which used to toast a false "Connected").
    const desktop = {
      ...deviceReported,
      device_id: 'dev-desktop',
      client_kind: 'desktop',
      machine_id: 'mach-1',
      last_seen_at: 200,
    }
    const cli = {
      ...deviceReported,
      device_id: 'dev-cli',
      client_kind: 'cli',
      machine_id: 'mach-1',
      last_seen_at: 100,
    }
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/delegations')) return jsonResponse({ delegations: [] })
        if (url.includes('/sync')) return jsonResponse({ excluded: [] })
        if (url.includes('/kits/mine')) return jsonResponse(emptyMine)
        if (isDevicesListRequest(url)) {
          calls += 1
          return jsonResponse({ devices: calls === 1 ? [desktop, cli] : [cli] })
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }) as unknown as typeof fetch,
    )

    render(<ConnectedDevicesPanel />)
    await waitFor(() => {
      expect(screen.getByText('MacBook')).toBeInTheDocument()
    })

    fireEvent(window, new Event('focus'))
    await waitFor(() => {
      expect(calls).toBeGreaterThan(1)
    })

    expect(screen.getByText('MacBook')).toBeInTheDocument()
    expect(screen.queryByText(/Connected MacBook/)).not.toBeInTheDocument()
    expect(screen.queryByText(/disconnected/)).not.toBeInTheDocument()
  })

  it('collapses to the list when only the MCP link is connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/delegations')) return jsonResponse({ delegations: [] })
        if (isDevicesListRequest(url)) return jsonResponse({ devices: [] })
        return { ok: false, status: 404, json: async () => ({}) }
      }) as unknown as typeof fetch,
    )

    render(
      <ConnectedDevicesPanel
        mcpLink={{
          ok: true,
          enabled: true,
          link: { url: 'https://r.test/api/v1/mcp/tok', token: 'tok', created_at: 1, last_used_at: null, clients: [] },
        }}
        mcpRow={<li>MCP row</li>}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('MCP row')).toBeInTheDocument()
    })
    // No expanded connect hub by default — it lives behind the Add Device row.
    expect(screen.queryByText(/stay in sync everywhere/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Connection' })).toBeInTheDocument()
  })

  it('leads with the Connect hub when nothing at all is connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/delegations')) return jsonResponse({ delegations: [] })
        if (isDevicesListRequest(url)) return jsonResponse({ devices: [] })
        return { ok: false, status: 404, json: async () => ({}) }
      }) as unknown as typeof fetch,
    )

    render(<ConnectedDevicesPanel mcpLink={{ ok: true, enabled: false }} />)

    await waitFor(() => {
      expect(screen.getByText(/stay in sync everywhere/)).toBeInTheDocument()
    })
  })
})
