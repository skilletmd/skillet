/**
 * Web adapter over the SHARED canvas cover engine
 * (@skillet/protocol/cover-canvas — single source with the desktop tray, same
 * contract as the SVG engine in @skillet/protocol/covers). The engine keys
 * off CategoryKey + the protocol swatches; this wrapper keeps the web's
 * Category-object signature for existing callers (components, the lab) and
 * re-exports everything else.
 *
 * Browser-only (canvas + Image) — import from client code only.
 */

import { skillRecipe as protocolSkillRecipe } from '@skillet/protocol/cover-canvas'
import type { GrainOpts, Recipe, StyleMode } from '@skillet/protocol/cover-canvas'
import type { Category } from '@/lib/categories'

export {
  DEFAULT_GRAIN,
  PRESS_SEED,
  SOLO_MARK_MAX,
  STYLES,
  printPx,
  glyphMask,
  glyphOptics,
  isCoverCategory,
  kitMarkMask,
  kitRecipe,
  renderRecipe,
  type GrainOpts,
  type Recipe,
  type CoverStyle,
  type Screen,
  type ScreenMode,
  type StyleMode,
  type GlyphMode,
} from '@skillet/protocol/cover-canvas'

/** Category-object signature kept for web callers; the shared engine takes
 *  the key and reads the protocol swatch itself. */
export function skillRecipe(
  cat: Category,
  globalSeed: number,
  grain: GrainOpts,
  mode: StyleMode,
  ref?: string,
): Recipe {
  return protocolSkillRecipe(cat.key, globalSeed, grain, mode, ref)
}
