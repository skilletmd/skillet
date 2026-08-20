/**
 * Holds background repaints that would land in the middle of a click.
 *
 * The tray panel repaints by replacing `innerHTML`. If that happens between a
 * pointerdown and its pointerup, the pressed element is gone by the time the
 * browser would fire `click`, so the event never arrives — the tap is silently
 * lost and the panel looks like it ignored you. Background repaints (CLI data
 * landing, the avatar fetch, the pending poll, the device-sync stream) arrive on
 * their own schedule, so they can and do land mid-press.
 *
 * User-initiated repaints are unaffected: their handlers run from `click`, which
 * fires after pointerup, so no press is in flight and they paint immediately.
 */
export interface PressGuard {
  /**
   * If a press is in flight, keep `paint` for later and return true (the caller
   * must not paint). Otherwise return false. Only the newest held paint is kept
   * — an older one has nothing to add.
   */
  hold(paint: () => void): boolean;
  onPointerDown(): void;
  /** Ends the press and flushes a held paint, if any. */
  onPointerUp(): void;
}

/**
 * `schedule` defers the flush off the current task. That is not optional: `click`
 * dispatches right after pointerup in the SAME task, so flushing synchronously
 * would destroy the element before the click arrives — the exact bug this guard
 * exists to prevent. Injectable so tests can drive it without real timers.
 */
export function createPressGuard(
  schedule: (fn: () => void) => void = (fn) => void setTimeout(fn, 0),
): PressGuard {
  let pressed = false;
  let heldPaint: (() => void) | null = null;
  return {
    hold(paint) {
      if (!pressed) return false;
      heldPaint = paint;
      return true;
    },
    onPointerDown() {
      pressed = true;
    },
    onPointerUp() {
      if (!pressed) return;
      pressed = false;
      const run = heldPaint;
      heldPaint = null;
      if (run) schedule(run);
    },
  };
}
