import { REGISTRY_API } from '@/lib/registry-prefix'

function registryUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

// Request an emailed sign-in code. Proxies to the registry, which rate-limits
// per email + per IP and never reveals whether the mailbox exists.
export async function POST(req: Request) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string }
  const res = await fetch(`${registryUrl()}${REGISTRY_API}/auth/login-code/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: (email ?? '').trim() }),
  })
  const body = await res.json().catch(() => ({}))
  return Response.json(body, { status: res.status })
}
