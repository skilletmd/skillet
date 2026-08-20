'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { registryAuthApi } from '@/lib/registry-proxy'
import { authorKitHref, kitHref } from '@/lib/urls'
import type { AuthorKitPayload, KitPayload, KitSkillEntry, MineKitsPayload } from '@/lib/kits'
import { tryToSkillId, type SkillId } from '@skillet/protocol/skill-id'

export type MyKitsInitial = {
  viewerHandle: string
  kits: MineKitsPayload
}

export interface SkillKitMembership {
  kitId: string
  name: string
  owner: string
  role: 'owner' | 'member'
  canRemove: boolean
  /** `owned` = a kit you control (an editable destination); `followed` = a kit
   *  you subscribe to (a followed kit or author-kit) or a team kit you're in —
   *  you have the skill transitively, but it's read-only here. */
  kind: 'owned' | 'followed'
  /** Permalink to the kit (so a read-only membership can link to its source). */
  href: string
}

interface MyKitsContextValue {
  loading: boolean
  authed: boolean
  viewerHandle: string | null
  /** Editable destinations: your named kits plus every kit of a team you admin
   *  (that team's Saved + custom kits). Your personal Saved kit is excluded —
   *  see `savedKit`. Group by `owner` to render personal vs per-team sections. */
  ownedKits: KitPayload[]
  /** Your personal auto "Saved" kit (Liked Songs of skills); null until loaded. */
  savedKit: KitPayload | null
  /** Teams you administer, slug -> display name, for per-team section headers. */
  teams: Array<{ slug: string; name: string }>
  /** True if this skill is already in your Saved kit. */
  isSaved: (author: string, slug: string) => boolean
  membershipsFor: (author: string, slug: string) => SkillKitMembership[]
  /** True if the viewer subscribes to this kit (followed, not owned). */
  isSubscribedKit: (kitId: string) => boolean
  /** True if the viewer follows this author/team. */
  isSubscribedAuthor: (handle: string) => boolean
  refresh: () => Promise<void>
}

const MyKitsContext = createContext<MyKitsContextValue | null>(null)

// Both the index key (built from `entry.skill_id`) and the lookup key (built
// from an `{ author, slug }` pair) route through the same canonicalizer — so
// the index can never diverge from the lookup by identity form. If the API
// ever emits `@owner/slug` instead of `owner:slug` for skill_id, this still
// canonicalizes to the same key instead of silently missing. Uses the
// non-throwing `tryToSkillId` — a malformed key means "no membership", not a
// crash.
function skillKey(author: string, slug: string): SkillId | null {
  return tryToSkillId(`${author}/${slug}`)
}

function buildMembershipIndex(
  owned: KitPayload[],
  member: KitPayload[],
  subscribed: KitPayload[],
  authorKits: AuthorKitPayload[],
): Map<SkillId, SkillKitMembership[]> {
  const index = new Map<SkillId, SkillKitMembership[]>()

  const push = (
    kitId: string,
    name: string,
    owner: string,
    href: string,
    skills: KitSkillEntry[],
    role: 'owner' | 'member',
    kind: 'owned' | 'followed',
    canRemove: boolean,
  ) => {
    for (const entry of skills) {
      const key = tryToSkillId(entry.skill_id)
      if (key == null) continue
      const list = index.get(key) ?? []
      if (list.some((m) => m.kitId === kitId)) continue
      list.push({ kitId, name, owner, href, role, canRemove, kind })
      index.set(key, list)
    }
  }

  const kitOf = (kit: KitPayload, role: 'owner' | 'member', kind: 'owned' | 'followed', canRemove: boolean) =>
    push(kit.id, kit.name, kit.owner, kitHref(kit.owner, kit.slug), kit.skills, role, kind, canRemove)

  // Owned kits (incl. Saved) are editable destinations. Everything else — team
  // kits you're a member of, kits you follow, and author-kits ("every skill by
  // @x") — gives you the skill transitively but is read-only here.
  for (const kit of owned) kitOf(kit, 'owner', 'owned', true)
  for (const kit of member) kitOf(kit, 'member', 'followed', false)
  for (const kit of subscribed) kitOf(kit, 'member', 'followed', false)
  for (const ak of authorKits)
    push(ak.ref, ak.name, ak.owner, authorKitHref(ak.owner), ak.skills, 'member', 'followed', false)

  return index
}

function stateFromMinePayload(
  viewerHandle: string | null,
  data: MineKitsPayload,
): {
  authed: boolean
  viewerHandle: string | null
  owned: KitPayload[]
  saved: KitPayload | null
  member: KitPayload[]
  teams: Array<{ slug: string; name: string }>
  index: Map<SkillId, SkillKitMembership[]>
  subKitIds: Set<string>
  subAuthors: Set<string>
} {
  const allOwned = data.owned ?? []
  // Your personal Saved kit (owner === you). Team Saved kits stay in ownedKits so
  // they render inside their team's section, not as your library.
  const savedKit =
    allOwned.find(
      (k) => k.kind === 'saved' && (viewerHandle == null || k.owner === viewerHandle),
    ) ?? null
  const ownedKits = allOwned.filter((k) => k.id !== savedKit?.id)
  const memberKits = data.member ?? []

  return {
    authed: true,
    viewerHandle,
    owned: ownedKits,
    saved: savedKit,
    member: memberKits,
    teams: data.teams ?? [],
    index: buildMembershipIndex(allOwned, memberKits, data.subscribed ?? [], data.author_kits ?? []),
    subKitIds: new Set((data.subscribed ?? []).map((k) => k.id)),
    subAuthors: new Set((data.author_kits ?? []).map((a) => a.owner)),
  }
}

export function MyKitsProvider({
  children,
  initial,
}: {
  children: ReactNode
  initial?: MyKitsInitial | null
}) {
  const bootstrapped = initial != null
  const boot = bootstrapped ? stateFromMinePayload(initial.viewerHandle, initial.kits) : null

  const [loading, setLoading] = useState(!bootstrapped)
  const [authed, setAuthed] = useState(boot?.authed ?? false)
  const [viewerHandle, setViewerHandle] = useState<string | null>(boot?.viewerHandle ?? null)
  const [owned, setOwned] = useState<KitPayload[]>(boot?.owned ?? [])
  const [saved, setSaved] = useState<KitPayload | null>(boot?.saved ?? null)
  const [member, setMember] = useState<KitPayload[]>(boot?.member ?? [])
  const [teams, setTeams] = useState<Array<{ slug: string; name: string }>>(boot?.teams ?? [])
  const [index, setIndex] = useState<Map<SkillId, SkillKitMembership[]>>(
    boot?.index ?? new Map(),
  )
  // Followed kits + authors. The same /kits/mine call already carries these
  // (subscribed kits, author_kits) — tracking them here lets every subscribe
  // control across the app self-resolve "do I already follow this?" instead of
  // guessing from a server placeholder.
  const [subKitIds, setSubKitIds] = useState<Set<string>>(boot?.subKitIds ?? new Set())
  const [subAuthors, setSubAuthors] = useState<Set<string>>(boot?.subAuthors ?? new Set())

  // `silent` refetches in the background (after add/remove) without flipping the
  // global loading flag — otherwise every kit control on the page blinks to its
  // "…" state during the refresh.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [whoamiRes, mineRes] = await Promise.all([
        fetch(registryAuthApi('whoami'), { headers: { accept: 'application/json' } }),
        fetch(registryAuthApi('kits/mine'), { headers: { accept: 'application/json' } }),
      ])
      if (whoamiRes.status === 401 || mineRes.status === 401) {
        setAuthed(false)
        setViewerHandle(null)
        setOwned([])
        setSaved(null)
        setMember([])
        setTeams([])
        setIndex(new Map())
        setSubKitIds(new Set())
        setSubAuthors(new Set())
        return
      }
      if (!mineRes.ok) return
      const whoami = whoamiRes.ok ? ((await whoamiRes.json()) as { handle?: string | null }) : {}
      const data = (await mineRes.json()) as MineKitsPayload
      const next = stateFromMinePayload(whoami.handle ?? null, data)
      setAuthed(next.authed)
      setViewerHandle(next.viewerHandle)
      setOwned(next.owned)
      setSaved(next.saved)
      setMember(next.member)
      setTeams(next.teams)
      setIndex(next.index)
      setSubKitIds(next.subKitIds)
      setSubAuthors(next.subAuthors)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (bootstrapped) return
    void load()
  }, [bootstrapped, load])

  const refresh = useCallback(() => load(true), [load])

  const membershipsFor = useCallback(
    (author: string, slug: string) => {
      const key = skillKey(author, slug)
      return key == null ? [] : (index.get(key) ?? [])
    },
    [index],
  )

  const isSaved = useCallback(
    (author: string, slug: string) => {
      const key = skillKey(author, slug)
      if (key == null || saved == null) return false
      return (index.get(key) ?? []).some((m) => m.kitId === saved.id)
    },
    [index, saved],
  )

  const isSubscribedKit = useCallback((kitId: string) => subKitIds.has(kitId), [subKitIds])
  const isSubscribedAuthor = useCallback((handle: string) => subAuthors.has(handle), [subAuthors])

  const value = useMemo(
    () => ({
      loading,
      authed,
      viewerHandle,
      ownedKits: owned,
      savedKit: saved,
      teams,
      isSaved,
      membershipsFor,
      isSubscribedKit,
      isSubscribedAuthor,
      refresh,
    }),
    [
      loading,
      authed,
      viewerHandle,
      owned,
      saved,
      teams,
      isSaved,
      membershipsFor,
      isSubscribedKit,
      isSubscribedAuthor,
      refresh,
    ],
  )

  return <MyKitsContext.Provider value={value}>{children}</MyKitsContext.Provider>
}

export function useMyKits(): MyKitsContextValue {
  const ctx = useContext(MyKitsContext)
  if (!ctx) {
    throw new Error('useMyKits must be used within MyKitsProvider')
  }
  return ctx
}

export function useMyKitsOptional(): MyKitsContextValue | null {
  return useContext(MyKitsContext)
}
