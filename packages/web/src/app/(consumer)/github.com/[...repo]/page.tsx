import { redirect } from 'next/navigation'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'

export const metadata = { robots: { index: false } }

// Paste a GitHub repo right after the host — e.g.
// /github.com/kostja94/marketing-skills/tree/main — and land in the importer.
async function GithubImportShortcutContent({
  params,
}: {
  params: Promise<{ repo: string[] }>
}) {
  const { repo } = await params
  const path = repo.join('/')
  redirect(`/import?url=${encodeURIComponent(`github.com/${path}`)}`)
  return null
}

export default function GithubImportShortcut(props: { params: Promise<{ repo: string[] }> }) {
  return (
    <DynamicPageBoundary>
      <GithubImportShortcutContent {...props} />
    </DynamicPageBoundary>
  )
}
