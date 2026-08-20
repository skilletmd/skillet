'use client'

import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { circularReveal } from '@/lib/view-transition'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { Input, Textarea, FieldLabel } from '@/components/ui/input'
import { SettingsSection } from '@/components/ui/setting-section'
import { Avatar } from '@/components/ui/avatar'
import { AgentGlyph } from '@/components/agent-glyph'
import { AgentsVisibilitySelect, ORDER as AGENT_ORDER } from '@/components/agents-visibility-select'
import { runtimeLabel } from '@/lib/runtime-labels'
import {
  AVATAR_TINT_HUES,
  avatarHue,
  avatarTintGradientForHue,
  defaultAvatarUrls,
  isDefaultAvatar,
  readAvatarHue,
  withAvatarHue,
} from '@/lib/avatar-color'
import { cn } from '@/lib/cn'
import { SKILLET_EVENTS } from '@/lib/events'
import {
  MAX_DISPLAY_NAME,
  MAX_PROFILE_BIO,
  MAX_PROFILE_URL,
  normalizeProfileUrl,
  updateProfile,
  uploadAvatar,
  validateProfileUpdate,
} from '@/lib/profile-update'

interface ProfileFormState {
  name: string
  bio: string
  profileUrl: string
  xHandle: string
  avatarUrl: string
}

function cleanState(value: ProfileFormState): ProfileFormState {
  return {
    name: value.name.trim(),
    bio: value.bio.trim(),
    profileUrl: normalizeProfileUrl(value.profileUrl),
    xHandle: value.xHandle.trim().replace(/^@/, ''),
    avatarUrl: value.avatarUrl.trim(),
  }
}

function sameProfile(a: ProfileFormState, b: ProfileFormState) {
  const left = cleanState(a)
  const right = cleanState(b)
  return (
    left.name === right.name &&
    left.bio === right.bio &&
    left.profileUrl === right.profileUrl &&
    left.xHandle === right.xHandle &&
    left.avatarUrl === right.avatarUrl
  )
}

export function EditDisplayName({
  author,
  initialName,
  initialBio = '',
  initialProfileUrl = '',
  initialXHandle = '',
  initialAvatarUrl = '',
  email,
  kind = 'person',
  showHeader = true,
  collapsible = false,
  detectedAgents,
  initialShownAgents,
}: {
  author: string
  initialName: string
  initialBio?: string | null
  initialProfileUrl?: string | null
  initialXHandle?: string | null
  initialAvatarUrl?: string | null
  email?: string | null
  image?: string | null
  /** 'person' edits your own profile; 'team' edits a team's (org) profile. */
  kind?: 'person' | 'team'
  /** Agents detected across this user's devices — drives the verified mark. */
  detectedAgents?: string[]
  /** Curated public agent selection; `null` = uncurated (pre-fill to detected). */
  initialShownAgents?: string[] | null
  /** Draw the "Profile" section header + view-profile action. Off when the page
   *  supplies its own PageHeader (e.g. /settings), so the header isn't doubled. */
  showHeader?: boolean
  /** Collapse to a read-only identity card at rest; expand to edit. Used on
   *  /settings where the profile form shouldn't dominate the page. */
  collapsible?: boolean
}) {
  const router = useRouter()
  const { update: updateSession } = useSession()
  // Editing a team must never write to YOUR session (name/avatar power the nav
  // and feed rail — they're your identity, not the team's). A photo upload still
  // goes straight to R2; we just skip the session sync for teams.
  const isTeam = kind === 'team'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initialState: ProfileFormState = {
    name: initialName,
    bio: initialBio ?? '',
    profileUrl: initialProfileUrl ?? '',
    xHandle: initialXHandle ?? '',
    avatarUrl: initialAvatarUrl ?? '',
  }
  const [value, setValue] = useState<ProfileFormState>(initialState)
  const [saved, setSaved] = useState<ProfileFormState>(initialState)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [showPicker, setShowPicker] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [hue, setHue] = useState<number>(() => readAvatarHue(initialAvatarUrl) ?? avatarHue(author))
  // Collapsible mode only: false shows the read-only card, true shows the form.
  const [editing, setEditing] = useState(false)
  // Mirror of the agent picker's selection, for the read-only summary glyphs.
  // The picker itself owns persistence; this just follows it.
  const showAgents = kind === 'person' && detectedAgents !== undefined
  const [agentSelected, setAgentSelected] = useState<Set<string>>(
    () => new Set(initialShownAgents ?? detectedAgents ?? []),
  )
  const orderedAgents = showAgents
    ? [...new Set([...AGENT_ORDER, ...agentSelected])].filter((k) => agentSelected.has(k))
    : []

  const displayName = value.name.trim() || author
  const savedDisplayName = saved.name.trim() || author
  const dirty = !sameProfile(value, saved)

  function setField<Key extends keyof ProfileFormState>(key: Key, next: ProfileFormState[Key]) {
    setValue((current) => ({ ...current, [key]: next }))
    if (error) setError(null)
    if (status === 'saved') setStatus('idle')
  }

  function discard() {
    setValue(saved)
    setError(null)
    setStatus('idle')
    setShowPicker(false)
    setEditing(false)
  }

  // Uploading a photo is immediate: it goes straight to R2 and becomes the live
  // avatar (unlike the preset characters, which stage into the form and persist
  // on Save). We mirror the returned URL into both `value` and `saved` so it
  // doesn't read as an unsaved change, and push it into the session so every
  // session reader (nav, feed rail) updates without a reload.
  async function onAvatarFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file for your avatar.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const avatarUrl = await uploadAvatar(author, file)
      setValue((current) => ({ ...current, avatarUrl }))
      setSaved((current) => ({ ...current, avatarUrl }))
      window.dispatchEvent(
        new CustomEvent(SKILLET_EVENTS.profileUpdated, {
          detail: { handle: author, name: saved.name, avatarUrl },
        }),
      )
      // Await the session sync so next-auth re-encodes the JWT cookie with the new
      // picture BEFORE router.refresh() re-reads the session — an un-awaited update
      // races the refresh and leaves token.picture stale, so the nav reverts to the
      // old avatar on the next hard load. Best-effort: the registry already saved
      // and the profileUpdated event refreshed this tab, so a sync failure is fine.
      if (!isTeam) await updateSession({ image: avatarUrl }).catch(() => {})
      setShowPicker(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that image.')
    } finally {
      setUploading(false)
    }
  }

  async function persist(): Promise<boolean> {
    const invalid = validateProfileUpdate({
      name: value.name,
      bio: value.bio,
      profileUrl: value.profileUrl,
      avatarUrl: value.avatarUrl,
    })
    if (invalid) {
      setError(invalid)
      return false
    }
    setStatus('saving')
    setError(null)
    try {
      await updateProfile(author, value)
      const nextSaved = cleanState(value)
      setSaved(nextSaved)
      setValue(nextSaved)
      window.dispatchEvent(
        new CustomEvent(SKILLET_EVENTS.profileUpdated, {
          detail: { handle: author, name: nextSaved.name, avatarUrl: nextSaved.avatarUrl },
        }),
      )
      // Persist the new name/avatar into the session token so every session reader
      // (feed rail, top-right nav) stays correct after a reload, not just this tab.
      // Await it so the JWT cookie is re-encoded before router.refresh() re-reads the
      // session; an un-awaited update races the refresh and leaves token.picture stale.
      // Best-effort — the registry save already succeeded, so a sync failure is fine.
      // Teams aren't your identity, so their edits never touch your session.
      if (!isTeam) {
        await updateSession({ name: nextSaved.name, image: nextSaved.avatarUrl || null }).catch(
          () => {},
        )
      }
      setStatus('saved')
      setShowPicker(false)
      setEditing(false)
      router.refresh()
      return true
    } catch (err) {
      setStatus('idle')
      setError(err instanceof Error ? err.message : 'Could not save profile.')
      return false
    }
  }

  const body = (
    <>
      <Panel padding="md">
        {/* Identity: click the avatar to change it. Name/bio/link edit as fields below. */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowPicker((v) => !v)}
            aria-label={isTeam ? 'Change logo' : 'Change avatar'}
            className="group relative shrink-0 rounded-full outline-none ring-offset-2 ring-offset-(--surface) focus-visible:ring-2 focus-visible:ring-(--ink)"
          >
            <Avatar
              src={value.avatarUrl.trim() || null}
              name={displayName}
              colorKey={author}
              kind={kind}
              size="lg"
            />
            <span
              aria-hidden
              className="absolute -right-0.5 -bottom-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-(--line) bg-(--surface) text-(--ink-2) shadow-sm transition-colors group-hover:border-(--ink-2) group-hover:text-(--ink)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </span>
          </button>

          <div className="min-w-0">
            <p className="truncate font-mono text-sm text-(--accent)">@{author}</p>
            {email && <p className="mt-0.5 truncate text-sm text-(--ink-2)">{email}</p>}
          </div>
        </div>

        {showPicker && (
          <div className="mt-4 rounded-xl border border-(--line) bg-(--bg) p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              {/* Teams use a monogram logo, not an illustrated face — so the shade
                  picker (which tints the preset characters) doesn't apply. */}
              <div className={cn('flex items-center gap-2', isTeam && 'hidden')}>
                <span className="text-xs font-medium text-(--ink-2)">Shade</span>
                <div className="flex flex-wrap gap-1.5">
                  {AVATAR_TINT_HUES.map((h) => {
                    const active = ((hue % 360) + 360) % 360 === h
                    return (
                      <button
                        key={h}
                        type="button"
                        aria-label={`Shade ${h}`}
                        aria-pressed={active}
                        onClick={(e) => {
                          const { clientX, clientY } = e
                          circularReveal(() => {
                            flushSync(() => {
                              setHue(h)
                              if (isDefaultAvatar(value.avatarUrl)) {
                                setField('avatarUrl', withAvatarHue(value.avatarUrl, h))
                              }
                            })
                          }, clientX, clientY, 800)
                        }}
                        style={{ background: avatarTintGradientForHue(h) }}
                        className={cn(
                          'h-6 w-6 rounded-full border border-(--line) outline-none ring-offset-2 ring-offset-(--bg) focus-visible:ring-2 focus-visible:ring-(--ink)',
                          active && 'ring-2 ring-(--ink)',
                        )}
                      />
                    )
                  })}
                </div>
              </div>
              <Button type="button" variant="tertiary" onClick={() => setShowPicker(false)}>
                Done
              </Button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="Upload avatar image"
              className="sr-only"
              onChange={(e) => {
                void onAvatarFile(e.target.files?.[0])
                e.currentTarget.value = ''
              }}
            />
            <div className="grid max-h-72 grid-cols-7 place-items-center gap-2 overflow-y-auto p-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                aria-label="Upload image"
                aria-busy={uploading}
                className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-full border border-dashed border-(--line) text-(--ink-2) outline-none ring-offset-2 ring-offset-(--bg) transition-colors hover:border-(--ink-2) hover:text-(--ink) focus-visible:ring-2 focus-visible:ring-(--ink) disabled:opacity-60"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn('h-5 w-5', uploading && 'animate-spin')}
                >
                  {uploading ? (
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  ) : (
                    <>
                      <path d="M12 16V4" />
                      <path d="m7 9 5-5 5 5" />
                      <path d="M5 20h14" />
                    </>
                  )}
                </svg>
                <span className="text-xs font-medium leading-none">
                  {uploading ? 'Uploading…' : 'Upload'}
                </span>
              </button>
              {/* Preset illustrated characters are for people; a team uploads its
                  own logo (or keeps the initials monogram). */}
              {!isTeam && defaultAvatarUrls().map((url) => {
                const tinted = withAvatarHue(url, hue)
                const selected = value.avatarUrl.split('?')[0] === url
                return (
                  <button
                    key={url}
                    type="button"
                    aria-label="Use this character"
                    aria-pressed={selected}
                    onClick={() => setField('avatarUrl', tinted)}
                    className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-(--ink) focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)"
                  >
                    <Avatar
                      src={tinted}
                      name={displayName}
                      colorKey={author}
                      size="lg"
                      className={cn('h-14 w-14 sm:h-14 sm:w-14', selected && 'ring-[3px] ring-(--accent)')}
                    />
                  </button>
                )
              })}
            </div>
            {error && (
              <p role="alert" className="mt-2 px-1 text-sm leading-relaxed text-(--danger)">
                {error}
              </p>
            )}
          </div>
        )}

        <div className="mt-5 space-y-4 border-t border-(--line) pt-5">
          <div>
            <FieldLabel className="mb-1.5 block">Display name</FieldLabel>
            <Input
              aria-label="Display name"
              maxLength={MAX_DISPLAY_NAME}
              value={value.name}
              onChange={(e) => setField('name', e.target.value)}
              disabled={status === 'saving'}
              aria-invalid={error ? true : undefined}
              placeholder={isTeam ? 'Team name' : 'Your name'}
            />
          </div>

          <div>
            <FieldLabel className="mb-1.5 block">Bio</FieldLabel>
            <Textarea
              aria-label="Bio"
              maxLength={MAX_PROFILE_BIO}
              value={value.bio}
              onChange={(e) => setField('bio', e.target.value)}
              disabled={status === 'saving'}
              placeholder={isTeam ? 'What does this team build?' : 'What should people know about you?'}
              className="min-h-[72px] resize-y leading-relaxed"
            />
            {value.bio.length > 0 && (
              <p className="mt-1 text-right font-mono text-xs text-(--ink-2)/70">
                {value.bio.length}/{MAX_PROFILE_BIO}
              </p>
            )}
          </div>

          <div>
            <FieldLabel className="mb-1.5 block">Link</FieldLabel>
            <Input
              aria-label="Link"
              maxLength={MAX_PROFILE_URL}
              value={value.profileUrl}
              onChange={(e) => setField('profileUrl', e.target.value)}
              disabled={status === 'saving'}
              placeholder="https://your-site.com"
            />
          </div>

          <div>
            <FieldLabel className="mb-1.5 block">X (Twitter)</FieldLabel>
            <Input
              aria-label="X (Twitter) username"
              maxLength={15}
              value={value.xHandle}
              onChange={(e) => setField('xHandle', e.target.value)}
              disabled={status === 'saving'}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              placeholder="username"
            />
          </div>

          {showAgents && (
            <div>
              <FieldLabel className="mb-1.5 block">Agents</FieldLabel>
              <p className="mb-3 text-sm text-(--ink-2)">
                Pick which agents show on your public profile. Ones detected on a connected
                device are marked verified.
              </p>
              <AgentsVisibilitySelect
                handle={author}
                detectedAgents={detectedAgents ?? []}
                initialShown={initialShownAgents ?? null}
                onSelectedChange={setAgentSelected}
              />
            </div>
          )}
        </div>
      </Panel>

      {dirty ? (
        <div className="sticky bottom-4 z-10 mt-4 flex items-center justify-between gap-3 rounded-xl border border-(--line) bg-(--surface) px-4 py-3 shadow-(--shadow-md)">
          <span className="text-sm text-(--ink-2)">Unsaved changes</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={discard} disabled={status === 'saving'}>
              Discard
            </Button>
            <Button type="button" variant="primary" onClick={() => void persist()} disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : (
        status === 'saved' && (
          <p className="mt-2 px-1 text-sm text-(--success)" role="status">
            Saved
          </p>
        )
      )}
      {error && !showPicker && (
        <p role="alert" className="mt-2 px-1 text-sm leading-relaxed text-(--danger)">
          {error}
        </p>
      )}
    </>
  )

  // Read-only identity row for collapsible mode — no card chrome; it reads as the
  // page's identity line. Click Edit to reveal the form.
  const summary = (
    <Panel padding="md">
      <div className="flex items-start gap-4">
        <Avatar
          src={saved.avatarUrl.trim() || null}
          name={savedDisplayName}
          colorKey={author}
          kind={kind}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold leading-tight text-(--ink)">
            {savedDisplayName}
          </p>
          <p className="mt-1 truncate font-mono text-sm text-(--accent)">@{author}</p>
          {email && <p className="mt-0.5 truncate text-sm text-(--ink-2)">{email}</p>}
          {saved.bio.trim() && (
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-(--ink-2)">
              {saved.bio.trim()}
            </p>
          )}
          {showAgents &&
            (orderedAgents.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                {orderedAgents.map((key) => (
                  <span
                    key={key}
                    title={runtimeLabel(key)}
                    aria-label={runtimeLabel(key)}
                    className="flex h-5 w-5 items-center justify-center text-(--ink-2)"
                  >
                    <AgentGlyph runtime={key} className="h-[18px] w-[18px]" />
                  </span>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-3 text-sm text-(--ink-3) transition-colors hover:text-(--ink)"
              >
                + Add the agents you use
              </button>
            ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {kind === 'person' && (
            <Button href={`/${author}`} variant="secondary">
              View profile
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </div>
    </Panel>
  )

  const content =
    collapsible && !editing ? (
      summary
    ) : collapsible ? (
      <>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-base font-semibold text-(--ink)">Edit profile</p>
          <Button type="button" variant="tertiary" size="sm" onClick={discard}>
            Cancel
          </Button>
        </div>
        {body}
      </>
    ) : (
      body
    )

  if (!showHeader) return content

  return (
    <SettingsSection
      title="Profile"
      description={
        isTeam
          ? 'The team’s name, logo, bio, and link, shown on its public page.'
          : 'Your name, photo, bio, and link, shown on your public profile.'
      }
      action={
        <Button href={`/${author}`} variant="secondary">
          {isTeam ? 'View team page' : 'View profile'}
        </Button>
      }
    >
      {content}
    </SettingsSection>
  )
}
