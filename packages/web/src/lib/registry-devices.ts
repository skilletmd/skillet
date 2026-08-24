/**
 * Client-side device/pairing reads shared by the setup flow surfaces. One copy
 * of the device + materialization shapes and the fetch helpers so the guided
 * chat and the panel flow can't drift.
 */
import { registryAuthApi, registryGetJson } from '@/lib/registry-proxy'
import { logRegistryDegrade } from '@/lib/registry-errors'

export interface Device {
  device_id: string
  label?: string | null
  agents?: string[]
  agents_reported_at?: number | null
}

export interface Materialization {
  skill_slug: string
  runtime: string
  status: 'materialized' | 'skipped-not-detected' | 'failed'
  reported_at: number
}

/** Mint a one-time pair code for connecting a device to this account. */
export async function mintPairCode(): Promise<string | null> {
  try {
    const res = await fetch(registryAuthApi('connect/codes'), {
      method: 'POST',
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      logRegistryDegrade(`pair-code mint responded ${res.status}`)
      return null
    }
    const body = (await res.json()) as { code?: string }
    return body.code ?? null
  } catch (cause) {
    logRegistryDegrade('pair-code mint failed', cause)
    return null
  }
}

/** This account's connected devices. */
export async function fetchDevices(signal?: AbortSignal): Promise<Device[]> {
  const body = await registryGetJson<{ devices?: Device[] }>('devices', { signal })
  return body?.devices ?? []
}

/** Per-runtime materialization status for one skill on one device. */
export async function fetchMaterializations(
  deviceId: string,
  skill: string,
  signal?: AbortSignal,
): Promise<Materialization[]> {
  const body = await registryGetJson<{ materializations?: Materialization[] }>(
    `devices/${encodeURIComponent(deviceId)}/materializations?skill=${encodeURIComponent(skill)}`,
    { signal },
  )
  return body?.materializations ?? []
}

/** The most recently-seen device that has reported its runtimes, or null. */
export function connectedDevice(devices: Device[]): Device | null {
  let best: Device | null = null
  for (const d of devices) {
    if (d.agents_reported_at == null) continue
    if (!best || (d.agents_reported_at ?? 0) > (best.agents_reported_at ?? 0)) best = d
  }
  return best
}
