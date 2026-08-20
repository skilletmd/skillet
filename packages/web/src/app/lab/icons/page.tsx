import type { Metadata } from 'next'
import { CategoryIcon } from '@/components/category-icons'
import {
  CATEGORIES_BY_SECTION,
  SECTION_LABEL,
  swatchHsl,
  type Category,
} from '@/lib/categories'

export const metadata: Metadata = {
  title: 'Category icons — Lab',
  robots: { index: false, follow: false },
}

function IconCard({ cat }: { cat: Category }) {
  return (
    <div className="rounded-xl border border-(--line) bg-(--surface) p-4">
      <div className="flex items-center gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl text-white"
          style={{ background: swatchHsl(cat) }}
        >
          <CategoryIcon cat={cat.key} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-(--ink)">{cat.label}</p>
          <p className="font-mono text-xs text-(--ink-2)">{cat.key}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-(--ink-2)">{cat.blurb}</p>
      {/* The glyph in ink at sidebar size (16/20px, stroke 1.5) next to a
          cover-scale render (48px) at a lighter 1.25 stroke, so the heavy end
          stays optically consistent with the small end. */}
      <div className="mt-3 flex items-center gap-4 border-t border-(--line) pt-3 text-(--ink)">
        <CategoryIcon cat={cat.key} className="text-base" />
        <CategoryIcon cat={cat.key} className="text-xl" />
        <span className="ml-auto flex items-center gap-1 text-xs text-(--ink-2)">
          <span>1.5</span>
          <CategoryIcon cat={cat.key} className="text-5xl text-(--ink)" />
          <CategoryIcon cat={cat.key} className="text-5xl text-(--ink)" strokeWidth={1.25} />
          <span>1.25</span>
        </span>
      </div>
    </div>
  )
}

export default function IconsPage() {
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-12">
      <h1 className="text-2xl font-bold text-(--ink)">Category icons</h1>
      <p className="mt-2 max-w-2xl text-sm text-(--ink-2)">
        One line-drawn glyph per browse category — 16×16, single stroke,{' '}
        <code className="font-mono">currentColor</code>. Left tile shows the icon on its category
        swatch; the row below shows it in ink at sidebar size (16/20px, stroke 1.5), then at
        cover scale (48px) comparing stroke 1.5 vs a lighter 1.25 — the same glyph reads heavy
        when a fixed 1.5 stroke scales up, so large usage wants the lighter weight.
      </p>

      {CATEGORIES_BY_SECTION.map(({ section, categories }) => (
        <section key={section} className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-(--ink-2)">
            {SECTION_LABEL[section]}
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => (
              <IconCard key={cat.key} cat={cat} />
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
