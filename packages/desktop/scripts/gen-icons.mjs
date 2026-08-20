#!/usr/bin/env node
/**
 * Rasterize the Skillet mark straight from vector at the icon's native size.
 *
 * Downscaling one big raster (icon-source.png) softens the 2.7px chevron and the
 * open-ring eye at taskbar sizes. Rendering the SVG *at* the target size keeps
 * the strokes on pixel edges.
 *
 * Badge color follows the same convention as the web favicon
 * (packages/web/src/app/icon.tsx) and the tray (src-tauri/src/lib.rs): off-white
 * in prod, orange for a non-prod registry, so a dev window/taskbar tile is
 * unmistakable next to a prod one.
 */
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, '..', 'src-tauri', 'icons');
const repoRoot = join(here, '..', '..', '..');

// sharp lives in the web package's tree; resolve it from there too.
const require = createRequire(import.meta.url);
const sharpPath = require.resolve('sharp', {
  paths: [join(here, '..', 'node_modules'), join(repoRoot, 'packages', 'web', 'node_modules'), repoRoot],
});
const sharp = require(sharpPath);

const BADGE_DEV = '#fb923c';

/** @param {string} badge @param {number} size */
function markSvg(badge, size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="30" height="30" rx="7" fill="${badge}" />
  <g transform="translate(2 2)" stroke="#171512">
    <path d="M6.2 10.3 13.2 15.2 6.2 20.1" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="21.8" cy="15.2" r="2.5" stroke-width="1.7" />
    <path d="M12.2 21.2c2 2.3 5.2 2.3 7.2 0" stroke-width="2.4" stroke-linecap="round" />
  </g>
</svg>
`;
}

/** @param {string} name @param {string} badge @param {number} size */
async function render(name, badge, size) {
  const png = await sharp(Buffer.from(markSvg(badge, size)))
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(iconsDir, name), png);
  console.log(`  ${name.padEnd(20)} ${size}x${size}  ${png.length} bytes`);
}

// Window/taskbar icon for dev builds. Win11 draws taskbar tiles at 24px and asks
// for a 16px small icon; 48 divides evenly into both (2:1 and 3:1), so the shell
// downscales without resampling blur.
console.log('Rendering dev window icon from vector:');
await render('app-icon-dev.png', BADGE_DEV, 48);
console.log('Done.');
