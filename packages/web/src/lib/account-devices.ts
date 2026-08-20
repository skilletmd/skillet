import { collapseDevicesByMachine } from '@skillet/protocol/device-collapse'
import type { Delegation } from './enroll-device'

export interface SyncDeviceRow {
  kind: 'sync'
  device_id: string
  label: string | null
  created_at: number
  agents?: string[]
  agents_reported_at?: number | null
  /** Unix seconds of the device's last authenticated registry call. */
  last_seen_at?: number | null
  client_kind?: string | null
  /**
   * Every kind that has connected for this machine (additive). Absent on
   * old registries — that absence, never an empty array, triggers the
   * single-kind fallback rendering.
   */
  client_kinds?: string[] | null
  client_platform?: string | null
  machine_id?: string | null
  /**
   * Every device id in this machine's collapsed group (including the
   * representative). Disconnect must revoke ALL of them: the card is
   * machine-scoped ("stops syncing to this MacBook"), and deleting only the
   * representative leaves a zombie row that re-renders the card as still
   * connected while the actual device is revoked.
   */
  machine_device_ids?: string[]
}

export interface LegacySigningRow {
  kind: 'legacy-signing'
  device_key_id: string
  label: string | null
  scopes: string[]
  expires_at: number
}

export type AccountDeviceRow = SyncDeviceRow | LegacySigningRow

export function rowKey(row: AccountDeviceRow): string {
  if (row.kind !== 'sync') return `legacy:${row.device_key_id}`
  // Key by machine, not representative device: a collapsed desktop+CLI card
  // swaps its device_id to the surviving row when one half signs out, and a
  // changed key reads as remove+add in the panel's connect/disconnect diff
  // (false "Connected" toast). Machine identity survives the swap.
  return row.machine_id ? `machine:${row.machine_id}` : row.device_id
}

/** True when a sync-capable device has not yet reported runtimes to the registry. */
export function syncDevicePendingRuntimeReport(rows: AccountDeviceRow[]): boolean {
  return rows.some((row) => row.kind === 'sync' && row.agents_reported_at == null)
}

export function normalizeAccountDevices(
  syncDevices: Array<{
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
  }>,
  delegations: Delegation[],
): AccountDeviceRow[] {
  // One card per physical machine: desktop + CLI on the same machine share a
  // machine_id but are separate rows that don't always converge server-side, so
  // collapse before rendering (this also keeps the connected-device count from
  // double-counting one machine). No current-device hint on the web — the
  // most-recently-seen row survives.
  const syncRows: AccountDeviceRow[] = collapseDevicesByMachine(syncDevices).map((d) => ({
    kind: 'sync',
    device_id: d.device_id,
    machine_device_ids: d.machine_id
      ? syncDevices.filter((r) => r.machine_id === d.machine_id).map((r) => r.device_id)
      : [d.device_id],
    label: d.label,
    created_at: d.created_at,
    agents: d.agents,
    agents_reported_at: d.agents_reported_at,
    last_seen_at: d.last_seen_at ?? null,
    client_kind: d.client_kind ?? null,
    // undefined stays undefined: field absence is the old-registry signal.
    client_kinds: d.client_kinds,
    client_platform: d.client_platform ?? null,
    machine_id: d.machine_id ?? null,
  }))

  const legacyRows: AccountDeviceRow[] = delegations
    .filter((d) => d.status === 'active')
    .map((d) => ({
      kind: 'legacy-signing',
      device_key_id: d.device_key_id,
      label: d.label,
      scopes: d.scopes,
      expires_at: d.expires_at,
    }))

  return [...syncRows, ...legacyRows].sort((a, b) => {
    const la = (a.label ?? '').toLowerCase()
    const lb = (b.label ?? '').toLowerCase()
    if (la !== lb) return la.localeCompare(lb)
    if (a.kind === 'sync' && b.kind === 'sync') return b.created_at - a.created_at
    return 0
  })
}
