import assert from 'node:assert/strict'
import test from 'node:test'
import { isAccountBound } from '../src/auth/account-bound.js'
import type { Principal } from '../src/auth/middleware.js'

const scopes: readonly string[] = []

test('anonymous callers are not account-bound', () => {
  assert.equal(isAccountBound(null), false)
  assert.equal(isAccountBound(undefined), false)
})

test('session and mcp principals always carry a user', () => {
  assert.equal(
    isAccountBound({
      class: 'session',
      session_id: 's',
      user_id: 'u' as Principal & string,
      handle: null,
      two_factor: false,
      scopes,
    } as unknown as Principal),
    true,
  )
  assert.equal(
    isAccountBound({
      class: 'mcp',
      mcp_link_id: 'm',
      user_id: 'u' as Principal & string,
      scopes,
    } as unknown as Principal),
    true,
  )
})

test('a device counts only once paired to a user', () => {
  const device = (user_id: string | null): Principal =>
    ({ class: 'device', device_id: 'd', user_id, scopes }) as unknown as Principal
  assert.equal(isAccountBound(device('u')), true)
  assert.equal(isAccountBound(device(null)), false)
})

// A kit key is a credential without an account. Counting it as engaged reach
// would inflate the authed share with automation that has no person behind it.
test('a kit-class principal is never account-bound', () => {
  assert.equal(
    isAccountBound({
      class: 'kit',
      kit_key_id: 'k',
      kit_id: 'kit',
      scopes,
    } as unknown as Principal),
    false,
  )
})
