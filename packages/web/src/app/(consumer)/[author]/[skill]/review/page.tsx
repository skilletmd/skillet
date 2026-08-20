import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { ProposedChanges } from '@/components/proposed-changes'
import { PAGE_CONTAINER_CLASS, PAGE_EYEBROW_CLASS, PAGE_TITLE_CLASS } from '@/lib/page-layout'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { skillHref, skillReviewHref } from '@/lib/urls'

export const metadata = {
  title: 'Review changes · Skillet',
  robots: { index: false },
}

/**
 * The dedicated review surface — sibling to the edit page and built on the same
 * shell. Reviewing a proposed change is the mirror of editing: you see what's
 * different and decide. The owner-only data load + decision logic lives in
 * {@link ProposedChanges} (it runs in the browser with the session cookie); this
 * page just frames it like the editor.
 */
export default async function ReviewSkillPage({
  params,
}: {
  params: Promise<{ author: string; skill: string }>
}) {
  await markDynamicRoute()
  const { author, skill: slug } = await params
  const session = await auth()
  if (!session?.handle) {
    redirect(`/login?callbackUrl=${encodeURIComponent(skillReviewHref(author, slug))}`)
  }

  return (
    <main className={`marketing-home consumer-theme ${PAGE_CONTAINER_CLASS}`}>
      <div className="mx-auto max-w-4xl">
        <p className={PAGE_EYEBROW_CLASS}>
          <Link href={skillHref(author, slug)} className="hover:text-(--ink)">
            @{author}/{slug}
          </Link>
        </p>
        <h1 className={PAGE_TITLE_CLASS}>Review changes</h1>
        <p className="mt-3 max-w-[58ch] text-base leading-[1.6] text-(--ink-2)">
          Someone proposed an update to this skill. See what changed, then publish it or reject it.
        </p>
        <div className="mt-8">
          <ProposedChanges author={author} slug={slug} standalone />
        </div>
      </div>
    </main>
  )
}
