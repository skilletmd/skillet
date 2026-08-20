type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> }
}

/**
 * Run a DOM update as a circular-reveal wipe: the new state grows in as a circle
 * from (x, y), via the View Transitions API. Falls back to an instant update when
 * the API is missing or the user prefers reduced motion.
 *
 * `run` MUST mutate the DOM synchronously — for React state, wrap it in
 * `flushSync` so the new frame is painted before the transition snapshots it.
 */
export function circularReveal(run: () => void, x: number, y: number, duration = 460) {
  const doc = document as ViewTransitionDocument
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce || !doc.startViewTransition) {
    run()
    return
  }
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  )
  const transition = doc.startViewTransition(run)
  transition.ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
      },
      { duration, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' },
    )
  })
}
