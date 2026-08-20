import type { CSSProperties } from 'react'
import Link from 'next/link'
import { type Doc, extractHeadings } from '@/lib/docs'
import { DocContent } from '@/components/doc-content'
import { DOC_NAV } from '@/lib/docs-nav'
import { panelHues } from '@/lib/docs-panel'
import { PAGE_LEDE_CLASS, PAGE_TITLE_CLASS } from '@/lib/page-layout'
import { ChevronRight } from '@/components/ui/icons'

function docHref(slug: string[]) {
  return slug.length ? '/docs/' + slug.join('/') : '/docs'
}

function findAdjacentPages(href: string) {
  const allItems = DOC_NAV.flatMap((s) => s.items)
  const idx = allItems.findIndex((item) => item.href === href)
  return {
    prev: idx > 0 ? allItems[idx - 1] : null,
    next: idx >= 0 && idx < allItems.length - 1 ? allItems[idx + 1] : null,
  }
}

/** Renders one doc as an article with header art, body, prev/next, and on-page nav. */
export function DocArticle({ doc }: { doc: Doc }) {
  const href = docHref(doc.slug)
  const hueSeed = doc.slug.join('/') || 'overview'
  const headings = extractHeadings(doc.content)
  const { prev, next } = findAdjacentPages(href)

  return (
    <div className="flex gap-10">
      {/* Main content */}
      <article className="min-w-0 flex-1">
        <h1 className={PAGE_TITLE_CLASS}>{doc.title}</h1>
        {doc.description && <p className={PAGE_LEDE_CLASS}>{doc.description}</p>}

        {doc.image ? (
          <div
            className="docs-img-panel mt-6 mb-8 flex justify-center rounded-2xl px-6 py-5"
            style={
              {
                '--g1': panelHues(hueSeed).g1,
                '--g2': panelHues(hueSeed).g2,
              } as CSSProperties
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={doc.image} alt="" className="docs-hero-art max-h-[180px] w-auto" />
          </div>
        ) : (
          <hr className="my-6 border-(--line)" />
        )}

        <DocContent content={doc.content} />

        {/* Prev/next navigation */}
        <div className="mt-12 flex items-center justify-between border-t border-(--line) pt-6 text-sm">
          {prev ? (
            <Link
              href={prev.href}
              className="flex items-center gap-2 text-(--ink-2) hover:text-(--ink)"
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M10 4L6 8l4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {prev.title}
            </Link>
          ) : (
            <div />
          )}
          {next ? (
            <Link
              href={next.href}
              className="flex items-center gap-2 text-(--ink-2) hover:text-(--ink)"
            >
              {next.title}
              <ChevronRight className="text-base" />
            </Link>
          ) : (
            <div />
          )}
        </div>
      </article>

      {/* Right rail: on-page anchor nav */}
      {headings.length > 0 && (
        <aside className="hidden w-48 shrink-0 xl:block">
          <div className="sticky top-20">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
              On this page
            </p>
            <ul className="space-y-1.5">
              {headings.map((h) => (
                <li key={h.id}>
                  <Link
                    href={`#${h.id}`}
                    className="block text-xs leading-relaxed text-(--ink-2) hover:text-(--ink)"
                    style={{ paddingLeft: h.level > 2 ? '0.75rem' : '0' }}
                  >
                    {h.text}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  )
}
