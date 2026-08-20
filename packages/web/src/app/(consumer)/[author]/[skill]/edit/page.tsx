import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { auth } from '@/auth'
import { SkillStudioEditor } from '@/components/skill-studio-editor'
import { SkillIcon } from '@/components/directory-card'
import { BadgeSnippet } from '@/components/badge-snippet'
import { OwnerProposalAlerts } from '@/components/owner-proposal-alerts'
import { DeprecateSkillControl } from '@/components/deprecate-skill-control'
import { CategorySelectControl } from '@/components/category-select-control'
import { isCategoryKey } from '@/lib/categories'
import { Eyebrow } from '@/components/ui/eyebrow'
import { getSkill } from '@/lib/registry'
import { PAGE_CONTAINER_CLASS, PAGE_EYEBROW_CLASS } from '@/lib/page-layout'
import { cookies, headers } from 'next/headers'
import { readSessionCookie } from '@/lib/session-cookie'
import { entryFromText, SKILL_ENTRYPOINT, type BundleFiles } from '@/lib/skill-bundle'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { profileHref, skillEditHref, skillHref, skillProposeHref } from '@/lib/urls'
import { viewerCanManageSkill, viewerCanPropose } from '@/lib/skill-access'
import { formatShortDate } from '@/lib/feed-format'

export const metadata = {
  title: 'Manage skill · Skillet',
  robots: { index: false },
}

async function loadSkillBundle(
  author: string,
  slug: string,
): Promise<{ files: BundleFiles; baseHash: string | null; visibility: 'private' | 'public' }> {
  const jar = await cookies()
  const token = readSessionCookie(jar) ?? null
  const base =
    process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'

  const headers: HeadersInit = { accept: 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`

  const manifestRes = await fetch(
    `${base}${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/manifest`,
    { headers, cache: 'no-store' },
  )
  if (!manifestRes.ok) notFound()
  const manifest = (await manifestRes.json()) as {
    latest_hash: string | null
    visibility?: 'private' | 'public'
  }
  const visibility = manifest.visibility === 'public' ? 'public' : 'private'
  const hash = manifest.latest_hash
  if (!hash) {
    return {
      files: { [SKILL_ENTRYPOINT]: entryFromText('---\nname: skill\n---\n\n') },
      baseHash: null,
      visibility,
    }
  }

  const versionRes = await fetch(
    `${base}${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(hash)}`,
    { headers, cache: 'no-store' },
  )
  if (!versionRes.ok) notFound()
  // The registry serves versions in wire format (path -> { enc, data }); pass
  // the whole bundle through so supporting files survive a republish.
  const version = (await versionRes.json()) as { files?: BundleFiles }
  if (!version.files?.[SKILL_ENTRYPOINT]) notFound()
  return { files: version.files, baseHash: hash, visibility }
}

export default async function EditSkillPage({
  params,
}: {
  params: Promise<{ author: string; skill: string }>
}) {
  await markDynamicRoute()
  const { author, skill: slug } = await params
  // author/slug feed a redirect callbackUrl; a malformed segment (e.g. a
  // backslash) could craft an off-site redirect. They must be valid
  // handle/slug identifiers — anything else is not a real skill page (404).
  // Deliberately looser than the publish grammar ([a-z0-9-]) so legacy slugs
  // with . or _ still resolve; both must start alnum and contain no / \ or
  // control chars.
  const HANDLE_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i
  if (!HANDLE_SLUG_RE.test(author) || !HANDLE_SLUG_RE.test(slug)) {
    notFound()
  }
  const session = await auth()
  if (!session?.handle) {
    redirect(`/login?callbackUrl=${encodeURIComponent(skillEditHref(author, slug))}`)
  }

  // /edit is a manager-only surface: its Save calls the owner-only publish
  // endpoint, so rendering it for anyone else is a dead-end that only fails on
  // Save. Gate on load with the same rules the public page uses to pick its
  // affordance — a proposer goes to /propose, everyone else to the public page —
  // so nobody lands on an editor they can't save.
  if (!(await viewerCanManageSkill(session.handle, author))) {
    if (await viewerCanPropose(author, slug)) {
      redirect(skillProposeHref(author, slug))
    }
    redirect(skillHref(author, slug))
  }

  const [{ files, baseHash, visibility }, skill] = await Promise.all([
    loadSkillBundle(author, slug),
    getSkill(author, slug, { withSession: true }),
  ])

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'skillet.md'
  const proto = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')
  const origin = `${proto}://${host}`

  return (
    <main className={`marketing-home consumer-theme ${PAGE_CONTAINER_CLASS}`}>
      <div className="mx-auto max-w-[1120px]">
        {/* Header: the skill's cover + its real name, so you know what you edit. */}
        <div className="flex items-start gap-4">
          <div className="relative h-16 w-16 shrink-0">
            <SkillIcon seed={`${author}/${slug}`} category={skill?.category ?? null} />
          </div>
          <div className="min-w-0">
            <p className={PAGE_EYEBROW_CLASS}>Manage skill</p>
            <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-(--ink) sm:text-3xl">
              {skill?.title ?? slug}
            </h1>
            <p className="mt-1 font-mono text-sm text-(--ink-2)">
              <Link href={profileHref(author)} className="hover:text-(--accent)">
                @{author}
              </Link>
              /{slug}
            </p>
          </div>
        </div>

        {/* The editor owns the two-column layout (code + one right rail). The
            manage sections are handed in as that rail's content, so the
            transient scan-findings panel stacks above them instead of forcing a
            third column that crushes the editor. */}
        <div className="mt-8">
          <SkillStudioEditor
            mode="edit"
            author={author}
            slug={slug}
            initialFiles={files}
            baseHash={baseHash}
            initialVisibility={visibility}
            orgMode={author !== session.handle}
            sessionHandle={session.handle}
            categoryControl={
              <CategorySelectControl
                author={author}
                slug={slug}
                initialCategory={isCategoryKey(skill?.category) ? skill.category : null}
              />
            }
            sidebar={
              <>
                {/* Renders only when there are pending proposals to review —
                    otherwise nothing, so it never leaves an orphan header. */}
                <OwnerProposalAlerts author={author} slug={slug} />

                {skill?.versions && skill.versions.length > 0 && (
                  <section className="py-4 first:pt-0">
                    <Eyebrow>Version history</Eyebrow>
                    <ul className="mt-3 divide-y divide-(--line)">
                      {skill.versions.map((v, i) => (
                        <li key={v.version || `v-${i}`} className="py-3 first:pt-0">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-mono text-sm text-(--ink)">{v.version}</span>
                            <span className="shrink-0 font-mono text-xs text-(--ink-2)">
                              {formatShortDate(v.publishedAt)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {skill?.visibility !== 'private' && (
                  <div className="py-4">
                    <BadgeSnippet
                      badgePath={`${origin}/api/badge/${author}/${slug}`}
                      targetUrl={`${origin}${skillHref(author, slug)}`}
                      alt={`${skill?.title ?? slug} on Skillet`}
                    />
                  </div>
                )}

                {/* Destructive action — set apart with a hairline, not a card. */}
                <DeprecateSkillControl
                  author={author}
                  slug={slug}
                  initialDeprecated={skill?.deprecated ?? false}
                  initialMessage={skill?.deprecationMessage ?? null}
                />
              </>
            }
          />
        </div>
      </div>
    </main>
  )
}
