import { describe, it, expect, afterEach } from 'vitest'
import { labEnabled } from './layout'

const original = process.env.NODE_ENV
const originalShow = process.env.SHOW_LAB

afterEach(() => {
  // vitest allows reassigning NODE_ENV in the node env; restore after each case.
  ;(process.env as Record<string, string | undefined>).NODE_ENV = original
  ;(process.env as Record<string, string | undefined>).SHOW_LAB = originalShow
})

describe('lab gate', () => {
  it('is enabled in development', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
    delete (process.env as Record<string, string | undefined>).SHOW_LAB
    expect(labEnabled()).toBe(true)
  })

  it('is disabled in production by default', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    delete (process.env as Record<string, string | undefined>).SHOW_LAB
    expect(labEnabled()).toBe(false)
  })

  it('can be opted back on in production with SHOW_LAB=1', () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    ;(process.env as Record<string, string | undefined>).SHOW_LAB = '1'
    expect(labEnabled()).toBe(true)
  })
})
