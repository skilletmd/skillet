import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceKitSync } from '@/components/device-kit-sync'

const fetchMock = vi.fn()

vi.mock('@/lib/registry-proxy', () => ({
  registryAuthApi: (path: string) => `/api/registry/api/v1/${path}`,
}))

const minePayload = {
  owned: [
    {
      id: 'partner-kit',
      owner: 'thiago',
      name: 'partner-kit',
      skills: [{ skill_id: 'skillet:commit-message' }],
    },
  ],
  member: [],
  subscribed: [],
  author_kits: [],
}

function installFetchHandlers({
  excluded = [] as string[],
  putStatus = 200,
}: {
  excluded?: string[]
  putStatus?: number
} = {}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('kits/mine')) {
      return Promise.resolve(new Response(JSON.stringify(minePayload), { status: 200 }))
    }
    if (url.includes('/sync') && (!init?.method || init.method === 'GET')) {
      return Promise.resolve(new Response(JSON.stringify({ excluded }), { status: 200 }))
    }
    if (url.includes('/sync') && init?.method === 'PUT') {
      if (putStatus !== 200) {
        return Promise.resolve(new Response('{}', { status: putStatus }))
      }
      const body = JSON.parse(init.body as string) as { excluded: string[] }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 404 }))
  })
}

describe('DeviceKitSync', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    installFetchHandlers()
  })

  it('persists kit exclusion via PUT on toggle', async () => {
    const user = userEvent.setup()
    render(<DeviceKitSync label="MacBook" deviceId="dev-1" />)

    await waitFor(() => {
      expect(screen.getByText('partner-kit')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Expand kits' }))
    await user.click(screen.getByRole('switch', { name: 'Sync partner-kit to this device' }))

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/sync') && (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse((putCall![1] as RequestInit).body as string) as { excluded: string[] }
      expect(body.excluded).toEqual(['kit:partner-kit'])
    })
  })

  it('reverts toggle and shows error when PUT fails', async () => {
    installFetchHandlers({ putStatus: 405 })
    const user = userEvent.setup()
    render(<DeviceKitSync label="MacBook" deviceId="dev-1" />)

    await waitFor(() => {
      expect(screen.getByText('partner-kit')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Expand kits' }))
    const toggle = screen.getByRole('switch', { name: 'Sync partner-kit to this device' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    await user.click(toggle)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not save kit sync settings.')
    })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })
})
