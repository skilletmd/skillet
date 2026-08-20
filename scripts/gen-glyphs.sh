#!/usr/bin/env bash
# Generate the hand-drawn category glyph set: for each category, generate a loose
# line-art PNG, flatten to black-on-white, and potrace it to a crisp white-fill SVG.
# Output: packages/web/public/glyphs/<category>.svg
set -e
cd "$(dirname "$0")/.."
mkdir -p packages/web/public/glyphs

while IFS='|' read -r cat subj; do
  [ -z "$cat" ] && continue
  echo "=== $cat ==="
  node scripts/gen-docs-img.mjs "_g-$cat" "$subj" >/dev/null
  python3 - "$cat" <<'PY'
import sys
from PIL import Image
cat = sys.argv[1]
im = Image.open(f'packages/web/public/docs/_g-{cat}.png').convert('RGBA')
bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
bg.alpha_composite(im)
bg.convert('L').save(f'/tmp/{cat}.ppm')
PY
  potrace "/tmp/$cat.ppm" -s -C '#ffffff' -t 8 -O 0.4 -o "packages/web/public/glyphs/$cat.svg"
  echo "  -> packages/web/public/glyphs/$cat.svg"
done <<'LIST'
frontend|a browser window frame with a small cursor arrow inside
mobile|a simple smartphone outline, portrait
backend|two stacked horizontal server rack slabs
database|a database cylinder
devops|a simple infinity loop symbol
security|a shield
quality|a checkmark inside a circle
agents|a hexagon badge with a small dot in the center
design|three overlapping simple shapes, a circle a square and a triangle
product|a clipboard with a short checklist of ticks
writing|a fountain pen nib, simple
marketing|a megaphone
sales|an upward trending zigzag arrow over a baseline
finance|a single round coin
productivity|a small calendar grid
media|a play-button triangle inside a rounded rectangle frame
research|a magnifying glass
LIST
echo "ALL GLYPHS DONE"
