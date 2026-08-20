#!/usr/bin/env node
// Generate a docs concept illustration via OpenAI Images, in Skillet's line-art style.
// Usage: node scripts/gen-docs-img.mjs <slug> "<subject sentence>"
// Reads OPENAI_API_KEY from packages/web/.env.local. Writes packages/web/public/docs/<slug>.png
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const ENV = path.join(ROOT, 'packages/web/.env.local')
const OUT_DIR = path.join(ROOT, 'packages/web/public/docs')

function readKey() {
  const txt = fs.readFileSync(ENV, 'utf8')
  const m = txt.match(/^OPENAI_API_KEY\s*=\s*["']?([^"'\n\r]+)["']?\s*$/m)
  if (!m) throw new Error('OPENAI_API_KEY not found in ' + ENV)
  return m[1].trim()
}

const STYLE = [
  'Loose, hand-drawn black ink line illustration in a relaxed single-pen sketch style, on a FULLY TRANSPARENT background (no background fill, no rectangle, no color behind the art at all).',
  'CRITICAL line quality: every stroke is a clean, solid, FULLY-INKED black line. NOT marker, NOT dry-brush, NOT streaky, NOT faded, NOT sketchy scribbles, NOT hatching.',
  'Uniform THIN line weight throughout — like a 0.5mm fineliner pen. Every line the same thinness; never thick, never bold, never variable-width. This thin weight must be identical across the whole drawing.',
  'Draw the single subject at a consistent medium size, centered, occupying roughly the middle two-thirds of the frame with even margins all around.',
  'The composition is loose and gestural: separate strokes may leave small open gaps where they meet at corners and junctions (open line work), but each individual stroke is always solid and fully inked.',
  'Generous negative space, centered, calm and editorial.',
  'Exactly one small accent: a muted teal-blue #2f6f8f, used once on a single element; everything else is solid black line.',
  'Flat: no gradients, no shading, no drop shadows, no texture, no fills.',
  'Absolutely no text, no letters, no numbers, no labels, no UI chrome.',
  'Friendly, warm, simple, confident — the relaxed charm of a clean hand sketch.',
].join(' ')

async function main() {
  const [slug, subject] = process.argv.slice(2)
  if (!slug || !subject) {
    console.error('Usage: node scripts/gen-docs-img.mjs <slug> "<subject>"')
    process.exit(1)
  }
  const key = readKey()
  const prompt = `${STYLE}\n\nSubject: ${subject}`
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size: '1536x1024',
      quality: 'high',
      background: 'transparent',
      output_format: 'png',
      n: 1,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error(`API error ${res.status}: ${body.slice(0, 500)}`)
    process.exit(1)
  }
  const data = await res.json()
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) {
    console.error('No image in response: ' + JSON.stringify(data).slice(0, 300))
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, `${slug}.png`)
  fs.writeFileSync(out, Buffer.from(b64, 'base64'))
  // Always normalize on creation: trim transparent margins + reframe to a fixed
  // 82%-fill canvas, so every image is the same size. No separate step to forget.
  execFileSync('python3', [path.join(ROOT, 'scripts/normalize-docs-img.py'), out], {
    stdio: 'inherit',
  })
  console.log(`wrote + normalized ${out}`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
