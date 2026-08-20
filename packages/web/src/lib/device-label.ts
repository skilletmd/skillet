import { registryAuthApi } from './registry-proxy'

async function patchLabel(path: string, label: string): Promise<string | null> {
  const res = await fetch(registryAuthApi(path), {
    method: 'PATCH',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `Could not save label (${res.status})`)
  }
  const body = (await res.json()) as { label?: string | null }
  return body.label ?? null
}

/** Rename a signing device (author delegation row). */
export async function patchDelegationLabel(
  deviceKeyId: string,
  label: string,
): Promise<string | null> {
  return patchLabel(`delegations/${deviceKeyId}`, label)
}

/** Rename a sync agent (bearer device token). */
export async function patchBearerDeviceLabel(
  deviceId: string,
  label: string,
): Promise<string | null> {
  return patchLabel(`devices/${deviceId}`, label)
}
