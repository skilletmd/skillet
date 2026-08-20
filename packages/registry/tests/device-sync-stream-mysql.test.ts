// U4: device sync stream auth gate on MySQL (Prisma session/devices path).
// Plus the CORS carry-through: the route hijacks and writes its own raw head,
// which used to discard the headers @fastify/cors staged — the desktop webview
// passed preflight but could never read the stream body. The stream tests run
// against a real listening server with abortable fetch: injected mock streams
// never emit close on the hijacked response, so the route's heartbeat outlives
// the test and pins the process (a plain inject never resolves at all — the
// promise settles on response end, which only comes on client close).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { freshMysqlServer, mint, type Handle } from './helpers.js'
import { mysqlTestsEnabled } from './mysql-test-env.js'
import { emitDeviceSyncRequired } from '../src/lib/device-sync-stream.js'

const hasMysql = mysqlTestsEnabled()

describe('device sync stream mysql (U4)', { skip: !hasMysql }, () => {
  let h: Handle
  let deviceToken: string
  let userId: string
  let baseUrl: string

  before(async () => {
    h = await freshMysqlServer()
    const s = await mint(h)
    userId = s.user_id
    const mintRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/devices/token',
      payload: { label: 'stream-test' },
      headers: { authorization: `Bearer ${s.session_token}` },
    })
    assert.equal(mintRes.statusCode, 201, mintRes.body)
    deviceToken = (mintRes.json() as { device_token: string }).device_token
    baseUrl = await h.app.listen({ port: 0, host: '127.0.0.1' })
  })

  after(async () => {
    await h?.app.close()
  })

  async function streamFetch(
    extraHeaders: Record<string, string>,
    use: (res: Response) => Promise<void>,
  ) {
    const abort = new AbortController()
    try {
      const res = await fetch(`${baseUrl}/api/v1/devices/sync/stream`, {
        headers: { authorization: `Bearer ${deviceToken}`, ...extraHeaders },
        signal: abort.signal,
      })
      await use(res)
    } finally {
      // Real socket teardown: the route's close handler fires and clears the
      // heartbeat, so the suite exits without --test-force-exit.
      abort.abort()
    }
  }

  it('rejects missing device auth with 401', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/devices/sync/stream',
    })
    assert.equal(res.statusCode, 401)
  })

  it('carries CORS headers through the hijacked head for an allowed origin', async () => {
    await streamFetch({ origin: 'tauri://localhost' }, async (res) => {
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('access-control-allow-origin'), 'tauri://localhost')
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true')
      // Exactly one content-type: the lowercase-normalized merge must not emit
      // duplicate headers across casings (fetch joins duplicates with ", ").
      assert.equal(res.headers.get('content-type'), 'text/event-stream')
      // The stream is live: an emitted event arrives as SSE data.
      const reader = res.body!.getReader()
      const chunk = (async () => {
        const { value } = await reader.read()
        return new TextDecoder().decode(value)
      })()
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('no SSE data within 5s')), 5000),
      )
      emitDeviceSyncRequired(userId, 1)
      assert.match(await Promise.race([chunk, timeout]), /sync_required/)
    })
  })

  it('reflects nothing on the stream head for a disallowed origin', async () => {
    await streamFetch({ origin: 'https://evil.example' }, async (res) => {
      assert.equal(res.status, 200)
      // No ACAO reflection is the security assertion. @fastify/cors emits
      // access-control-allow-credentials unconditionally when configured, but
      // without a matching allow-origin the browser grants nothing.
      assert.equal(res.headers.get('access-control-allow-origin'), null)
    })
  })

  it('keeps the no-origin (non-browser) path unchanged', async () => {
    await streamFetch({}, async (res) => {
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('access-control-allow-origin'), null)
      assert.equal(res.headers.get('content-type'), 'text/event-stream')
    })
  })
})
