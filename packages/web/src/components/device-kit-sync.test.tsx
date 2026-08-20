import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DeviceKitSync } from './device-kit-sync'

function renderRow(onDisconnect: () => void) {
  // syncCapable={false} keeps the row self-contained (no kits/mine fetch) —
  // the confirm flow under test is identical on sync-capable rows.
  return render(
    <ul>
      <DeviceKitSync
        label="test-machine"
        syncCapable={false}
        statusLine="Not syncing."
        onDisconnect={onDisconnect}
      />
    </ul>,
  )
}

describe('DeviceKitSync disconnect confirm', () => {
  it('asks in an in-house dialog, not window.confirm, and only disconnects on confirm', async () => {
    const onDisconnect = vi.fn()
    const nativeConfirm = vi.fn()
    vi.stubGlobal('confirm', nativeConfirm)
    renderRow(onDisconnect)

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/stay put/)).toBeInTheDocument()
    expect(nativeConfirm).not.toHaveBeenCalled()

    // Cancel closes without disconnecting.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Confirming runs the disconnect.
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const reopened = await screen.findByRole('dialog')
    fireEvent.click(within(reopened).getByRole('button', { name: 'Disconnect' }))
    expect(onDisconnect).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })
})

describe('DeviceKitSync icon cluster', () => {
  function renderKinds(props: {
    clientKinds?: string[] | null
    clientKind?: string | null
    clientPlatform?: string | null
    label?: string
  }) {
    return render(
      <ul>
        <DeviceKitSync
          label={props.label ?? 'iMac'}
          syncCapable={false}
          statusLine="Not syncing."
          clientKind={props.clientKind}
          clientKinds={props.clientKinds}
          clientPlatform={props.clientPlatform}
        />
      </ul>,
    )
  }

  it('renders one tile for the machine, combined label on the wrapper (AE2)', () => {
    renderKinds({ clientKinds: ['cli', 'desktop'], clientPlatform: 'macos' })
    const cluster = screen.getByTestId('device-kind-icons')
    // One machine, one tile; the "Mac app and CLI" nuance rides the aria-label.
    expect(cluster.getAttribute('aria-label')).toBe('Mac app and CLI')
    expect(cluster.children.length).toBe(1)
  })

  it('renders a single tile for single-kind machines', () => {
    renderKinds({ clientKinds: ['cli'] })
    const cluster = screen.getByTestId('device-kind-icons')
    expect(cluster.getAttribute('aria-label')).toBe('CLI')
    expect(cluster.children.length).toBe(1)
  })

  it('falls back to the legacy single icon when client_kinds is absent (R9)', () => {
    renderKinds({ clientKind: 'desktop', clientPlatform: 'windows' })
    const cluster = screen.getByTestId('device-kind-icons')
    expect(cluster.getAttribute('aria-label')).toBe('Windows app')
    expect(cluster.children.length).toBe(1)
  })

  it('renders one generic tile for an empty kinds array, never falling back', () => {
    renderKinds({ clientKinds: [], clientKind: 'desktop', clientPlatform: 'macos' })
    const cluster = screen.getByTestId('device-kind-icons')
    // Not the Mac app fallback: kinds info exists and says "none".
    expect(cluster.getAttribute('aria-label')).toBe('Device')
    expect(cluster.children.length).toBe(1)
  })

  it('renders no tile for unknown kind values, without crashing', () => {
    renderKinds({ clientKinds: ['web'] })
    const cluster = screen.getByTestId('device-kind-icons')
    expect(cluster.getAttribute('aria-label')).toBe('Device')
    expect(cluster.children.length).toBe(1)
  })
})
