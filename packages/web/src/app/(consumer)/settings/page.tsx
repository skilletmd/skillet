import Link from 'next/link'
import { auth } from '@/auth'
import { ChooseUsername } from '@/components/choose-username'
import { EditDisplayName } from '@/components/edit-display-name'
import { getAuthorProfile } from '@/lib/registry'
import { fetchRegistryWhoami } from '@/lib/registry-session'
import { readSessionCookie } from '@/lib/session-cookie'
import { cookies } from 'next/headers'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { PageHeader } from '@/components/page-header'
import { ConnectedDevicesPanel } from '@/components/connected-devices-panel'
import { McpConnectorRow } from '@/components/settings/mcp-connector-section'
import { SkilletUsagePanel } from '@/components/settings/skillet-usage-panel'
import { fetchMcpLink, type McpLinkResult } from '@/lib/mcp-link'

export const metadata = {
  title: 'Account · Skillet',
  robots: { index: false },
}

async function AccountSettingsPageContent() {
  const session = await auth()

  if (!session?.user) {
    return (
      <div>
        <PageHeader title="Account" />
        <p className="text-sm text-(--ink-2)">
          <Link href="/login" className="font-medium text-(--ink) underline underline-offset-2">
            Sign in
          </Link>{' '}
          to manage your profile and team settings.
        </p>
      </div>
    )
  }

  const registryToken = readSessionCookie(await cookies())
  // whoami (email / brand-claim eligibility), the author profile (display name,
  // avatar, bio, link, X handle), and the MCP link are independent — fetch them
  // together. The profile is only meaningful once a handle is claimed; it falls
  // back to the handle if the registry is offline or the profile isn't readable.
  // No registry token reads as `unauthorized`; the MCP section shows its
  // refresh notice for that state (the registry cookie self-heals via the
  // /api/registry proxy on the same visit, so a refresh restores the block).
  const [whoami, profile, mcpLink] = await Promise.all([
    registryToken ? fetchRegistryWhoami(registryToken) : Promise.resolve(null),
    session.handle
      ? getAuthorProfile(session.handle, { withSession: true })
      : Promise.resolve(null),
    registryToken
      ? fetchMcpLink(registryToken)
      : Promise.resolve<McpLinkResult>({ ok: false, error: 'unauthorized' }),
  ])
  const email = whoami?.email ?? session.user.email
  const brandClaimEligible = whoami?.brand_claim_eligible ?? []

  const profileDisplayName = profile?.displayName ?? session.handle ?? ''
  const profileAvatarUrl = profile?.avatarUrl ?? session.user.image ?? ''

  return (
    <div>
      <PageHeader
        title="Account"
        lede="Your profile, the machines it syncs to, and the agents it serves."
      />

      <div className="space-y-10">
        {!session.handle && <ChooseUsername brandClaimEligible={brandClaimEligible} />}

        {session.handle && (
          <EditDisplayName
            author={session.handle}
            initialName={profileDisplayName}
            initialBio={profile?.bio}
            initialProfileUrl={profile?.profileUrl}
            initialXHandle={profile?.socials?.twitter}
            initialAvatarUrl={profileAvatarUrl}
            email={email}
            showHeader={false}
            collapsible
            detectedAgents={profile?.detectedAgentsAll ?? []}
            initialShownAgents={profile?.shownAgents ?? null}
          />
        )}

        {/* Connections and usage only make sense once a username is claimed —
            before that, the page is just the username picker. The MCP link
            rides in the Connections list as its last row, and the same data
            feeds the Connect hub's inline MCP path. Both are omitted on
            registries without MCP links. */}
        {session.handle && (
          <>
            <ConnectedDevicesPanel
              mcpRow={
                mcpLink.ok || mcpLink.error !== 'unconfigured' ? (
                  <McpConnectorRow link={mcpLink} />
                ) : undefined
              }
              mcpLink={mcpLink}
            />

            <SkilletUsagePanel />
          </>
        )}
      </div>
    </div>
  )
}

export default function AccountSettingsPage() {
  return (
    <DynamicPageBoundary>
      <AccountSettingsPageContent />
    </DynamicPageBoundary>
  )
}
