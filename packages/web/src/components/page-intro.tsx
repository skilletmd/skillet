import {
  PAGE_EYEBROW_CLASS,
  PAGE_LEDE_CLASS,
  PAGE_TITLE_CLASS,
} from '@/lib/page-layout'

/**
 * The big editorial page header — accent eyebrow + large title + lede — shared by
 * marketing, auth, and settings surfaces. (The compact in-app header with a
 * 26px title and inline action is {@link import('./page-header').PageHeader}.)
 * One component so these three lines don't drift in size or spacing per page.
 */
export function PageIntro({
  eyebrow,
  title,
  lede,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  lede?: React.ReactNode
}) {
  return (
    <>
      {eyebrow && <p className={PAGE_EYEBROW_CLASS}>{eyebrow}</p>}
      <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
      {lede && <p className={PAGE_LEDE_CLASS}>{lede}</p>}
    </>
  )
}
