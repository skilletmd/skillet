import type { AuthorProfileKit, ProfileAuthorKit } from '@/lib/types'
import { KitCard } from '@/components/kit-card'
import { KitCardMenu, type KitCardMenuProps } from '@/components/kits/kit-card-menu'
import { authorKitHref, kitHrefFromRecord, kitEditHref } from '@/lib/urls'
import { authorKitTagline } from '@/lib/author-kit'
import { KIT_CARD_GRID as GRID } from '@/lib/page-layout'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Profile Kits tab — Library-style cover squares in one grid via the shared
 * {@link KitCard}. Each cover's "@owner · N skills" subtitle says what's yours
 * vs subscribed; author/team kits link through to the profile with a role
 * badge. Privacy is enforced upstream — outside viewers never receive private
 * kits.
 *
 * Each card carries a corner action via {@link KitCardMenu}: ✎ edit your own,
 * + subscribe to someone else's, × unsubscribe from one you follow. The × only
 * appears on your own profile — another person's subscriptions aren't yours to
 * drop. Team kits and your own author-kit get no action.
 */
export function ProfileKitsSection({
  author,
  createdKits,
  subscribedKits = [],
  subscribedAuthorKits = [],
  authorKit,
  isSelf,
}: {
  author: string
  createdKits: AuthorProfileKit[]
  subscribedKits?: AuthorProfileKit[]
  subscribedAuthorKits?: ProfileAuthorKit[]
  authorKit?: ProfileAuthorKit
  viewerHandle: string | null
  isSelf: boolean
}) {
  const isEmpty =
    !authorKit &&
    createdKits.length === 0 &&
    subscribedKits.length === 0 &&
    subscribedAuthorKits.length === 0

  if (isEmpty) {
    return (
      <EmptyState>
        {isSelf
          ? 'No kits yet. Curate skills into a kit to share or subscribe.'
          : 'No public kits yet.'}
      </EmptyState>
    )
  }

  // Author-kits are special: a round avatar centered on the skill mosaic (a
  // person, auto-updating); team kits keep a 'team' badge.
  const authorKitProps = (k: ProfileAuthorKit) =>
    k.isTeam
      ? { badge: 'team' as const }
      : {
          avatar: {
            url: k.avatarUrl ?? null,
            initial: (k.name || k.owner).slice(0, 2).toUpperCase(),
          },
        }

  const renderMenu = (menu: KitCardMenuProps | undefined) =>
    menu ? <KitCardMenu {...menu} /> : undefined

  // Your own kits → edit. Someone else's → a +/× subscribe toggle.
  const createdMenu = (kit: AuthorProfileKit): KitCardMenuProps =>
    isSelf
      ? {
          kind: 'owned',
          editHref: kit.slug
            ? kitEditHref(kit.owner ?? author, kit.slug)
            : `/settings/kits/${kit.id}`,
        }
      : { kind: 'kit', kitId: kit.id, owner: kit.owner ?? author, subscribed: !!kit.subscribed }

  return (
    <div className="@container">
      <ul className={GRID}>
        {authorKit && (
          <li key={`author-${authorKit.owner}`}>
            <KitCard
              href={authorKitHref(authorKit.owner)}
              name={authorKit.name}
              owner={authorKit.owner}
              skillCount={authorKit.skillCount}
              privateCount={authorKit.privateCount}
              skillRefs={authorKit.skillRefs}
              skillCategories={authorKit.skillCategories}
              // Not a curated blurb: the author kit describes itself with the
              // same line as its own page. Teams say it via their badge, so only
              // person kits carry the line.
              description={authorKit.isTeam ? undefined : authorKitTagline(authorKit.owner)}
              menu={renderMenu(
                isSelf || authorKit.isTeam
                  ? undefined
                  : {
                      kind: 'author',
                      author: authorKit.owner,
                      owner: authorKit.owner,
                      subscribed: authorKit.subscribed,
                    },
              )}
              // The author-kit on its owner's page: byline is the page.
              hideOwner={authorKit.owner === author}
              {...authorKitProps(authorKit)}
            />
          </li>
        )}
        {createdKits.map((kit) => (
          <li key={kit.id}>
            <KitCard
              kitId={kit.id}
              href={kitHrefFromRecord({ owner: kit.owner ?? author, slug: kit.slug, id: kit.id })}
              name={kit.name}
              owner={kit.owner ?? author}
              skillCount={kit.skillCount}
              skillRefs={kit.skillRefs ?? []}
              skillCategories={kit.skillCategories ?? []}
              category={kit.category}
              visibility={kit.visibility}
              makerAvatarUrl={kit.avatarUrl}
              // Byline is the page; the subtitle carries skill count instead,
              // and the owner's Edit rides there too (no floating coin).
              hideOwner={(kit.owner ?? author) === author}
              {...(isSelf
                ? {
                    editHref: kit.slug
                      ? kitEditHref(kit.owner ?? author, kit.slug)
                      : `/settings/kits/${kit.id}`,
                  }
                : { menu: renderMenu(createdMenu(kit)) })}
            />
          </li>
        ))}
        {subscribedAuthorKits.map((ak) => (
          <li key={`author-${ak.owner}`}>
            <KitCard
              href={authorKitHref(ak.owner)}
              name={ak.name}
              owner={ak.owner}
              skillCount={ak.skillCount}
              skillRefs={ak.skillRefs}
              skillCategories={ak.skillCategories}
              description={ak.isTeam ? undefined : authorKitTagline(ak.owner)}
              menu={renderMenu(
                isSelf
                  ? { kind: 'author', author: ak.owner, owner: ak.owner, subscribed: true }
                  : undefined,
              )}
              {...authorKitProps(ak)}
            />
          </li>
        ))}
        {subscribedKits.map((kit) => (
          <li key={kit.id}>
            <KitCard
              kitId={kit.id}
              href={kitHrefFromRecord({ owner: kit.owner ?? author, slug: kit.slug, id: kit.id })}
              name={kit.name}
              owner={kit.owner ?? author}
              skillCount={kit.skillCount}
              skillRefs={kit.skillRefs ?? []}
              skillCategories={kit.skillCategories ?? []}
              category={kit.category}
              visibility={kit.visibility}
              makerAvatarUrl={kit.avatarUrl}
              menu={renderMenu(
                isSelf
                  ? { kind: 'kit', kitId: kit.id, owner: kit.owner ?? author, subscribed: true }
                  : undefined,
              )}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
