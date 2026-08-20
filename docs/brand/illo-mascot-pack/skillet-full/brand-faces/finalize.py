#!/usr/bin/env python3
"""Turn a composited scene into a transparent line-art PNG for the app.

The empty-state illustrations are ink-on-paper line art on a transparent
background (dark mode inverts them to white lines via CSS `filter: invert(1)`).
So we knock out ALL white — the page background AND the body/head interiors —
leaving only the near-black ink, then crop tight and scale to a target height.

    python3 finalize.py --in composited.png --out empty-devices.png [--height 240]

Requires Pillow.
"""
import argparse
from PIL import Image

# Luminance ramp: <=DARK is full ink, >=LIGHT is fully clear, linear between
# (keeps anti-aliased edges clean through the resize).
DARK = 100
LIGHT = 165


def knockout(im):
    im = im.convert('RGB')
    w, h = im.size
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    src, dst = im.load(), out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if lum <= DARK:
                a = 255
            elif lum >= LIGHT:
                a = 0
            else:
                a = int(round(255 * (LIGHT - lum) / (LIGHT - DARK)))
            if a:
                dst[x, y] = (17, 17, 17, a)  # unify to brand near-black
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--height', type=int, default=240)
    args = ap.parse_args()
    ink = knockout(Image.open(args.src))
    box = ink.getbbox()
    if box:
        ink = ink.crop(box)
    w, h = ink.size
    nw = max(1, round(w * args.height / h))
    ink = ink.resize((nw, args.height), Image.LANCZOS)
    ink.save(args.out)
    print(f'wrote {args.out} {ink.size} (width for the <Image> prop: {nw})')


if __name__ == '__main__':
    main()
