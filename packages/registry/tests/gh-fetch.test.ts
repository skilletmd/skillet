import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ghFetch, isGitHubHost } from '../src/sync/gh-fetch.js'

const ok = () => new Response('ok', { status: 200 })
const redirect = (to: string) =>
  new Response(null, { status: 302, headers: { location: to } })

test('isGitHubHost allows only GitHub hosts (case-insensitive)', () => {
  assert.equal(isGitHubHost('api.github.com'), true)
  assert.equal(isGitHubHost('RAW.githubusercontent.com'), true)
  assert.equal(isGitHubHost('169.254.169.254'), false)
  assert.equal(isGitHubHost('localhost'), false)
  assert.equal(isGitHubHost('evil.com'), false)
})

test('passes through a normal 200 on an allowlisted host', async () => {
  const res = await ghFetch('https://api.github.com/repos/a/b', {}, { fetchImpl: async () => ok() })
  assert.equal(res.status, 200)
})

test('refuses an off-GitHub initial host', async () => {
  await assert.rejects(
    ghFetch('http://169.254.169.254/latest/meta-data/', {}, { fetchImpl: async () => ok() }),
    /refusing (non-https|off-GitHub)/,
  )
})

test('refuses a redirect that bounces off GitHub (SSRF defense)', async () => {
  const fetchImpl = (async (url: string | URL) =>
    String(url).includes('github')
      ? redirect('https://169.254.169.254/latest/meta-data/')
      : ok()) as typeof fetch
  await assert.rejects(
    ghFetch('https://raw.githubusercontent.com/a/b/main/x', {}, { fetchImpl }),
    /off-GitHub host/,
  )
})

test('follows an on-GitHub redirect and drops auth across hosts', async () => {
  const seen: Array<{ host: string; auth: string | null }> = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url))
    const auth = new Headers(init?.headers).get('authorization')
    seen.push({ host: u.hostname, auth })
    return u.hostname === 'api.github.com'
      ? redirect('https://objects.githubusercontent.com/signed/blob')
      : ok()
  }) as typeof fetch
  const res = await ghFetch(
    'https://api.github.com/repos/a/b/tarball',
    { headers: { authorization: 'Bearer secret' } },
    { fetchImpl },
  )
  assert.equal(res.status, 200)
  assert.equal(seen[0]!.auth, 'Bearer secret') // first hop keeps the token
  assert.equal(seen[1]!.host, 'objects.githubusercontent.com')
  assert.equal(seen[1]!.auth, null) // cross-host hop strips it
})

test('gives up after too many redirects', async () => {
  const fetchImpl = (async () =>
    redirect('https://raw.githubusercontent.com/loop')) as typeof fetch
  await assert.rejects(
    ghFetch('https://raw.githubusercontent.com/start', {}, { fetchImpl }),
    /too many redirects/,
  )
})
