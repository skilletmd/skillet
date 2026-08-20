/**
 * Lenient YAML-frontmatter reader for DISPLAY — turns a SKILL.md frontmatter
 * block into ordered rows for the rendered-mode header card. Handles the
 * shapes skills actually use (flat scalars, one level of nesting, `- ` lists,
 * folded/indented multi-line strings). Anything it can't make sense of is
 * passed through as raw text — this is presentation, never validation; the
 * protocol owns the real parsing rules.
 */

export type FrontmatterRow = { key: string; value: string }

function unquote(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))) {
    return v.slice(1, -1)
  }
  return v
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

/**
 * Flatten the block into ordered `key → value` rows. Nested maps become
 * dotted keys (`metadata.author`); lists join with `, `; folded scalars join
 * their continuation lines with spaces.
 */
export function frontmatterRows(yaml: string): FrontmatterRow[] {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n')
  const rows: FrontmatterRow[] = []
  let i = 0

  function readScalar(inline: string, baseIndent: number): string {
    const indicator = /^[>|][+-]?$/.test(inline.trim()) ? inline.trim()[0] : null
    const parts: string[] = indicator || !inline.trim() ? [] : [unquote(inline)]
    while (i < lines.length) {
      const line = lines[i]!
      if (!line.trim()) {
        i++
        continue
      }
      if (indentOf(line) <= baseIndent) break
      parts.push(line.trim())
      i++
    }
    return parts.join(indicator === '|' ? '\n' : ' ')
  }

  function readList(baseIndent: number): string {
    const items: string[] = []
    while (i < lines.length) {
      const line = lines[i]!
      if (!line.trim()) {
        i++
        continue
      }
      if (indentOf(line) <= baseIndent) break
      const m = line.trim().match(/^-\s*(.*)$/)
      if (!m) break
      items.push(unquote(m[1] ?? ''))
      i++
    }
    return items.join(', ')
  }

  function readEntries(baseIndent: number, prefix: string): void {
    while (i < lines.length) {
      const line = lines[i]!
      if (!line.trim()) {
        i++
        continue
      }
      const indent = indentOf(line)
      if (indent < baseIndent) return
      const m = line.trim().match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
      if (!m) {
        // Not a mapping line at this level — surface it raw so nothing is lost.
        rows.push({ key: prefix ? `${prefix}…` : '…', value: line.trim() })
        i++
        continue
      }
      i++
      const key = prefix ? `${prefix}.${m[1]}` : m[1]!
      const inline = m[2] ?? ''
      const next = lines.slice(i).find((l) => l.trim())
      if (!inline.trim() && next && indentOf(next) > indent && next.trim().startsWith('- ')) {
        rows.push({ key, value: readList(indent) })
      } else if (!inline.trim() && next && indentOf(next) > indent && /^[A-Za-z0-9_.-]+:/.test(next.trim())) {
        readEntries(indentOf(next), key)
      } else {
        rows.push({ key, value: readScalar(inline, indent) })
      }
    }
  }

  readEntries(0, '')
  return rows.filter((r) => r.value !== '')
}
