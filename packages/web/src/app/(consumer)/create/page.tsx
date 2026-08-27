import Link from 'next/link'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { requireSession } from '@/lib/require-session'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { PageHeader } from '@/components/page-header'
import { CARD_TREATMENT, CARD_STATIC } from '@/lib/card-shell'
import { GithubImportPanel } from '@/components/github-import-panel'
import { CommandBlock } from '@/components/command-block'
import { NPX_SKILLET_COMMAND } from '@/config'
import { listOwnedRepos, type OwnedRepo } from '@/lib/github-repos'
import { listConnectedRepos, fetchOwnedReposViaRegistry } from '@/lib/connected-repos'
import { readSessionCookie } from '@/lib/session-cookie'
import { GH_REPO_TOKEN_COOKIE } from '@/app/api/github/connect/callback/route'

export const metadata = {
  title: 'Create · Skillet',
  robots: { index: false },
}

const CREATE_OPTIONS = [
  { href: '/skills/new', title: 'Blank skill', body: 'Start from an empty SKILL.md and write it yourself.' },
  { href: '/kits/new', title: 'New kit', body: 'Bundle skills into a kit to share or deploy.' },
]

async function NewPageContent() {
  const session = await requireSession('/create')
  if (!session.handle) {
    redirect('/settings')
  }

  // Same GitHub state the /import wizard fetches, so the hub's import card shows
  // your own repos + what's syncing in parity with /import.
  const jar = await cookies()
  const repoToken = jar.get(GH_REPO_TOKEN_COOKIE)?.value
  const sessionToken = readSessionCookie(jar)
  const connectedRepos = sessionToken ? await listConnectedRepos(sessionToken) : []
  const connectedFulls = new Set(connectedRepos.map((r) => r.full))
  let connected = false
  let owned: OwnedRepo[] = []
  if (repoToken) {
    connected = true
    owned = await listOwnedRepos(repoToken)
  } else if (sessionToken) {
    const res = await fetchOwnedReposViaRegistry(sessionToken)
    connected = res.connected
    owned = res.repos
  }
  const available = owned.filter((r) => !connectedFulls.has(r.full))

  return (
    <main className={`marketing-home consumer-theme ${PAGE_CONTAINER_CLASS}`}>
      <div className="mx-auto max-w-[720px]">
        <PageHeader title="Create" />

        {/* The agent flow leads. Nobody can answer "what skill do you want to
            write?", but everybody has a thing they keep re-explaining, so the
            page opens with the path that reads that rather than the blank form.
            Two commands and no account needed until it saves. */}
        <div className={`rounded-2xl ${CARD_STATIC} p-5`}>
          <span className="text-base font-semibold text-(--ink)">From what you already do</span>
          <p className="mt-1 text-sm leading-[1.5] text-(--ink-2)">
            Your agent reads the work you keep repeating, drafts the skill, and saves it here.
            Private by default.
          </p>
          <div className="mt-4 grid gap-2">
            <CommandBlock command={NPX_SKILLET_COMMAND} size="sm" bare />
            <CommandBlock command="/skillet create" prompt={null} size="sm" bare />
          </div>
        </div>

        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CREATE_OPTIONS.map((o) => (
            <li key={o.href}>
              <Link
                href={o.href}
                className={`group flex h-full flex-col rounded-2xl ${CARD_TREATMENT} p-5`}
              >
                <span className="text-base font-semibold text-(--ink) group-hover:text-(--accent)">
                  {o.title}
                </span>
                <span className="mt-1 text-sm leading-[1.5] text-(--ink-2)">{o.body}</span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Import from GitHub — full width, same surface as /import. Static
            (not CARD_TREATMENT): it's a container, not a button, so no press/lift. */}
        <div className={`mt-3 rounded-2xl ${CARD_STATIC} p-5`}>
          <span className="text-base font-semibold text-(--ink)">Import from GitHub</span>
          <div className="mt-3">
            <GithubImportPanel
              githubLinked={connected}
              available={available}
              connected={connectedRepos}
              connectReturn="/create"
            />
          </div>
        </div>

        {/* Quiet callout for the desktop app. */}
        <p className="mt-4 text-sm text-(--ink-2)">
          <Link
            href="/install"
            className="font-medium text-(--ink) underline underline-offset-2 hover:text-(--accent)"
          >
            Get the desktop app
          </Link>{' '}
          to import and sync skills with your computer.
        </p>
      </div>
    </main>
  )
}

export default function NewPage() {
  return (
    <DynamicPageBoundary>
      <NewPageContent />
    </DynamicPageBoundary>
  )
}
