import { registryAuthApi } from './registry-proxy'

/** Remove a sync machine from the signed-in account. */
export async function deleteBearerDevice(deviceId: string): Promise<void> {
  const res = await fetch(registryAuthApi(`devices/${deviceId}`), {
    method: 'DELETE',
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    throw new Error(body.message ?? body.error ?? `Could not disconnect device (${res.status})`)
  }
}
