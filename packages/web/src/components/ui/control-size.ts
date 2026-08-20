/**
 * The one control-height scale shared by every interactive control — buttons,
 * inputs, selects, and the legacy `.ui-input` CSS. Because buttons and fields
 * read the SAME heights, a `size="md"` field and a `size="md"` button always
 * line up on a row (and `sm`/`lg` likewise). `md` is the default for both, so
 * the common case aligns with no extra props.
 *
 *   sm 32px · md 40px · lg 48px
 */
export const CONTROL_HEIGHT = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-12',
} as const

export type ControlSize = keyof typeof CONTROL_HEIGHT
