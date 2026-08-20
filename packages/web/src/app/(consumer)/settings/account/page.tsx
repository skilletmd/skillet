import { redirect } from 'next/navigation'

// Account settings now live at the bare /settings index. Preserve the old URL
// (and any ?linked=/?error= params) by forwarding to it.
export default async function LegacyAccountSettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ linked?: string; error?: string }>
}) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  if (sp.linked) qs.set('linked', sp.linked)
  if (sp.error) qs.set('error', sp.error)
  const query = qs.toString()
  redirect(query ? `/settings?${query}` : '/settings')
}
