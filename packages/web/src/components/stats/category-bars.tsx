import Link from 'next/link'
import type { CategoryStat } from '@/lib/registry'
import { CATEGORY_BY_KEY, isCategoryKey, swatchHsl } from '@/lib/categories'
import { CategoryMark } from '@/components/category-mark'
import { Panel } from '@/components/ui/panel'

const numberFormat = new Intl.NumberFormat('en-US')

/**
 * Skills per category, busiest first — a horizontal bar each, tinted with that
 * category's own swatch so the chart matches the color language used on every
 * skill mark. Each row links into the category's browse filter.
 */
export function CategoryBars({ categories }: { categories: CategoryStat[] }) {
  const max = Math.max(1, ...categories.map((c) => c.skills))

  return (
    <Panel>
      <h2 className="text-2xl font-semibold tracking-tight text-(--ink)">By category</h2>
      <p className="mt-1 text-sm text-(--ink-2)">Where the catalog is deepest.</p>

      {categories.length === 0 && (
        <p className="mt-5 text-sm text-(--ink-2)">
          No public skills yet. Categories appear as skills are published.
        </p>
      )}

      <ul className="mt-5 flex flex-col gap-3">
        {categories.map((c) => {
          const def = isCategoryKey(c.key) ? CATEGORY_BY_KEY[c.key] : null
          const color = def ? swatchHsl(def) : 'var(--ink-2)'
          const label = def?.label ?? c.key
          const pct = Math.max(2, Math.round((c.skills / max) * 100))
          return (
            <li key={c.key}>
              <Link
                href={`/browse/all?category=${encodeURIComponent(c.key)}`}
                className="group grid grid-cols-[7.5rem_1fr_auto] items-center gap-3"
              >
                <span className="flex items-center gap-2 truncate text-sm font-medium text-(--ink) group-hover:text-(--accent)">
                  {def ? (
                    <CategoryMark cat={def} size={11} />
                  ) : (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                  )}
                  <span className="truncate">{label}</span>
                </span>
                <span className="h-2.5 rounded-full bg-(--bg)">
                  <span
                    className="block h-full rounded-full transition-[width]"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </span>
                <span className="w-16 text-right text-sm font-semibold tabular-nums text-(--ink-2)">
                  {numberFormat.format(c.skills)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
