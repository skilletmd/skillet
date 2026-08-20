import { redirect } from 'next/navigation'

// GitHub settings moved from /settings/repos to /settings/github. Preserve the
// old URL (and any ?error= params) by forwarding to it.
export default async function LegacyReposSettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined
  redirect(error ? `/settings/github?error=${encodeURIComponent(error)}` : '/settings/github')
}
