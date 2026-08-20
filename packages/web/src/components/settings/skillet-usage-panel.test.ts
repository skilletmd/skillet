import { describe, it, expect } from 'vitest'
import { parseRouteUsage } from './skillet-usage-panel'

// The privacy fail-safe: a malformed /me/route-usage body must read as
// recording-OFF, never as an error. (A network failure / unparseable JSON is a
// separate error path in the component's fetch layer, not in parseRouteUsage.)
describe('parseRouteUsage — recording fail-safe', () => {
  it('records only when the server explicitly says recording: true', () => {
    expect(parseRouteUsage({ recording: true, skills: [], runtimes: [], route_ts: [] }).recording).toBe(
      true,
    )
  })

  it('reads a missing recording field as off', () => {
    expect(parseRouteUsage({ skills: [], runtimes: [] }).recording).toBe(false)
  })

  it('reads any non-true recording value as off', () => {
    for (const v of [false, 'true', 1, 0, null, undefined, {}]) {
      expect(parseRouteUsage({ recording: v }).recording).toBe(false)
    }
  })

  it('reads a non-object body (null / array / string / number) as off with empty data', () => {
    for (const body of [null, undefined, [], 'nope', 42, true]) {
      const p = parseRouteUsage(body)
      expect(p.recording).toBe(false)
      expect(p.skills).toEqual([])
      expect(p.runtimes).toEqual([])
      expect(p.routeTs).toEqual([])
    }
  })

  it('defaults malformed collections to empty arrays without erroring', () => {
    const p = parseRouteUsage({ recording: true, skills: 'x', runtimes: {}, route_ts: 'y' })
    expect(p.recording).toBe(true)
    expect(p.skills).toEqual([])
    expect(p.runtimes).toEqual([])
    expect(p.routeTs).toEqual([])
  })

  it('never throws — a malformed body can only surface as recording-off, never an error', () => {
    for (const body of [null, undefined, [], 'x', 42, {}, { recording: {} }, { skills: null }]) {
      expect(() => parseRouteUsage(body)).not.toThrow()
    }
  })

  it('keeps a well-formed payload and filters non-numeric route timestamps', () => {
    const p = parseRouteUsage({
      recording: true,
      skills: [{ skill_ref: '@a/b', count: 2, last_ts: 100, category: 'writing' }],
      runtimes: ['cursor', 'chatgpt'],
      route_ts: [1, 'x', 2, null, 3],
    })
    expect(p.recording).toBe(true)
    expect(p.skills).toHaveLength(1)
    expect(p.runtimes).toEqual(['cursor', 'chatgpt'])
    expect(p.routeTs).toEqual([1, 2, 3])
  })

  it('filters non-string runtime entries', () => {
    expect(
      parseRouteUsage({ recording: true, runtimes: ['cursor', 5, null, 'codex'] }).runtimes,
    ).toEqual(['cursor', 'codex'])
  })
})
