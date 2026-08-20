# Skillet (full body) — sibling pack of `skillet`

The full-body version of the SkilletMD chef mascot, for editorial scenes where he
performs a move. Same head as the `skillet` portrait, with a simple body so he can
act. Use this pack for `/illo` scenes; use `skillet` for faithful portrait/avatar art.

Style: **clean-flat (custom — brand vinyl line, not riso)**
Cutout chroma: **magenta**
Aliases: skillet-body, chef-full
Sibling pack: `skillet` (the portrait bust — the canonical logo)

## Locked design

- **Head**: a rounded OVAL slightly wider than tall (never a perfect circle),
  carrying the whole face — same as the portrait.
- **Toque**: tall three-lobe chef's hat sitting on top, roughly as tall as the head.
- **Face**: bold softly-rounded chevron `>` winking left eye, a small open ring
  (hollow circle outline) right eye, small shallow upturned smile below. No eyebrows.
- **Body**: one soft rounded torso (a gentle bean) **smaller than the head**,
  directly under it with a short neck-less join.
- **Limbs**: two short stubby arms with simple rounded mitt hands; two short stubby
  legs with simple rounded feet. Minimal — cuteness from proportion, not detail.
- **Accent carrier**: the **toque** — the only accent-colored part.

## Pixel-exact faces — composite, don't generate

The model cannot reliably redraw this face (it thins the ring, tails the wink,
drifts the weight). For anything that must match the brand exactly — the app's
empty-state illustrations, icons, avatars — do **not** rely on the prompt. Generate
the scene with a **blank white oval head** and composite the real face pixels on
afterward. The toolkit and the extracted face assets (`face-wink.png` + a wide-eyed
`face-open.png` for pairs) live in [`brand-faces/`](brand-faces/README.md).

## Prompt spec (drop into the CHARACTER slot)

> the recurring mascot — an oval head (slightly wider than tall) wearing a tall
> three-lobe chef's toque, a bold softly-rounded chevron ">" winking left eye, an
> open ring (hollow circle outline) right eye, a small upturned smile; below the head a soft rounded
> bean torso smaller than the head, two short stubby arms with rounded mitt hands,
> two short stubby legs with rounded feet. The ONLY accent-colored part is the
> toque. It MUST perform the move, not decorate. {value rule below}

## Value rules

- **Light palettes (default)**: head and body are white/paper with ONE bold
  even-weight near-black outline; face in structure ink; toque filled with accent.
- **Dark/bold palettes**: body stays light with the structure-ink outline (an
  outline character, never a solid blob); features in structure ink; toque accent.

## Visual style (clean-flat — substitute for riso blocks in every prompt)

- **LINE LANGUAGE**: ONE bold, even-weight, softly-rounded vinyl-sticker outline,
  same weight as the brand logo. Nothing thin, scratchy, or tapered. The body is
  ONE single fully-closed outline; arms/legs attach outside it without breaking it.
- **STYLE**: clean flat vector — solid flat fills, crisp edges, NO halftone, NO
  grain, NO ink offset, NO gradients, NO shadows.

## Personality

An earnest, unflappable cook who keeps the plates flying with a wink — calm
competence under a full ticket rail, never zany. The idea is carried by the
**move** (plating, shipping, hauling, holding the pass), not by the face.
