import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

/** Mirror-measure where a line renders inside a soft-wrapping textarea:
 *  top offset (px from the textarea's border box) and height (covers wrapped
 *  rows). The mirror copies the styles that drive text layout. */
function measureLine(
  ta: HTMLTextAreaElement,
  value: string,
  start: number,
  lineText: string,
): { top: number; height: number } {
  const cs = window.getComputedStyle(ta)
  const mirror = document.createElement('div')
  for (const prop of [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'boxSizing',
    'tabSize',
  ] as const) {
    mirror.style[prop] = cs[prop]
  }
  mirror.style.position = 'absolute'
  mirror.style.top = '-9999px'
  mirror.style.visibility = 'hidden'
  // Match textarea soft-wrap behavior.
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.width = `${ta.clientWidth}px`
  const span = document.createElement('span')
  span.textContent = lineText.length > 0 ? lineText : ' '
  mirror.append(document.createTextNode(value.slice(0, start)), span)
  document.body.appendChild(mirror)
  const mirrorRect = mirror.getBoundingClientRect()
  const spanRect = span.getBoundingClientRect()
  const lh = parseFloat(cs.lineHeight) || 20
  const top = spanRect.top - mirrorRect.top
  const height = spanRect.height || lh
  mirror.remove()
  return { top, height }
}

/**
 * Jump a textarea to a flagged line: focus it, put the caret at the start of
 * the line, scroll it into the upper third, and flash a highlight bar over it
 * that fades out. The highlight is an overlay, NOT a selection — a selection
 * would be replaced by the next keystroke. Bumping `revealNonce` re-triggers
 * even for the same line — used by the scan findings panel.
 *
 * Returns the flash element; render it inside a `relative overflow-hidden`
 * wrapper that exactly contains the textarea. The flash is React state (not
 * imperative DOM) so it survives StrictMode's dev-only mount→cleanup→remount
 * cycle — the nonce guard blocks the second effect run, and an imperatively
 * appended node would have been torn down with nothing to recreate it.
 *
 * The nonce is consumed only when the jump actually lands (the textarea is
 * mounted and `enabled`). The parent flips the editor to source mode in its
 * own effect, which runs AFTER this one — consuming eagerly would burn the
 * nonce while still in rich mode and the jump would never happen.
 */
export function useRevealLine(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  revealLine: number | undefined,
  revealNonce: number | undefined,
  enabled = true,
): ReactNode {
  const lastReveal = useRef(0)
  const [flash, setFlash] = useState<{
    nonce: number
    top: number
    height: number
    width: number
  } | null>(null)
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    if (!revealNonce || revealNonce === lastReveal.current) return
    if (!enabled || !revealLine) return
    const ta = ref.current
    if (!ta) return
    lastReveal.current = revealNonce

    const lines = value.split('\n')
    const idx = Math.min(Math.max(revealLine - 1, 0), lines.length - 1)
    let start = 0
    for (let i = 0; i < idx; i++) start += (lines[i]?.length ?? 0) + 1
    ta.focus()
    ta.setSelectionRange(start, start)

    const { top, height } = measureLine(ta, value, start, lines[idx] ?? '')
    ta.scrollTop = Math.max(0, top - ta.clientHeight / 3)
    setScrollTop(ta.scrollTop)
    setFlash({ nonce: revealNonce, top, height, width: ta.clientWidth })
  }, [revealNonce, revealLine, value, enabled, ref])

  // Keep the bar glued to the line while the textarea scrolls during the flash.
  useEffect(() => {
    if (!flash) return
    const ta = ref.current
    if (!ta) return
    const onScroll = () => setScrollTop(ta.scrollTop)
    ta.addEventListener('scroll', onScroll)
    return () => ta.removeEventListener('scroll', onScroll)
  }, [flash, ref])

  if (!flash) return null
  return createElement('div', {
    key: flash.nonce,
    'data-reveal-flash': '',
    'aria-hidden': true,
    className: 'skill-editor-reveal-flash',
    style: { top: flash.top - scrollTop, height: flash.height, width: flash.width },
    onAnimationEnd: () => setFlash(null),
  })
}
