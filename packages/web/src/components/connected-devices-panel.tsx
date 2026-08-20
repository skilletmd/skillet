'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Plus } from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/empty-state'
import { Notice } from '@/components/ui/notice'
import { Shimmer } from '@/components/ui/shimmer'
import { SettingsList } from '@/components/ui/settings-list'
import { SettingsSection } from '@/components/ui/setting-section'
import { DeviceKitSync } from '@/components/device-kit-sync'
import { deleteBearerDevice } from '@/lib/disconnect-device'
import { patchBearerDeviceLabel } from '@/lib/device-label'
import { fetchDelegations } from '@/lib/enroll-device'
import {
  normalizeAccountDevices,
  rowKey,
  syncDevicePendingRuntimeReport,
  type AccountDeviceRow,
} from '@/lib/account-devices'
import { revokeDelegationSession } from '@/lib/revoke-delegation'
import { fetchRegistryWithRetry } from '@/lib/registry-proxy'
import { MachinePairCodePanel } from '@/components/machine-pair-code-panel'
import { McpConnectorDetails } from '@/components/settings/mcp-connector-details'
import { McpEnableButton } from '@/components/settings/mcp-enable-button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { McpLinkResult } from '@/lib/mcp-link'

const DEVICE_POLL_MS = 3000
const RUNTIME_REPORT_MAX_POLLS = 40

interface BearerDevice {
  device_id: string
  label: string | null
  created_at: number
  agents?: string[]
  agents_reported_at?: number | null
  last_seen_at?: number | null
  client_kind?: string | null
  client_kinds?: string[] | null
  client_platform?: string | null
  machine_id?: string | null
}

async function loadAccountDevices(signal?: AbortSignal): Promise<AccountDeviceRow[]> {
  const [syncRes, delegations] = await Promise.all([
    fetchRegistryWithRetry('devices', { signal }),
    fetchDelegations(signal),
  ])
  if (!syncRes.ok) throw new Error(`Could not load devices (${syncRes.status})`)
  const body = (await syncRes.json()) as { devices?: BearerDevice[] }
  return normalizeAccountDevices(body.devices ?? [], delegations)
}

type ConnectPath = 'computer' | 'cloud' | 'mcp'

/** The hub's MCP path, self-contained: Enable when the link is off; once on,
 * the shared client tabs + steps + link (no manage actions here — those live
 * on the MCP row). */
function McpHubPath({ link }: { link: Extract<McpLinkResult, { ok: true }> }) {
  if (!link.enabled) {
    return (
      <div className="mt-5 flex w-full flex-col gap-3">
        <p className="text-center text-sm leading-relaxed text-(--ink-2)">
          One private link that serves your skills to ChatGPT, Claude.ai, and any other MCP
          client. Read-only, disable anytime.
        </p>
        <div className="flex justify-center">
          <McpEnableButton />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-5 flex w-full flex-col gap-3">
      {/* Same shape as the other two paths: one standalone line saying what
          this is, then the how. */}
      <p className="text-center text-sm leading-relaxed text-(--ink-2)">
        One private link that serves your skills to ChatGPT, Claude.ai, and any other MCP client.
      </p>
      <McpConnectorDetails url={link.link.url} />
    </div>
  )
}

/** How to connect — one picker, three focused paths: the desktop app (code),
 * a terminal command (cloud agent), or the MCP link when the registry offers
 * one. The empty state gets the full welcome (illustration, headline, pitch);
 * `compact` is the on-demand version behind the header Connect button, where
 * intent is already declared, so it leads with the picker. */
function ConnectHub({
  onPairingActive,
  mcpLink,
  compact = false,
}: {
  onPairingActive?: (active: boolean) => void
  /** Present the MCP path inline. Absent on registries without MCP links. */
  mcpLink?: McpLinkResult
  compact?: boolean
}) {
  const [path, setPath] = useState<ConnectPath>('computer')
  const mcpOk = mcpLink !== undefined && mcpLink.ok
  const options: ReadonlyArray<{ value: ConnectPath; label: string }> = [
    { value: 'computer', label: 'Computer' },
    { value: 'cloud', label: 'Cloud agent' },
    ...(mcpOk ? [{ value: 'mcp' as const, label: 'MCP' }] : []),
  ]
  /* One shared column: the segmented control, buttons, and code/command
     boxes all span the same width so the stack reads as a single form. */
  const picker = (
    <div className="mx-auto flex w-full max-w-[360px] flex-col">
      <SegmentedControl
        options={options}
        value={path}
        onChange={setPath}
        ariaLabel="How to connect"
        className="flex w-full [&_.seg-item]:flex-1"
      />
      {/* The pair panel stays mounted across path flips — one code serves
          the app and the terminal, and hiding (not unmounting) it on the
          MCP path keeps that code live instead of re-minting. */}
      <div className={path === 'mcp' ? 'hidden' : 'w-full'}>
        <MachinePairCodePanel
          onActiveChange={onPairingActive}
          autoMint
          path={path === 'cloud' ? 'cloud' : 'computer'}
        />
      </div>
      {path === 'mcp' && mcpLink !== undefined && mcpLink.ok && <McpHubPath link={mcpLink} />}
    </div>
  )

  if (compact) {
    return (
      <div className="rounded-2xl border border-(--line) bg-(--surface) px-8 py-6 text-center text-(--ink-2)">
        <p className="mb-4 text-sm leading-relaxed text-(--ink-2)">
          Where should your skills go?
        </p>
        {picker}
      </div>
    )
  }

  return (
    <EmptyState
      variant="card"
      illustration={
        <Image
          src="/illustrations/empty-devices.png"
          alt=""
          width={269}
          height={240}
          className="empty-illo h-24 w-auto"
        />
      }
      action={picker}
    >
      <p className="text-base font-semibold text-(--ink)">Connect</p>
      <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-(--ink-2)">
        Skills you add stay in sync everywhere automatically. Where should yours go?
      </p>
    </EmptyState>
  )
}

/** One beat, both directions: open slides down, close slides up + fades. */
const HUB_COLLAPSE_MS = 200

/** Height collapse for the Connect hub (grid-rows 0fr ⇄ 1fr, so the dynamic
 *  hub height needs no measurement). Mounts children on open and unmounts a
 *  beat after close, so dismissal slides shut instead of popping out and the
 *  rows below glide up to fill the gap. */
function HubCollapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      // Let the collapsed state paint first so opening transitions from 0fr.
      const raf = requestAnimationFrame(() => setExpanded(true))
      return () => cancelAnimationFrame(raf)
    }
    setExpanded(false)
    const id = window.setTimeout(() => setMounted(false), HUB_COLLAPSE_MS)
    return () => window.clearTimeout(id)
  }, [open])
  if (!mounted) return null
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] ease-out"
      style={{
        gridTemplateRows: expanded ? '1fr' : '0fr',
        opacity: expanded ? 1 : 0,
        transitionDuration: `${HUB_COLLAPSE_MS}ms`,
      }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/** Neutral mirror of ConnectedToast: a device signed out (or was revoked)
 *  elsewhere, so its row vanishing from the list gets an explanation. */
function DisconnectedToast({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-xl border border-(--line) bg-(--surface) px-4 py-3 text-sm font-medium text-(--ink-2)"
    >
      <span className="min-w-0 flex-1 truncate">{label} disconnected. Reconnect anytime.</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded text-(--ink-2) underline underline-offset-2 hover:text-(--ink)"
      >
        Dismiss
      </button>
    </div>
  )
}

/** Success confirmation shown the moment a freshly-paired device lands, so the
 *  terminal handoff (`skillet connect <code>`) gets visible closure in the UI. */
function ConnectedToast({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-xl border border-(--success-line) bg-(--success-bg) px-4 py-3 text-sm font-medium text-(--success)"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M13.5 4.5 6 12 2.5 8.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="min-w-0 flex-1 truncate">Connected {label}. Syncing now.</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded text-(--success) underline underline-offset-2 hover:text-(--ink)"
      >
        Dismiss
      </button>
    </div>
  )
}

export function ConnectedDevicesPanel({
  className,
  mcpRow,
  mcpLink,
}: {
  className?: string
  /** The MCP row (`McpConnectorRow`), rendered as the last row of the list.
   * Passed as a slot so it stays a server component. Omitted on registries
   * without MCP links. */
  mcpRow?: ReactNode
  /** The same link data, for the Connect hub's inline MCP path. */
  mcpLink?: McpLinkResult
}) {
  const [rows, setRows] = useState<AccountDeviceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showConnect, setShowConnect] = useState(false)
  const [pairingActive, setPairingActive] = useState(false)
  const [justConnected, setJustConnected] = useState<string | null>(null)
  const [justDisconnected, setJustDisconnected] = useState<string | null>(null)

  const rowsRef = useRef<AccountDeviceRow[] | null>(null)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const handlePairingActive = useCallback((active: boolean) => setPairingActive(active), [])

  // Every refresh lands here so change detection is uniform: a new sync device
  // toasts "Connected" and retires the hub; a vanished one (signed out from the
  // app, revoked elsewhere) toasts "disconnected" so the row doesn't just blink
  // away. Web-initiated disconnects never hit this: removeRow updates the
  // baseline locally first, so the next refresh sees nothing missing.
  const applyLoaded = useCallback((loaded: AccountDeviceRow[]) => {
    const baseline = rowsRef.current
    const knownKeys = new Set((baseline ?? []).map(rowKey))
    const loadedKeys = new Set(loaded.map(rowKey))
    const added = loaded.find((r) => !knownKeys.has(rowKey(r)))
    const removed = (baseline ?? []).find((r) => !loadedKeys.has(rowKey(r)))
    setRows(loaded)
    if (baseline === null) return
    if (added && added.kind === 'sync') {
      setJustConnected(added.label?.trim() || 'a new device')
      // The pairing the hub was opened for just completed — its job is
      // done, so it closes instead of idling under the new device row.
      setShowConnect(false)
    } else if (removed && removed.kind === 'sync') {
      setJustDisconnected(removed.label?.trim() || 'A device')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const loaded = await loadAccountDevices(controller.signal)
        setRows(loaded)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Could not load connected devices.')
      }
    })()
    return () => controller.abort()
  }, [])

  const pendingRuntimeReport =
    rows !== null && syncDevicePendingRuntimeReport(rows)

  useEffect(() => {
    const pollPairing = pairingActive
    const pollRuntimes = pendingRuntimeReport
    if (!pollPairing && !pollRuntimes) return

    const controller = new AbortController()
    let stopped = false
    let runtimePolls = 0
    let intervalId: number | undefined

    const poll = async () => {
      if (!pollPairing && pollRuntimes) {
        if (runtimePolls >= RUNTIME_REPORT_MAX_POLLS) {
          if (intervalId !== undefined) window.clearInterval(intervalId)
          return
        }
        runtimePolls += 1
      }
      try {
        const loaded = await loadAccountDevices(controller.signal)
        if (stopped) return
        applyLoaded(loaded)
      } catch {
        // Transient fetch errors are expected mid-poll; keep polling.
      }
    }

    intervalId = window.setInterval(() => void poll(), DEVICE_POLL_MS)
    return () => {
      stopped = true
      controller.abort()
      if (intervalId !== undefined) window.clearInterval(intervalId)
    }
  }, [pairingActive, pendingRuntimeReport, applyLoaded])

  // Refresh when the tab regains focus. The steady state has no poll, so this
  // is what catches a device signing itself out while the user was in the app:
  // they click back to Settings and the list is already true, with the toast
  // explaining what changed.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return
      if (rowsRef.current === null) return
      void loadAccountDevices()
        .then(applyLoaded)
        .catch(() => {
          // Offline or transient: keep showing the last known list.
        })
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [applyLoaded])

  useEffect(() => {
    if (!justConnected) return
    const id = window.setTimeout(() => setJustConnected(null), 6000)
    return () => window.clearTimeout(id)
  }, [justConnected])

  useEffect(() => {
    if (!justDisconnected) return
    const id = window.setTimeout(() => setJustDisconnected(null), 6000)
    return () => window.clearTimeout(id)
  }, [justDisconnected])

  const removeRow = (key: string) => {
    setRows((current) => current?.filter((r) => rowKey(r) !== key) ?? null)
  }

  const banner = justConnected ? (
    <ConnectedToast label={justConnected} onDismiss={() => setJustConnected(null)} />
  ) : justDisconnected ? (
    <DisconnectedToast label={justDisconnected} onDismiss={() => setJustDisconnected(null)} />
  ) : null

  if (error) {
    return <Notice tone="danger">{error}</Notice>
  }

  // An enabled MCP link is a live connection: the section already has a row to
  // show, so it collapses to the list view even with zero devices.
  const mcpConnected = mcpLink !== undefined && mcpLink.ok && mcpLink.enabled
  const hasConnections = rows !== null && (rows.length > 0 || mcpConnected)

  let body: ReactNode
  if (rows === null) {
    body = (
      <SettingsList aria-hidden>
        {[0, 1].map((i) => (
          <li key={i} className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="flex items-center gap-3">
              <Shimmer className="h-5 w-5" />
              <Shimmer className="h-4 w-40" />
            </span>
            <Shimmer className="h-7 w-16 rounded-full" />
          </li>
        ))}
      </SettingsList>
    )
  } else if (!hasConnections) {
    body = (
      <div className="space-y-4">
        {banner}
        <ConnectHub onPairingActive={handlePairingActive} mcpLink={mcpLink} />
      </div>
    )
  } else {
    body = (
      <div className="space-y-4">
        {banner}
        <SettingsList>
          {rows.map((row) => {
            if (row.kind === 'sync') {
              return (
                <DeviceKitSync
                  key={rowKey(row)}
                  deviceId={row.device_id}
                  label={row.label?.trim() || 'Unnamed agent'}
                  clientKind={row.client_kind}
                  clientKinds={row.client_kinds}
                  clientPlatform={row.client_platform}
                  agents={row.agents ?? []}
                  agentsReportedAt={row.agents_reported_at ?? null}
                  lastSeenAt={row.last_seen_at ?? null}
                  onRename={async (next) => {
                    const saved = await patchBearerDeviceLabel(row.device_id, next)
                    setRows(
                      (current) =>
                        current?.map((r) =>
                          r.kind === 'sync' && r.device_id === row.device_id
                            ? { ...r, label: saved }
                            : r,
                        ) ?? null,
                    )
                    return saved
                  }}
                  onDisconnect={async () => {
                    // The card is machine-scoped, so revoke every device row in
                    // the collapsed group — deleting only the representative
                    // leaves a zombie twin rendering the machine as connected.
                    const ids = row.machine_device_ids?.length
                      ? row.machine_device_ids
                      : [row.device_id]
                    const results = await Promise.allSettled(ids.map(deleteBearerDevice))
                    if (results.every((r) => r.status === 'rejected')) {
                      throw (results[0] as PromiseRejectedResult).reason
                    }
                    removeRow(rowKey(row))
                  }}
                />
              )
            }

            return (
              <DeviceKitSync
                key={rowKey(row)}
                label={row.label?.trim() || 'Unnamed agent'}
                syncCapable={false}
                statusLine="Not syncing. Connect with the app or remove if unused"
                disconnectLabel="Remove"
                disconnectConfirmMessage="Remove this legacy connection from your account? Web propose/approve from that browser will stop working."
                onDisconnect={async () => {
                  await revokeDelegationSession(row.device_key_id)
                  removeRow(rowKey(row))
                }}
              />
            )
          })}
          {mcpRow}
          {/* "Add Connection" is the last row of the list (Apple / GitHub
              add-row pattern), not a floating header button, so it lines up with
              the rows and reads as "add another to this list". It covers both a
              machine and the MCP link (the hub's paths). */}
          <li>
            <button
              type="button"
              onClick={() => setShowConnect((v) => !v)}
              aria-expanded={showConnect}
              className="flex w-full items-center gap-4 px-5 py-4 text-left text-sm font-semibold text-(--ink) transition-colors hover:bg-(--accent-bg)"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-(--line) text-(--ink-2)">
                <Plus className="h-4 w-4" />
              </span>
              {showConnect ? 'Cancel' : 'Add Connection'}
            </button>
          </li>
        </SettingsList>
        <HubCollapse open={showConnect}>
          <ConnectHub compact onPairingActive={handlePairingActive} mcpLink={mcpLink} />
        </HubCollapse>
      </div>
    )
  }

  return (
    <SettingsSection
      title="Connections"
      description="Machines and apps connected to your account, and how your skills reach them."
      className={className}
    >
      {body}
    </SettingsSection>
  )
}
