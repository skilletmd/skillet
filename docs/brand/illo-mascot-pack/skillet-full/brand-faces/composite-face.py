#!/usr/bin/env python3
"""Composite the exact brand face onto a blank-head mascot scene.

Generate the scene with illo asking for a BLANK white oval head (no eyes, no
mouth), upright and facing forward. Then run this to drop the real face on.
The head is found automatically as the largest enclosed white region (the
background is flood-filled from the border, so only interior whites remain).

    # single mascot
    python3 composite-face.py --scene blank.png --out done.png

    # two mascots (e.g. the teams scene) — left head gets --face, right --face2
    python3 composite-face.py --scene blank.png --out done.png \
        --face face-wink.png --face2 face-open.png

    # manual placement when detection misfires (repeatable), cx,cy,width
    python3 composite-face.py --scene blank.png --out done.png --head 377,601,395

Requires Pillow.
"""
import argparse
import pathlib
from collections import deque
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent


def enclosed_regions(im):
    w, h = im.size
    px = im.convert('RGB').load()

    def white(x, y):
        r, g, b = px[x, y]
        return r > 200 and g > 200 and b > 200

    bg = bytearray(w * h)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if white(x, y) and not bg[y * w + x]:
                bg[y * w + x] = 1
                dq.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if white(x, y) and not bg[y * w + x]:
                bg[y * w + x] = 1
                dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx] and white(nx, ny):
                bg[ny * w + nx] = 1
                dq.append((nx, ny))
    seen = bytearray(w * h)
    comps = []
    for sy in range(h):
        for sx in range(w):
            i = sy * w + sx
            if white(sx, sy) and not bg[i] and not seen[i]:
                q = deque([(sx, sy)])
                seen[i] = 1
                minx = maxx = sx
                miny = maxy = sy
                cnt = 0
                while q:
                    x, y = q.popleft()
                    cnt += 1
                    minx, maxx = min(minx, x), max(maxx, x)
                    miny, maxy = min(miny, y), max(maxy, y)
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        j = ny * w + nx
                        if 0 <= nx < w and 0 <= ny < h and not seen[j] and white(nx, ny) and not bg[j]:
                            seen[j] = 1
                            q.append((nx, ny))
                comps.append({'area': cnt, 'w': maxx - minx, 'h': maxy - miny,
                              'cx': (minx + maxx) // 2, 'cy': (miny + maxy) // 2})
    return comps, (w, h)


def detect_heads(im, n):
    """The head is a solid, roughly-square-ish oval in the upper 2/3.

    An adjacent character (the Octocat) can enclose a *taller* region, so we
    filter on aspect + fill and take the n largest that pass — never blindly
    the biggest region.
    """
    comps, (W, H) = enclosed_regions(im)
    cands = []
    for c in comps:
        ar = c['w'] / max(1, c['h'])
        if c['area'] < 0.008 * W * H:
            continue
        if not (0.78 <= ar <= 1.7):
            continue
        if c['cy'] > 0.66 * H:
            continue
        cands.append(c)
    cands.sort(key=lambda c: -c['area'])
    picked = cands[:n]
    picked.sort(key=lambda c: c['cx'])  # left-to-right
    return picked


def place(base, face_path, cx, cy, width, width_frac, vnudge):
    face = Image.open(face_path).convert('RGBA')
    fw, fh = face.size
    tw = int(round(width * width_frac))
    th = int(round(fh * tw / fw))
    face = face.resize((tw, th), Image.LANCZOS)
    y = int(cy + vnudge * (th / width_frac))
    base.alpha_composite(face, (cx - tw // 2, y - th // 2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scene', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--face', default=str(HERE / 'face-wink.png'))
    ap.add_argument('--face2', default=None, help='second face; two heads expected')
    ap.add_argument('--head', action='append', default=[],
                    help='manual cx,cy,width (repeatable, overrides detection)')
    ap.add_argument('--width-frac', type=float, default=0.66,
                    help='face width as a fraction of head width')
    ap.add_argument('--vnudge', type=float, default=0.04,
                    help='push face down by this fraction of head height')
    args = ap.parse_args()

    base = Image.open(args.scene).convert('RGBA')
    faces = [args.face] + ([args.face2] if args.face2 else [])

    if args.head:
        heads = []
        for spec in args.head:
            cx, cy, w = (int(v) for v in spec.split(','))
            heads.append({'cx': cx, 'cy': cy, 'w': w})
    else:
        heads = detect_heads(base, n=len(faces))
        if len(heads) < len(faces):
            raise SystemExit(f'detected {len(heads)} head(s), expected {len(faces)}; '
                             f'pass --head cx,cy,width to place manually')

    for head, face in zip(heads, faces):
        place(base, face, head['cx'], head['cy'], head['w'], args.width_frac, args.vnudge)
    base.convert('RGB').save(args.out)
    boxes = '; '.join(f"({h['cx']},{h['cy']},w={h['w']})" for h in heads)
    print(f'composited {len(faces)} face(s) onto {args.out} at {boxes}')


if __name__ == '__main__':
    main()
