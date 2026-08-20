# Brand faces — composite, don't generate

The image model **cannot** reliably draw the Skillet mascot face. No matter how
you prompt or reference it, gpt-image redraws its own interpretation — it thins
the ring eye into an outline, adds a tail to the `>` wink, drifts the stroke
weight, and lets an old dot-eye reference bleed through. Describing the face
harder does not fix this; the face has to be the **real pixels**, composited on.

So the workflow is: generate the scene with a **blank head**, then paste the
exact face. That makes the face pixel-identical across every illustration.

## The assets

Extracted from the desktop app icon (`packages/desktop/src-tauri/icons/icon-source.png`),
which is the canonical logo face:

- **`face-wink.png`** — the brand face: bold `>` wink, fat donut ring eye, smile.
- **`face-open.png`** — a wide-eyed variant (two ring eyes + smile), for a second
  mascot in the same scene so a pair doesn't read as clones.

Regenerate them only when the logo/eye changes:

    python3 extract-face.py            # rewrites both from the app icon

## Redrawing an empty-state illustration (three steps)

1. **Generate the scene with a blank head.** Use the `illo` skill with the
   `skillet-full` pack. In the prompt, keep the scene/pose/toque, but replace the
   face block with: *"the mascot head is a clean EMPTY white oval — no eyes, no
   wink, no mouth, nothing inside the outline; head upright, facing forward."*
   Pass the existing illustration as `--ref` so the scene stays faithful.

2. **Composite the real face.**

       python3 composite-face.py --scene blank.png --out composited.png
       # two mascots (teams): left gets --face, right gets --face2
       python3 composite-face.py --scene blank.png --out composited.png \
           --face face-wink.png --face2 face-open.png

   The head is found automatically (largest enclosed white oval). If detection
   misfires — e.g. an adjacent character encloses a bigger region — place it by
   hand with `--head cx,cy,width` (repeatable).

3. **Finalize to transparent line art** at the app's height (240px), matching the
   originals so dark mode's `filter: invert(1)` works:

       python3 finalize.py --in composited.png --out empty-devices.png --height 240

   It prints the intrinsic width — update the `<Image width=…>` prop in the
   component that renders that PNG (`packages/web/src/**`, grep `illustrations/empty-`).

## Notes

- Faithful redraws (`A`): keep the solid-black toque and pure B&W; `--ref` the
  original scene so pose/composition stay identical.
- Keep the head **upright and forward** even in reclining/motion poses — the
  compositor pastes an axis-aligned face and does not rotate.
- Everything is stdlib + Pillow (`pip install pillow`); no API key, no network.
