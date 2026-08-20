export const SKILLET_SESSION_COOKIE = 'skillet_session'

export const skilletSessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 14 * 86400,
}

export function readSessionCookie(jar: {
  get: (name: string) => { value: string } | undefined
}): string | undefined {
  return jar.get(SKILLET_SESSION_COOKIE)?.value
}

export function clearSessionCookie(jar: {
  set: (
    name: string,
    value: string,
    options: typeof skilletSessionCookieOptions & { maxAge: number },
  ) => void
}): void {
  jar.set(SKILLET_SESSION_COOKIE, '', { ...skilletSessionCookieOptions, maxAge: 0 })
}
