# Skillet illo character packs

Reproducible copies of the custom `skillet` (portrait bust — the logo) and
`skillet-full` (full-body, for editorial scenes) illo character packs used to
generate the docs illustrations in `packages/web/public/docs/`.

The mascot's right eye is an **open ring** (hollow circle outline), matching the
brand logo (`packages/web/public/brand/skillet-mascot-logo.svg`).

## Use

Copy each pack dir into your local illo config:

    cp -r docs/brand/illo-mascot-pack/skillet      "${XDG_CONFIG_HOME:-$HOME/.config}/illo/characters/"
    cp -r docs/brand/illo-mascot-pack/skillet-full "${XDG_CONFIG_HOME:-$HOME/.config}/illo/characters/"

Then generate with the `illo` skill using the `skillet-full` reference for
editorial scenes. The skill's own bundled `assets/character-reference.webp` is
its generic default character (**Blot**) and is intentionally left unchanged.

## Pixel-exact brand faces

The model cannot draw the mascot face reliably enough for brand assets. When the
face has to be exact (the app's empty-state illustrations, etc.), generate the
scene with a blank head and composite the real face on. The toolkit and face
assets live in [`skillet-full/brand-faces/`](skillet-full/brand-faces/README.md).
