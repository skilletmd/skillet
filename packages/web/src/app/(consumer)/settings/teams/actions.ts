'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { INVITABLE_ROLES, type InvitableRole } from '@/lib/orgs'
import { createOrg, inviteMember } from '@/lib/orgs-server'
import { slugifyTeam } from '@/lib/team-slug'

export type CreateTeamState = { error?: string; ok?: boolean }
export type InviteState = { error?: string; message?: string }

function asInvitableRole(value: FormDataEntryValue | null): InvitableRole {
  const v = typeof value === 'string' ? value : ''
  return (INVITABLE_ROLES as readonly string[]).includes(v) ? (v as InvitableRole) : 'member'
}

const CREATE_ERRORS: Record<string, string> = {
  invalid_slug: 'That team URL isn’t valid. Use 1–40 lowercase letters, numbers, or hyphens.',
  name_required: 'Give your team a name.',
}

export async function createTeamAction(
  _prev: CreateTeamState,
  formData: FormData,
): Promise<CreateTeamState> {
  const session = await auth()
  if (!session?.user) return { error: 'Please sign in to create a team.' }

  const name = String(formData.get('name') ?? '').trim()
  const rawSlug = String(formData.get('slug') ?? '').trim()
  const slug = slugifyTeam(rawSlug || name)

  if (!name) return { error: 'Give your team a name.' }
  if (!slug) return { error: 'Add a team URL (letters, numbers, hyphens).' }

  const result = await createOrg({ slug, name })

  switch (result.kind) {
    case 'ok':
      revalidatePath('/settings/teams')
      redirect(`/settings/teams/${result.org.slug}`)
    // redirect() throws — unreachable below, but keeps the switch exhaustive.
    // eslint-disable-next-line no-fallthrough
    case 'conflict':
      return { error: 'That team URL is already taken. Try another.' }
    case 'invalid':
      return { error: CREATE_ERRORS[result.code] ?? 'Check the team name and URL.' }
    case 'unauthorized':
      return { error: 'Your session expired. Please sign in again.' }
    default:
      return { error: 'Couldn’t create the team. Please try again.' }
  }
}

const INVITE_ERRORS: Record<string, string> = {
  provide_handle_or_email: 'Enter a handle or an email, not both.',
  cannot_invite_as_owner: 'Members can’t be invited as owner.',
  already_member: 'That person is already on the team.',
  already_invited: 'That person already has a pending invite.',
}

export async function inviteMemberAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const session = await auth()
  if (!session?.user) return { error: 'Please sign in.' }

  const slug = String(formData.get('slug') ?? '').trim()
  const role = asInvitableRole(formData.get('role'))
  const identifier = String(formData.get('identifier') ?? '').trim()
  if (!slug) return { error: 'Missing team.' }
  if (!identifier) return { error: 'Enter a handle or email to invite.' }

  const isEmail = identifier.includes('@')
  const body = isEmail
    ? { email: identifier, role }
    : { handle: identifier.replace(/^@/, ''), role }

  const result = await inviteMember(slug, body)

  switch (result.kind) {
    case 'added':
      revalidatePath(`/settings/teams/${slug}`)
      return { message: `${identifier} was added to the team.` }
    case 'invited':
      revalidatePath(`/settings/teams/${slug}`)
      return { message: `Invite sent to ${identifier}.` }
    case 'forbidden':
      return { error: 'Only owners and admins can invite members.' }
    case 'not_found':
      return { error: 'Team not found.' }
    case 'conflict':
      return { error: INVITE_ERRORS[result.code] ?? 'That person is already invited.' }
    case 'invalid':
      return { error: INVITE_ERRORS[result.code] ?? 'Check the handle or email.' }
    case 'unauthorized':
      return { error: 'Your session expired. Please sign in again.' }
    default:
      return { error: 'Couldn’t send the invite. Please try again.' }
  }
}
