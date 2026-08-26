/**
 * Moved to @skillet/protocol so the web package can reach it too: the daily
 * brief needs the same guess to show a skill's cover before the skill is
 * imported, and a second copy of the signal table would drift from this one.
 *
 * Re-exported rather than relocated at every call site, because the four
 * consumers here are about classification, not about which package owns it.
 */
export { guessCategory, type GuessCategoryInput } from '@skillet/protocol';
