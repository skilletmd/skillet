/** Split YAML frontmatter from SKILL.md body for display on the skill page. */
export function splitSkillMdFrontmatter(markdown: string): {
  frontmatter: string | null
  body: string
} {
  const trimmed = markdown.replace(/^\uFEFF/, '')
  if (!trimmed.startsWith('---')) {
    return { frontmatter: null, body: trimmed.trim() }
  }

  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) {
    return { frontmatter: null, body: trimmed.trim() }
  }

  const frontmatter = trimmed.slice(4, end).trim()
  const body = trimmed
    .slice(end + 4)
    .replace(/^\s*\n/, '')
    .trim()
  return { frontmatter, body }
}
