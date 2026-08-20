import { frontmatterRows } from '@/lib/frontmatter-display'

/**
 * The SKILL.md frontmatter as a quiet, frameless header above the rendered body —
 * rendered mode otherwise swallows the YAML block, hiding exactly the fields
 * a reader wants at a glance (description, license, author, version). Source
 * mode still shows the raw YAML; this is the human view of the same facts.
 */
export function FrontmatterCard({ yaml }: { yaml: string }) {
  const rows = frontmatterRows(yaml)
  if (rows.length === 0) return null
  const name = rows.find((r) => r.key === 'name')?.value
  const description = rows.find((r) => r.key === 'description')?.value
  const rest = rows.filter((r) => r.key !== 'name' && r.key !== 'description')

  return (
    <div className="mb-6 border-b border-(--line) pb-5">
      {name && <div className="font-mono text-sm font-semibold text-(--ink)">{name}</div>}
      {description && (
        <p className={`text-sm leading-[1.6] text-(--ink-2) ${name ? 'mt-1.5' : ''}`}>
          {description}
        </p>
      )}
      {rest.length > 0 && (
        <dl
          className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 ${name || description ? 'mt-3.5' : ''}`}
        >
          {rest.map((row, i) => (
            <div key={`${row.key}-${i}`} className="contents">
              <dt className="font-mono text-xs text-(--ink-2)">{row.key}</dt>
              <dd className="whitespace-pre-line text-xs text-(--ink)">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
