import Link from 'next/link'
import { auth } from '@/auth'
import { SkillProposeForm } from '@/components/skill-propose-form'
import { PAGE_CONTAINER_CLASS, PAGE_EYEBROW_CLASS, PAGE_TITLE_CLASS } from '@/lib/page-layout'
import { skillHref, skillProposeHref, loginHref } from '@/lib/urls'

export const metadata = {
  title: 'Propose update · Skillet',
  robots: { index: false },
}

export default async function ProposeSkillPage({
  params,
}: {
  params: Promise<{ author: string; skill: string }>
}) {
  const session = await auth()
  const { author, skill: slug } = await params

  if (!session?.user) {
    return (
      <main className={`marketing-home consumer-theme ${PAGE_CONTAINER_CLASS}`}>
        <p className={PAGE_EYEBROW_CLASS}>Propose update</p>
        <h1 className={PAGE_TITLE_CLASS}>Sign in required</h1>
        <p className="mt-4">
          <Link href={loginHref(skillProposeHref(author, slug))}>Sign in</Link>
        </p>
      </main>
    )
  }

  return (
    <main className={`marketing-home consumer-theme ${PAGE_CONTAINER_CLASS}`}>
      <div className="mx-auto max-w-4xl">
        <p className={PAGE_EYEBROW_CLASS}>
          <Link href={skillHref(author, slug)} className="hover:text-(--ink)">
            @{author}/{slug}
          </Link>
        </p>
        <h1 className={PAGE_TITLE_CLASS}>Propose an update</h1>
        <div className="mt-8">
          <SkillProposeForm author={author} slug={slug} sessionHandle={session.handle} />
        </div>
      </div>
    </main>
  )
}
