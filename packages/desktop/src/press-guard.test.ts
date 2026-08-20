import { describe, expect, it, vi } from 'vitest'
import { createPressGuard } from './press-guard'

/** Collects scheduled flushes so a test can run them on demand. */
function manualSchedule() {
  const queue: Array<() => void> = []
  const schedule = (fn: () => void) => void queue.push(fn)
  return { schedule, flush: () => queue.splice(0).forEach((fn) => fn()) }
}

describe('press guard', () => {
  it('paints immediately when no press is in flight', () => {
    const guard = createPressGuard()
    expect(guard.hold(() => {})).toBe(false)
  })

  it('holds a paint that arrives during a press', () => {
    const { schedule, flush } = manualSchedule()
    const guard = createPressGuard(schedule)
    const paint = vi.fn()

    guard.onPointerDown()
    expect(guard.hold(paint)).toBe(true)
    expect(paint).not.toHaveBeenCalled()

    guard.onPointerUp()
    expect(paint).not.toHaveBeenCalled() // still queued, not synchronous
    flush()
    expect(paint).toHaveBeenCalledTimes(1)
  })

  it('never flushes synchronously on pointerup', () => {
    // The click event dispatches right after pointerup in the same task. A
    // synchronous flush would replace the element before the click lands —
    // exactly the lost tap this guard prevents.
    const guard = createPressGuard((fn) => void setTimeout(fn, 0))
    const paint = vi.fn()
    guard.onPointerDown()
    guard.hold(paint)
    guard.onPointerUp()
    expect(paint).not.toHaveBeenCalled()
  })

  it('keeps only the newest held paint', () => {
    const { schedule, flush } = manualSchedule()
    const guard = createPressGuard(schedule)
    const stale = vi.fn()
    const fresh = vi.fn()

    guard.onPointerDown()
    guard.hold(stale)
    guard.hold(fresh)
    guard.onPointerUp()
    flush()

    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('paints immediately again once the press is over', () => {
    const { schedule, flush } = manualSchedule()
    const guard = createPressGuard(schedule)

    guard.onPointerDown()
    guard.hold(() => {})
    guard.onPointerUp()
    flush()

    expect(guard.hold(() => {})).toBe(false)
  })

  it('a pointerup with nothing held schedules nothing', () => {
    const { schedule, flush } = manualSchedule()
    const guard = createPressGuard(schedule)
    guard.onPointerDown()
    guard.onPointerUp()
    expect(() => flush()).not.toThrow()
  })

  it('ignores a stray pointerup with no press in flight', () => {
    const { schedule } = manualSchedule()
    const guard = createPressGuard(schedule)
    guard.onPointerUp()
    // A press that starts afterwards still holds normally.
    guard.onPointerDown()
    expect(guard.hold(() => {})).toBe(true)
  })
})
