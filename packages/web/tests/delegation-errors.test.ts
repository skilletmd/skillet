// 422 delegation error → UX mapping (§4.2 step 5).

import { describe, it, expect } from 'vitest'
import {
  delegationErrorUX,
  isDelegationErrorCode,
  type DelegationErrorCode,
} from '@/lib/delegation-errors'

const CODES: DelegationErrorCode[] = [
  'delegation_not_found',
  'delegation_expired',
  'delegation_revoked',
  'delegation_scope_denied',
]

describe('delegation error mapping', () => {
  it('recognizes exactly the four device-delegation codes', () => {
    for (const c of CODES) expect(isDelegationErrorCode(c)).toBe(true)
    expect(isDelegationErrorCode('signature_invalid')).toBe(false)
    expect(isDelegationErrorCode('not_authorized')).toBe(false)
    expect(isDelegationErrorCode(undefined)).toBe(false)
    expect(isDelegationErrorCode(null)).toBe(false)
  })

  it('gives every code a distinct, non-empty title + message', () => {
    const titles = new Set<string>()
    for (const c of CODES) {
      const ux = delegationErrorUX(c)
      expect(ux.code).toBe(c)
      expect(ux.title.length).toBeGreaterThan(0)
      expect(ux.message.length).toBeGreaterThan(0)
      titles.add(ux.title)
    }
    expect(titles.size).toBe(CODES.length)
  })

  it('points expired/not-found/revoked at re-enrollment', () => {
    expect(delegationErrorUX('delegation_not_found').recovery).toBe('re-enroll')
    expect(delegationErrorUX('delegation_expired').recovery).toBe('re-enroll')
    expect(delegationErrorUX('delegation_revoked').recovery).toBe('re-enroll')
    expect(delegationErrorUX('delegation_scope_denied').recovery).toBe('contact-owner')
  })

  it('falls back to a generic message for unknown codes', () => {
    const ux = delegationErrorUX('some_other_code')
    expect(ux.title.length).toBeGreaterThan(0)
    expect(ux.message.length).toBeGreaterThan(0)
  })
})
