// Avatar upload BFF.
//
// POST /api/profile/avatar?author=<handle> with the raw image file as the body.
// This is the ONE place an avatar image is re-encoded: we run the upload through
// sharp (lib/process-avatar) into a small, metadata-stripped webp, then forward
// those bytes to the registry's owner-gated avatar endpoint with the caller's
// session. The registry stores the webp in the public R2 bucket and returns the
// final URL. Images never touch base64, the JWT, or the database as bytes.
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  SKILLET_SESSION_COOKIE,
  readSessionCookie,
  skilletSessionCookieOptions,
} from '@/lib/session-cookie'
import { refreshRegistryWebSession, webSessionIdentity } from '@/lib/registry-session'
import { REGISTRY_API } from '@/lib/registry-prefix'
import {
  processAvatar,
  AvatarProcessingError,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
} from '@/lib/process-avatar'

function registryOrigin(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

async function sessionIsValid(sessionToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${registryOrigin()}${REGISTRY_API}/whoami`, {
      headers: { authorization: `Bearer ${sessionToken}` },
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}

// Upload size policy (MAX_UPLOAD_BYTES) lives in lib/process-avatar, the single
// source of truth for avatar sizing; this message just renders it for the user.
const TOO_LARGE_MESSAGE = `Image is too large (max ${MAX_UPLOAD_MB}MB).`

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(view.byteLength)
  new Uint8Array(ab).set(view)
  return ab
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const author = request.nextUrl.searchParams.get('author')?.trim()
  if (!author) {
    return NextResponse.json({ error: 'Missing author.' }, { status: 400 })
  }

  const jar = await cookies()
  let sessionToken = readSessionCookie(jar)
  let refreshedToken: string | null = null

  // Validate the registry session; if it's missing/expired but the web (Auth.js)
  // session is still valid, self-heal by re-minting a registry session — mirroring
  // the BFF proxy (/api/registry). Without this, a user whose skillet_session cookie
  // lapsed (but who is still signed in) wrongly gets "please sign in again" on
  // upload, while every other profile edit — which flows through the self-healing
  // proxy — keeps working.
  if (!sessionToken || !(await sessionIsValid(sessionToken))) {
    const identity = await webSessionIdentity(request)
    const minted = identity ? await refreshRegistryWebSession(identity, sessionToken ?? undefined) : null
    if (!minted) {
      return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
    }
    sessionToken = minted.session_token
    refreshedToken = minted.session_token
  }

  // Reject an honestly-declared oversized upload before buffering it into memory.
  // The post-buffer check below still covers a missing/lying Content-Length.
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: TOO_LARGE_MESSAGE }, { status: 413 })
  }

  // Buffer the body ourselves so a truncated/oversized stream surfaces as a
  // clean error instead of an opaque framework 500 (what the user hit).
  let input: ArrayBuffer
  try {
    input = await request.arrayBuffer()
  } catch {
    return NextResponse.json({ error: 'Upload failed. Try again.' }, { status: 400 })
  }
  if (input.byteLength === 0) {
    return NextResponse.json({ error: 'Empty upload.' }, { status: 400 })
  }
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: TOO_LARGE_MESSAGE }, { status: 413 })
  }

  let processed
  try {
    processed = await processAvatar(input)
  } catch (err) {
    if (err instanceof AvatarProcessingError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    return NextResponse.json({ error: 'Could not process that image.' }, { status: 500 })
  }

  const target = `${registryOrigin()}${REGISTRY_API}/profiles/${encodeURIComponent(author)}/avatar`
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: 'POST',
      headers: { authorization: `Bearer ${sessionToken}` },
      // Copy into a fresh ArrayBuffer so the Blob part is a plain ArrayBuffer (the
      // DOM types reject the generic Uint8Array view). Blob carries content-type.
      body: new Blob([toArrayBuffer(processed.bytes)], { type: processed.contentType }),
      // Fail fast on a down/hung registry instead of pinning the request worker
      // (and surface a clean error, not an opaque framework 500).
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the avatar service. Try again.' },
      { status: 502 },
    )
  }

  if (!upstream.ok) {
    if (upstream.status === 401) {
      return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
    }
    if (upstream.status === 403) {
      return NextResponse.json({ error: 'You can only edit your own profile.' }, { status: 403 })
    }
    const detail = (await upstream.json().catch(() => ({}))) as { error?: string }
    return NextResponse.json(
      { error: detail.error ?? 'Could not save your avatar.' },
      { status: upstream.status },
    )
  }

  const data = (await upstream.json().catch(() => null)) as { avatar_url?: string } | null
  if (!data?.avatar_url) {
    return NextResponse.json({ error: 'Could not save your avatar.' }, { status: 502 })
  }
  const res = NextResponse.json({ avatarUrl: data.avatar_url })
  // Persist a self-healed registry session so the next request skips the re-mint.
  if (refreshedToken) {
    res.cookies.set(SKILLET_SESSION_COOKIE, refreshedToken, skilletSessionCookieOptions)
  }
  return res
}
