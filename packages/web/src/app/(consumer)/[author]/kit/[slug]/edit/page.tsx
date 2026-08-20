import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { requireSession } from '@/lib/require-session'
import { KitDetailClient } from '@/components/kits/kit-detail-client'
import { type PickerSkill } from '@/components/kits/kit-skill-picker'
import { getKit, getKitByHandle } from '@/lib/kits-server'
import { listMyOrgs } from '@/lib/orgs-server'
import { viewerManagesOrg } from '@/lib/orgs'
import { getAuthorProfile } from '@/lib/registry'
import { getSkillCatalog } from '@/lib/registry-catalog'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { kitHref, kitEditHref } from '@/lib/urls'

async function KitEditPageContent({
  params,
}: {
  params: Promise<{ author: string; slug: string }>
}) {
  const { author, slug } = await params
  const session = await requireSession(kitEditHref(author, slug))

  // Resolve owner+slug → kit (by-handle is the published view; we only need it
  // to find the id, verify ownership, and canonicalize the slug).
  const resolved = await getKitByHandle(author, slug)
  if (resolved.kind === 'not_found') notFound()
  // The auto "Saved" kit is a system bucket — it's edited by saving/unsaving
  // skills, not through a kit editor. No manage surface; send them to the
  // profile's Saved tab where those skills live.
  if (resolved.kind === 'ok' && resolved.kit.kind === 'saved') {
    redirect(`/${resolved.kit.owner}?tab=saved#saved-skills`)
  }
  if (resolved.kind !== 'ok') {
    return (
      <main className={PAGE_CONTAINER_CLASS}>
        <p className="text-base text-(--ink-2)">Could not load kit.</p>
        <Link
          href={session.handle ? `/${session.handle}` : '/'}
          className="mt-4 inline-block text-(--accent) hover:underline"
        >
          Back to your profile
        </Link>
      </main>
    )
  }

  const handle = session.handle ?? null
  // Managing a kit means you own it (owner === your handle) or you're an
  // owner/admin of the team that owns it. Mirrors the registry's
  // canManageKitPrisma so this guard matches what the mutation endpoints allow;
  // a team manager reaching a team kit's editor is not a dead-end. Plain team
  // members and strangers fall through to the public page.
  const owner = resolved.kit.owner
  const canEdit = !!handle && (owner === handle || viewerManagesOrg(await listMyOrgs(), owner))
  // Editing is manager-only; send everyone else to the public kit page.
  if (!canEdit) redirect(kitHref(resolved.kit.owner, resolved.kit.slug))
  // Keep the URL canonical when an old slug alias was used.
  if (resolved.kit.slug !== slug) redirect(kitEditHref(resolved.kit.owner, resolved.kit.slug))

  // The manage view needs the owner's DRAFT (live edits + unpublished diff),
  // which only the by-id endpoint serves. by-handle is published-only.
  const result = await getKit(resolved.kit.id)
  if (result.kind !== 'ok') {
    return (
      <main className={PAGE_CONTAINER_CLASS}>
        <p className="text-base text-(--ink-2)">Could not load kit.</p>
        <Link href={`/${handle}`} className="mt-4 inline-block text-(--accent) hover:underline">
          Back to your profile
        </Link>
      </main>
    )
  }
  const kit = result.kit

  // Absolute origin for the README badge markdown, so the copied snippet works.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'skillet.md'
  const proto = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')
  const origin = `${proto}://${host}`

  // Owners get the Yours/Saved/Popular browse tabs — preload their own + saved
  // skills and the most-installed catalog so the picker isn't a bare search box.
  let mySkills: PickerSkill[] = []
  let savedSkills: PickerSkill[] = []
  let popularSkills: PickerSkill[] = []
  if (handle) {
    const [profile, catalog] = await Promise.all([
      getAuthorProfile(handle, { withSession: true }).catch(() => null),
      getSkillCatalog({ limit: 18 }).catch(() => null),
    ])
    mySkills = (profile?.skills ?? []).map((s) => ({
      skill_id: `${s.author}:${s.slug}`,
      author: s.author,
      slug: s.slug,
      description: s.description || null,
      category: s.category ?? null,
      visibility: s.visibility,
    }))
    savedSkills = (profile?.savedSkills ?? []).map((s) => {
      const [a, sl] = s.skill_id.split(':')
      return {
        skill_id: s.skill_id,
        author: a,
        slug: sl,
        description: s.description ?? null,
        category: s.category ?? null,
      }
    })
    popularSkills = (catalog?.skills ?? []).map((s) => ({
      skill_id: s.skill_id,
      author: s.author,
      slug: s.slug,
      description: s.description ?? null,
      category: s.category ?? null,
    }))
  }

  return (
    <main className={PAGE_CONTAINER_CLASS}>
      <KitDetailClient
        kit={kit}
        canEdit={canEdit}
        origin={origin}
        mySkills={mySkills}
        savedSkills={savedSkills}
        popularSkills={popularSkills}
      />
    </main>
  )
}

export default function KitEditPage(props: { params: Promise<{ author: string; slug: string }> }) {
  return (
    <DynamicPageBoundary>
      <KitEditPageContent {...props} />
    </DynamicPageBoundary>
  )
}
