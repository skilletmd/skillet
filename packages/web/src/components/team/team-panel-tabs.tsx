'use client'

import { useState, type ReactNode } from 'react'
import { TabBar, Tab } from '@/components/ui/tabs'

/**
 * Splits a team's long management panel into two tabs — Members (default) and
 * Profile. Both server-rendered sections stay mounted and are toggled with
 * `hidden`, so switching tabs is instant and never drops unsaved profile edits.
 * Only admins see this (they're the only ones with a Profile tab); members get
 * the plain members view from the server with no tab bar.
 */
export function TeamPanelTabs({ members, profile }: { members: ReactNode; profile: ReactNode }) {
  const [tab, setTab] = useState<'members' | 'profile'>('members')
  return (
    <div>
      <TabBar aria-label="Team settings">
        <Tab active={tab === 'members'} onClick={() => setTab('members')}>
          Members
        </Tab>
        <Tab active={tab === 'profile'} onClick={() => setTab('profile')}>
          Profile
        </Tab>
      </TabBar>
      <div className="mt-6">
        <div className={tab === 'members' ? undefined : 'hidden'}>{members}</div>
        <div className={tab === 'profile' ? undefined : 'hidden'}>{profile}</div>
      </div>
    </div>
  )
}
