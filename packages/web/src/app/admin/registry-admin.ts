import 'server-only'
import { cookies } from 'next/headers'
import { readSessionCookie } from '@/lib/session-cookie'
import { REGISTRY_API } from '@/lib/registry-prefix'

export function registryUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

/** GET an admin registry endpoint with the caller's session bearer. Returns null
 *  on missing session or any non-OK response (rendered as an error state). */
export async function adminGet<T>(path: string): Promise<T | null> {
  const token = readSessionCookie(await cookies())
  if (!token) return null
  const res = await fetch(`${registryUrl()}${REGISTRY_API}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return (await res.json().catch(() => null)) as T | null
}

/** POST to an admin registry endpoint. Throws on a non-OK response so the failed
 *  server action surfaces rather than looking successful. */
export async function adminPost(path: string, body: unknown): Promise<void> {
  const token = readSessionCookie(await cookies())
  if (!token) throw new Error('no session')
  const res = await fetch(`${registryUrl()}${REGISTRY_API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`admin action failed (${res.status}) for ${path}`)
}
