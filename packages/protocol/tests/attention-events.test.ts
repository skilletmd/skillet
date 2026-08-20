import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAttentionStreamEvent } from '../src/attention-events.js'

describe('protocol/attention-events', () => {
  it('parses attention payloads', () => {
    const event = parseAttentionStreamEvent(
      JSON.stringify({ type: 'attention', social: 2, updates: 1, seq: 9 }),
    )
    assert.deepEqual(event, { type: 'attention', social: 2, updates: 1, seq: 9 })
  })

  it('parses social_event payloads', () => {
    const event = parseAttentionStreamEvent(
      JSON.stringify({
        type: 'social_event',
        kind: 'followed_you',
        actor: 'bob',
        at: 1_700_000_000,
        seq: 3,
      }),
    )
    assert.deepEqual(event, {
      type: 'social_event',
      kind: 'followed_you',
      actor: 'bob',
      at: 1_700_000_000,
      seq: 3,
    })
  })

  it('rejects unknown types gracefully', () => {
    assert.equal(parseAttentionStreamEvent(JSON.stringify({ type: 'nope', seq: 1 })), null)
    assert.equal(parseAttentionStreamEvent('not-json'), null)
  })
})
