#!/usr/bin/env python3
"""Extract the exact Skillet mascot face from the brand app icon.

The image model cannot reliably redraw the brand face (it thins the ring,
tails the wink, drifts the weight). So we never let it: we composite the real
face pixels on instead. This script produces the two transparent face assets
the compositor uses:

  face-wink.png  the canonical face — bold ">" wink, fat donut ring eye, smile
  face-open.png  a wide-eyed variant — two ring eyes + smile (for a 2nd mascot)

Source of truth is the desktop app icon, which is the logo face:
  packages/desktop/src-tauri/icons/icon-source.png

Re-run this only when the logo/eye changes. Requires Pillow.

    python3 extract-face.py [--icon PATH] [--outdir DIR]
"""
import argparse
import pathlib
from collections import deque
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
# repo root: brand-faces/ -> skillet-full -> illo-mascot-pack -> brand -> docs -> root
REPO = HERE.parents[4]
DEFAULT_ICON = REPO / 'packages/desktop/src-tauri/icons/icon-source.png'


def extract_ink(icon_path):
    """Near-black, opaque pixels -> unified brand ink; everything else clear.

    The icon's transparent background reads as RGB(0,0,0), so we must gate on
    alpha as well as luminance or the whole canvas comes back black.
    """
    im = Image.open(icon_path).convert('RGBA')
    w, h = im.size
    px = im.load()
    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if a > 128 and lum < 110:
                px[x, y] = (17, 17, 17, 255)
                minx, miny = min(minx, x), min(miny, y)
                maxx, maxy = max(maxx, x), max(maxy, y)
            else:
                px[x, y] = (0, 0, 0, 0)
    pad = 6
    box = (max(0, minx - pad), max(0, miny - pad), min(w, maxx + pad), min(h, maxy + pad))
    return im.crop(box)


def components(face):
    """4-connected ink components as {box, cx, cy, n}, largest first."""
    w, h = face.size
    px = face.load()
    seen = bytearray(w * h)
    out = []
    for sy in range(h):
        for sx in range(w):
            if px[sx, sy][3] > 40 and not seen[sy * w + sx]:
                q = deque([(sx, sy)])
                seen[sy * w + sx] = 1
                pts = []
                minx = maxx = sx
                miny = maxy = sy
                while q:
                    x, y = q.popleft()
                    pts.append((x, y))
                    minx, maxx = min(minx, x), max(maxx, x)
                    miny, maxy = min(miny, y), max(maxy, y)
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        j = ny * w + nx
                        if 0 <= nx < w and 0 <= ny < h and not seen[j] and px[nx, ny][3] > 40:
                            seen[j] = 1
                            q.append((nx, ny))
                out.append({
                    'box': (minx, miny, maxx + 1, maxy + 1),
                    'cx': sum(p[0] for p in pts) / len(pts),
                    'cy': sum(p[1] for p in pts) / len(pts),
                    'n': len(pts),
                })
    return [c for c in out if c['n'] > 200]


def build_open(face):
    """Wide-eyed variant: keep the smile + right ring, mirror the ring to the
    left eye, drop the wink."""
    comps = components(face)
    smile = max(comps, key=lambda c: c['cy'])
    rest = [c for c in comps if c is not smile]
    ring = max(rest, key=lambda c: c['cx'])
    w, h = face.size
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sb = smile['box']
    out.alpha_composite(face.crop(sb), (sb[0], sb[1]))
    rb = ring['box']
    out.alpha_composite(face.crop(rb), (rb[0], rb[1]))
    mirror = face.crop(rb).transpose(Image.FLIP_LEFT_RIGHT)
    out.alpha_composite(mirror, (w - rb[2], rb[1]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--icon', default=str(DEFAULT_ICON))
    ap.add_argument('--outdir', default=str(HERE))
    args = ap.parse_args()
    outdir = pathlib.Path(args.outdir)
    wink = extract_ink(args.icon)
    wink.save(outdir / 'face-wink.png')
    build_open(wink).save(outdir / 'face-open.png')
    print(f'wrote face-wink.png {wink.size} and face-open.png from {args.icon}')


if __name__ == '__main__':
    main()
