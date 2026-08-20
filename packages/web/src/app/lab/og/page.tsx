import { getAuthorProfile, getSkillCatalog } from '@/lib/registry'
import { getPost, getPostSlugs } from '@/lib/blog'
import { OG, ogImagePath, type OgArgs } from '@/lib/og'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { Suspense } from 'react'

interface Card {
  page: string
  route: string
  args: OgArgs
  // What X shows in the link card: the page's og:title + domain.
  metaTitle: string
  tweet: string
}

function Avatar() {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 999,
        background: 'var(--ink)',
        color: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: 16,
        flex: '0 0 auto',
      }}
    >
      S
    </div>
  )
}

// A realistic X (Twitter) post with a summary_large_image link card.
function TweetMock({
  ogUrl,
  metaTitle,
  tweet,
}: {
  ogUrl: string
  metaTitle: string
  tweet: string
}) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 16,
        background: 'var(--surface)',
        padding: 16,
        display: 'flex',
        gap: 12,
      }}
    >
      <Avatar />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, lineHeight: 1.2 }}
        >
          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>Skillet</span>
          <span style={{ color: '#1d9bf0', fontSize: 15 }}>✔</span>
          <span style={{ color: 'var(--ink-2)' }}>@skillet · now</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 15, lineHeight: 1.4, color: 'var(--ink)' }}>
          {tweet}
        </div>

        {/* link card */}
        <a
          href={ogUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'block',
            marginTop: 12,
            border: '1px solid var(--line)',
            borderRadius: 16,
            overflow: 'hidden',
            textDecoration: 'none',
            position: 'relative',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ogUrl}
            alt={metaTitle}
            width={1200}
            height={630}
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
          {/* X overlays the page title (og:title) bottom-left on summary_large_image */}
          <span
            style={{
              position: 'absolute',
              left: 12,
              bottom: 12,
              maxWidth: 'calc(100% - 24px)',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              background: 'rgba(0,0,0,0.72)',
              color: '#fff',
              fontSize: 12.5,
              borderRadius: 6,
              padding: '2px 8px',
            }}
          >
            {metaTitle}
          </span>
        </a>

        {/* action row, for the "it's a tweet" feel */}
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            justifyContent: 'space-between',
            maxWidth: 360,
            color: 'var(--ink-2)',
            fontSize: 13,
          }}
        >
          <span>💬 12</span>
          <span>🔁 48</span>
          <span>♡ 230</span>
          <span>↗</span>
        </div>
      </div>
    </div>
  )
}

async function InternalOgContent() {
  await markDynamicRoute()
  const { skills } = await getSkillCatalog({ limit: 1 }).catch(() => ({
    skills: [] as Awaited<ReturnType<typeof getSkillCatalog>>['skills'],
  }))
  const topSkill = skills[0]
  const profile = topSkill ? await getAuthorProfile(topSkill.author).catch(() => null) : null
  const firstPostSlug = getPostSlugs()[0]
  const firstPost = firstPostSlug ? getPost(firstPostSlug) : null

  const cards: Card[] = [
    {
      page: 'Home',
      route: '/',
      args: OG.home(),
      metaTitle: 'Skillet',
      tweet: 'The trust network for AI skills is live.',
    },
    {
      page: 'Skills directory',
      route: '/skills',
      args: OG.skills(),
      metaTitle: 'Skills — Skillet',
      tweet: '900k skills out there. Here are the ones worth running.',
    },
    {
      page: 'Skill detail',
      route: '/skills/[author]/[slug]',
      args: topSkill
        ? OG.skill({
            author: topSkill.author,
            slug: topSkill.slug,
            description: topSkill.description,
            installs: topSkill.install_count,
            category: topSkill.category,
            faces: topSkill.used_by?.map((u) => u.handle).filter(Boolean),
          })
        : OG.skill({
            author: 'grace-reviews',
            slug: 'pr-review-strict',
            description: 'A strict, kind PR reviewer that catches the real bugs.',
            installs: 9120,
            category: 'quality',
            faces: ['marco-dev', 'ana-builds', 'kenji-data', 'priya-ml', 'sam-writes'],
          }),
      metaTitle: `${topSkill?.slug ?? 'pr-review-strict'} — Skillet`,
      tweet: `just published ${topSkill ? `${topSkill.slug}` : 'pr-review-strict'} 🔥 give it a run`,
    },
    {
      page: 'Profile',
      route: '/[author]',
      args: profile
        ? OG.profile({
            handle: profile.username,
            name: profile.displayName,
            bio: profile.bio,
            followers: profile.followers,
            installs: profile.totalInstalls,
            skills: profile.skills.filter((s) => s.visibility !== 'private').length,
            cats: Array.from(
              new Set(profile.skills.map((s) => s.category).filter(Boolean) as string[]),
            ).slice(0, 3),
          })
        : OG.profile({
            handle: 'grace-reviews',
            name: 'Grace Liu',
            bio: 'A strict, kind code reviewer.',
            followers: 1280,
            installs: 17030,
            skills: 12,
            cats: ['quality', 'security', 'agents'],
          }),
      metaTitle: `${profile?.displayName ?? 'Grace Liu'} on Skillet`,
      tweet: 'follow me on Skillet for code-review and security skills 👇',
    },
    {
      page: 'Feed',
      route: '/feed',
      args: OG.feed(),
      metaTitle: 'Your feed — Skillet',
      tweet: 'the feed of skills from people you actually trust.',
    },
    {
      page: 'Team',
      route: '/feed/team/acme',
      args: OG.team('Acme'),
      metaTitle: 'Acme on Skillet',
      tweet: 'everything my team is shipping, in one feed.',
    },
    {
      page: 'Kit',
      route: '/kits/[slug]',
      args: OG.kit({
        name: 'frontend-essentials',
        seed: 'kit_frontend_essentials',
        handle: topSkill?.author ?? 'grace-reviews',
        count: 12,
        subscribers: 412,
        cats: ['frontend', 'design', 'quality', 'agents', 'frontend', 'design'],
        faces: ['marco-dev', 'ana-builds', 'kenji-data', 'priya-ml', 'sam-writes'],
      }),
      metaTitle: 'frontend-essentials — Skillet',
      tweet: 'subscribe to my frontend kit and stay in sync everywhere.',
    },
    {
      page: 'Docs',
      route: '/docs',
      args: OG.docs(),
      metaTitle: 'Docs — Skillet',
      tweet: 'everything you need to get started with Skillet.',
    },
    {
      page: 'Docs article',
      route: '/docs/[slug]',
      args: OG.docs({ title: 'Skills and kits' }),
      metaTitle: 'Skills and kits · Skillet',
      tweet: 'how skills and kits fit together, explained.',
    },
    {
      page: 'Blog post',
      route: '/blog/[slug]',
      args: firstPost
        ? OG.blog({ title: firstPost.title, subtitle: firstPost.description ?? undefined })
        : OG.blog({
            title: 'Why authorship does not matter',
            subtitle: 'Trust the curator, not the author.',
          }),
      metaTitle: `${firstPost?.title ?? 'Why authorship does not matter'} — Skillet`,
      tweet: 'new post: why authorship does not matter.',
    },
    {
      page: 'Install',
      route: '/install',
      args: OG.install(),
      metaTitle: 'Install Skillet — macOS',
      tweet: 'install Skillet and sync your first skill in under a minute.',
    },
  ]

  return (
    <main style={{ maxWidth: 1320, margin: '0 auto', padding: '32px 20px 80px' }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink)' }}>OG cards</h1>
      <p style={{ marginTop: 8, color: 'var(--ink-2)', fontSize: 15 }}>
        Every page type as it appears in a post on X. Cards build from the same <code>lib/og</code>{' '}
        source the real pages use; skill, profile, and blog pull live data. Click a card to open the
        raw image.
      </p>

      <div
        style={{
          marginTop: 28,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))',
          gap: 28,
        }}
      >
        {cards.map((c) => (
          <section key={c.page}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{c.page}</h2>
              <code style={{ fontSize: 13, color: 'var(--ink-2)' }}>{c.route}</code>
            </div>
            <TweetMock ogUrl={ogImagePath(c.args)} metaTitle={c.metaTitle} tweet={c.tweet} />
          </section>
        ))}
      </div>
    </main>
  )
}

export default function InternalOgPage() {
  return (
    <Suspense fallback={null}>
      <InternalOgContent />
    </Suspense>
  )
}
