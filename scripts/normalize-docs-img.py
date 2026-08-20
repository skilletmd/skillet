#!/usr/bin/env python3
"""Normalize docs illustrations for consistent scale.

Trims the transparent margins around each drawing, then re-frames the subject
onto a fixed 3:2 transparent canvas so it fills the same fraction every time.
Identical render height in CSS then yields identical apparent size.

Usage: python3 scripts/normalize-docs-img.py <file.png> [<file.png> ...]
       python3 scripts/normalize-docs-img.py packages/web/public/docs/*.png
"""
import sys
from PIL import Image

CW, CH = 1500, 1000          # fixed 3:2 canvas
FILL = 0.82                  # subject fills 82% of the canvas box
ALPHA_THRESH = 40            # ignore faint halo from "transparent" PNG export


def normalize(path):
    img = Image.open(path).convert("RGBA")
    # Find the real-ink bounding box via an alpha threshold. Plain getbbox()
    # counts near-invisible halo pixels and barely trims, leaving the subject small.
    alpha = img.getchannel("A")
    mask = alpha.point(lambda a: 255 if a > ALPHA_THRESH else 0)
    bbox = mask.getbbox()
    if not bbox:
        print(f"skip (empty): {path}")
        return
    sub = img.crop(bbox)
    scale = min(CW * FILL / sub.width, CH * FILL / sub.height)
    nw, nh = max(1, round(sub.width * scale)), max(1, round(sub.height * scale))
    sub = sub.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    canvas.paste(sub, ((CW - nw) // 2, (CH - nh) // 2), sub)
    canvas.save(path)
    print(f"normalized: {path}")


if __name__ == "__main__":
    files = sys.argv[1:]
    if not files:
        sys.exit("Usage: normalize-docs-img.py <file.png> ...")
    for f in files:
        normalize(f)
