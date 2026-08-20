#!/usr/bin/env node
// Generate a docs illustration that REUSES the Skillet chef mascot as a reference,
// so the character stays on-model across every image (OpenAI images edits endpoint).
// Usage: node scripts/gen-docs-img-ref.mjs <slug> "<scene>"
// Writes packages/web/public/docs/<slug>.png
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const ENV = path.join(ROOT, 'packages/web/.env.local')
const REF = path.join(ROOT, 'packages/web/public/brand/skillet-mascot-logo.png')
const OUT_DIR = path.join(ROOT, 'packages/web/public/docs')

function readKey() {
  const txt = fs.readFileSync(ENV, 'utf8')
  const m = txt.match(/^OPENAI_API_KEY\s*=\s*["']?([^"'\n\r]+)["']?\s*$/m)
  if (!m) throw new Error('OPENAI_API_KEY not found in ' + ENV)
  return m[1].trim()
}

const STYLE = [
  'Reuse the EXACT mascot from the reference image without changing his design. Preserve these signature features precisely:',
  "left eye drawn as a bold thick GREATER-THAN sign '>' (a winking terminal-prompt eye);",
  'right eye a single solid round filled black dot;',
  'a small simple upward smile curve;',
  'a tall puffy rounded chef hat;',
  'a round body; thick, uniform, heavy bold black outlines (NOT thin lines); white fill inside.',
  'He must be instantly recognizable as the same character.',
  'Draw him in the same bold black line style on a flat warm cream background #fafaf8, lots of negative space, centered.',
  'One small accent only — muted teal-blue #2f6f8f — on a single prop. Flat, no gradients, no shading, no text or letters anywhere.',
].join(' ')

async function main() {
  const [slug, scene] = process.argv.slice(2)
  if (!slug || !scene) {
    console.error('Usage: node scripts/gen-docs-img-ref.mjs <slug> "<scene>"')
    process.exit(1)
  }
  const key = readKey()
  const buf = fs.readFileSync(REF)
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('image', new Blob([buf], { type: 'image/png' }), 'mascot.png')
  form.append('prompt', `${STYLE}\n\nScene: The chef mascot ${scene}`)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('n', '1')

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })
  if (!res.ok) {
    console.error(`API error ${res.status}: ${(await res.text()).slice(0, 500)}`)
    process.exit(1)
  }
  const data = await res.json()
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) {
    console.error('No image: ' + JSON.stringify(data).slice(0, 300))
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, `${slug}.png`)
  fs.writeFileSync(out, Buffer.from(b64, 'base64'))
  console.log(`wrote ${out}`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
