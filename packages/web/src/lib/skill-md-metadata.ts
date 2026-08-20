import { splitSkillMdFrontmatter } from './skill-md-body'

export function skillFrontmatterField(frontmatter: string | null, field: string): string | null {
  if (!frontmatter) return null
  const prefix = `${field}:`
  const lines = frontmatter.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trimStart()
    if (!trimmed.startsWith(prefix)) continue
    let raw = trimmed.slice(prefix.length).trim()
    // Block scalar (`>-`, `|`, …): the value is the following more-indented
    // lines — vendors write `description: >-`; returning the indicator itself
    // would surface ">-" as the description. Folded (>) joins with spaces,
    // literal (|) keeps newlines.
    const scalar = raw.match(/^([>|])[+-]?$/)
    if (scalar) {
      const block: string[] = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || lines[i + 1]!.trim() === '')) {
        block.push(lines[++i]!.trim())
      }
      while (block.length > 0 && block[block.length - 1] === '') block.pop()
      const joined = block.join(scalar[1] === '>' ? ' ' : '\n').trim()
      return joined || null
    }
    if (
      raw.length >= 2 &&
      ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
    ) {
      raw = raw.slice(1, -1)
    }
    return raw || null
  }
  return null
}

export function skillMarkdownMetadata(markdown: string): {
  body: string
  description: string | null
  name: string | null
} {
  const split = splitSkillMdFrontmatter(markdown)
  return {
    body: split.body,
    description: skillFrontmatterField(split.frontmatter, 'description'),
    name: skillFrontmatterField(split.frontmatter, 'name'),
  }
}

export function slugifySkillName(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      // Elide apostrophes so "writer's voice" → "writers-voice", not
      // "writer-s-voice".
      .replace(/['’‘`´]/g, '')
      // Registry slug grammar is SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
      // (@skillet/protocol) — dots and underscores would 422 at publish, so
      // they collapse to hyphens like every other separator; length caps at
      // the grammar's 63.
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63)
      .replace(/-+$/g, '')
  )
}
