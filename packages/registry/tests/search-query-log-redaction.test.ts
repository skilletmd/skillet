import assert from 'node:assert/strict'
import test from 'node:test'
import { redactSearchUrl } from '../src/routes/search.js'

// The search query is the user's own words: on the router's cross-author
// fallback it is derived straight from the task they gave their agent. The
// database only ever stores capped, content-free keyword tallies, but Fastify's
// default `req` serializer writes `req.url` on every "incoming request" line,
// which would put those words in the log stream anyway. `redactSearchUrl` is
// what stops that, so these assertions are a privacy guarantee, not a cosmetic
// one. Mirrors the capability-token redaction tests for routes/mcp.ts.

test('redacts the q value and keeps only its length', () => {
  assert.equal(
    redactSearchUrl('/api/v1/search?q=how%20do%20i%20file%20my%20divorce'),
    '/api/v1/search?q=[redacted:34]',
  )
})

test('redacts q wherever it sits in the query string', () => {
  assert.equal(
    redactSearchUrl('/api/v1/search?types=skills&q=blog&limit=8'),
    '/api/v1/search?types=skills&q=[redacted:4]&limit=8',
  )
})

test('leaves every other parameter intact for debugging', () => {
  const out = redactSearchUrl('/api/v1/search?q=secret&types=skills,authors&limit=25')
  assert.match(out, /types=skills,authors/)
  assert.match(out, /limit=25/)
  assert.doesNotMatch(out, /secret/)
})

test('handles an empty or absent query without inventing a value', () => {
  assert.equal(redactSearchUrl('/api/v1/search?q='), '/api/v1/search?q=')
  assert.equal(redactSearchUrl('/api/v1/search?types=kits'), '/api/v1/search?types=kits')
  assert.equal(redactSearchUrl(''), '')
})

test('does not leak the query through a fragment or a repeated q', () => {
  assert.doesNotMatch(redactSearchUrl('/api/v1/search?q=alpha#q=beta'), /alpha/)
  const repeated = redactSearchUrl('/api/v1/search?q=alpha&q=beta')
  assert.doesNotMatch(repeated, /alpha/)
  assert.doesNotMatch(repeated, /beta/)
})
