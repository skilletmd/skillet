'use client'

import { useState } from 'react'
import { Button, type ButtonVariant } from '@/components/ui/button'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Panel } from '@/components/ui/panel'
import { Input, Select, Textarea, FieldLabel } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { CountBadge } from '@/components/ui/count-badge'
import { Shimmer } from '@/components/ui/shimmer'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Notice } from '@/components/ui/notice'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { PillToggle } from '@/components/ui/pill-toggle'
import { TabBar, Tab } from '@/components/ui/tabs'
import { SectionNav } from '@/components/ui/section-nav'
import { SettingsNav } from '@/components/settings/settings-nav'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSection } from '@/components/ui/setting-section'
import { Tooltip } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'
import { DialogFooter } from '@/components/ui/dialog-footer'
import { StatTile } from '@/components/stats/stat-tile'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/toast'
import { SkillCard } from '@/components/skill-card'
import { PersonCard } from '@/components/person-card'
import * as Icons from '@/components/ui/icons'

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-(--ink-2)">{children}</p>
}

/** A labelled gallery cell — itself a Panel, so the page renders on the system. */
function Cell({
  label,
  wide = false,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <Panel padding="sm" className={wide ? 'md:col-span-2' : ''}>
      <Label>{label}</Label>
      <div className="mt-3 flex flex-wrap items-center gap-3">{children}</div>
    </Panel>
  )
}

const GROUPS = [
  { id: 'foundations', title: 'Foundations' },
  { id: 'buttons', title: 'Buttons & controls' },
  { id: 'forms', title: 'Forms' },
  { id: 'navigation', title: 'Navigation' },
  { id: 'data', title: 'Data display' },
  { id: 'feedback', title: 'Feedback' },
  { id: 'overlays', title: 'Overlays' },
  { id: 'cards', title: 'Cards' },
] as const

function Group({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-(--line) pt-8">
      <h2 className="mb-4 font-mono text-sm uppercase tracking-[0.06em] text-(--accent)">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  )
}

const SWATCHES = [
  { name: 'bg', className: 'bg-(--bg)' },
  { name: 'surface', className: 'bg-(--surface)' },
  { name: 'ink', className: 'bg-(--ink)' },
  { name: 'ink-2', className: 'bg-(--ink-2)' },
  { name: 'line', className: 'bg-(--line)' },
  { name: 'accent', className: 'bg-(--accent)' },
  { name: 'accent-bg', className: 'bg-(--accent-bg)' },
  { name: 'success', className: 'bg-(--success)' },
  { name: 'success-bg', className: 'bg-(--success-bg)' },
  { name: 'warning', className: 'bg-(--warning)' },
  { name: 'warning-bg', className: 'bg-(--warning-bg)' },
  { name: 'danger', className: 'bg-(--danger)' },
  { name: 'danger-bg', className: 'bg-(--danger-bg)' },
  { name: 'info', className: 'bg-(--info)' },
] as const

const BUTTON_VARIANTS: ButtonVariant[] = [
  'primary',
  'secondary',
  'ghost',
  'tertiary',
  'accent',
  'danger-secondary',
  'danger-tertiary',
  'danger-ghost',
  'row',
  'quiet',
]

const BADGE_VARIANTS: BadgeVariant[] = [
  'default',
  'accent',
  'success',
  'danger',
  'warning',
  'danger-soft',
  'accent-soft',
]

const ICON_NAMES = [
  'ArrowRight',
  'ArrowLeft',
  'ChevronRight',
  'ChevronDown',
  'Close',
  'Plus',
  'Check',
  'Sliders',
  'Sun',
  'Moon',
] as const

/**
 * Live gallery of the whole UI system — imported and rendered from the real
 * components, grouped by role (foundations, controls, forms, navigation, data,
 * feedback, overlays, cards) so the design page can't drift from what ships.
 */
export function DesignPrimitives() {
  const toast = useToast()
  const [seg, setSeg] = useState<'all' | 'mine' | 'team'>('all')
  const [pill, setPill] = useState<'grid' | 'list'>('grid')
  const [tab, setTab] = useState<'overview' | 'security'>('overview')
  const [autoUpdate, setAutoUpdate] = useState(true)

  return (
    <div>
      {/* Sticky section index — jump to any group. */}
      <nav className="sticky top-0 z-10 -mx-4 mb-2 flex flex-wrap gap-1.5 bg-(--bg)/85 px-4 py-3 backdrop-blur">
        {GROUPS.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="rounded-full border border-(--line) px-3 py-1 text-xs font-medium text-(--ink-2) transition-colors hover:border-(--ink-2) hover:text-(--ink)"
          >
            {g.title}
          </a>
        ))}
      </nav>

      <Group id="foundations" title="Foundations">
        <Cell label="Color tokens" wide>
          <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-7">
            {SWATCHES.map((s) => (
              <div key={s.name} className="flex flex-col gap-1.5">
                <div className={`h-12 w-full rounded-lg border border-(--line) ${s.className}`} />
                <span className="font-mono text-2xs text-(--ink-2)">{s.name}</span>
              </div>
            ))}
          </div>
        </Cell>

        <Cell label="Type scale" wide>
          <div className="w-full space-y-2">
            <p className="text-3xl font-bold tracking-tight text-(--ink)">Display / page title</p>
            <p className="text-lg text-(--ink-2)">Lede — the one-line intro under a title.</p>
            <p className="text-base text-(--ink)">Body — default paragraph copy.</p>
            <p className="text-sm text-(--ink-2)">Small — captions and meta.</p>
            <p className="font-mono text-sm text-(--ink)">Mono — code, counts, commands.</p>
          </div>
        </Cell>

        <Cell label="Panel — padding & elevated" wide>
          <Panel padding="sm" className="text-xs text-(--ink-2)">
            sm
          </Panel>
          <Panel className="text-xs text-(--ink-2)">md (default)</Panel>
          <Panel padding="lg" className="text-xs text-(--ink-2)">
            lg
          </Panel>
          <Panel elevated className="text-xs text-(--ink-2)">
            elevated
          </Panel>
        </Cell>
      </Group>

      <Group id="buttons" title="Buttons & controls">
        <Cell label="Button — variants" wide>
          {BUTTON_VARIANTS.map((v) => (
            <Button key={v} type="button" variant={v}>
              {v}
            </Button>
          ))}
          <Button type="button" variant="icon" aria-label="Add">
            <Icons.Plus />
          </Button>
        </Cell>

        <Cell label="Button — sizes & disabled">
          <Button type="button" size="sm">
            Small
          </Button>
          <Button type="button" size="md">
            Medium
          </Button>
          <Button type="button" size="lg">
            Large
          </Button>
          <Button type="button" disabled>
            Disabled
          </Button>
        </Cell>

        <Cell label="SegmentedControl">
          <SegmentedControl
            ariaLabel="Filter"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'all', label: 'All' },
              { value: 'mine', label: 'Created' },
              { value: 'team', label: 'Team' },
            ]}
          />
        </Cell>

        <Cell label="PillToggle">
          <PillToggle
            ariaLabel="Layout"
            value={pill}
            onChange={setPill}
            options={[
              { value: 'grid', label: 'Grid' },
              { value: 'list', label: 'List' },
            ]}
          />
        </Cell>

        <Cell label="ToggleSwitch">
          <ToggleSwitch checked={autoUpdate} onChange={setAutoUpdate} ariaLabel="Auto-update" />
          <span className="text-sm text-(--ink-2)">{autoUpdate ? 'On' : 'Off'}</span>
        </Cell>
      </Group>

      <Group id="forms" title="Forms">
        <Cell label="Inputs">
          <div className="w-full space-y-2">
            <FieldLabel>Field label</FieldLabel>
            <Input placeholder="Input" defaultValue="" />
            <Select defaultValue="a">
              <option value="a">Select option</option>
              <option value="b">Another</option>
            </Select>
            <Textarea placeholder="Textarea" rows={2} />
          </div>
        </Cell>

        <Cell label="SettingRow + SettingsSection" wide>
          <div className="w-full">
            <SettingsSection title="Account" description="How others see and reach you.">
              <SettingRow title="Display name" description="Shown on your profile and cards.">
                <Button type="button" variant="secondary" size="sm">
                  Edit
                </Button>
              </SettingRow>
              <SettingRow title="Auto-update skills" description="Pull new versions automatically.">
                <ToggleSwitch checked={autoUpdate} onChange={setAutoUpdate} ariaLabel="Auto-update" />
              </SettingRow>
            </SettingsSection>
          </div>
        </Cell>
      </Group>

      <Group id="navigation" title="Navigation">
        <Cell label="SectionNav — eyebrow + tabs (the /browse · /feed · /settings bar)" wide>
          <div className="w-full">
            <SectionNav
              eyebrow="Section"
              active="#overview"
              tabs={[
                { href: '#overview', label: 'Overview' },
                { href: '#activity', label: 'Activity' },
                { href: '#settings', label: 'Settings' },
              ]}
            />
          </div>
        </Cell>

        <Cell label="TabBar — underline tabs">
          <TabBar>
            <Tab active={tab === 'overview'} onClick={() => setTab('overview')}>
              Overview
            </Tab>
            <Tab active={tab === 'security'} onClick={() => setTab('security')}>
              Security
            </Tab>
          </TabBar>
        </Cell>

        <Cell label="Eyebrow">
          <Eyebrow>Used by</Eyebrow>
        </Cell>

        <Cell label="Settings rail (desktop sidebar)" wide>
          <div className="w-(--rail-nav) max-w-full">
            <SettingsNav />
          </div>
        </Cell>
      </Group>

      <Group id="data" title="Data display">
        <Cell label="Badge — variants">
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
        </Cell>

        <Cell label="Badge — chip appearance">
          <Badge variant="success" appearance="chip">
            <Icons.Check className="h-3 w-3" /> signed
          </Badge>
          <Badge variant="warning" appearance="chip">
            deprecated
          </Badge>
          <Badge variant="default" appearance="chip">
            pending
          </Badge>
        </Cell>

        <Cell label="Avatar — sizes">
          <Avatar name="Taylor" size="xs" />
          <Avatar name="Taylor" size="sm" />
          <Avatar name="Taylor" size="md" />
          <Avatar name="Grace" size="lg" />
        </Cell>

        <Cell label="Avatar — kind & tone">
          <Avatar name="Acme" kind="team" size="md" />
          <Avatar name="Quiet" tone="plain" size="md" />
          <Avatar name="Ada" size="md" />
        </Cell>

        <Cell label="CountBadge">
          <span className="relative inline-flex items-center gap-1">
            Inbox <CountBadge value={3} />
          </span>
          <span className="relative inline-flex items-center gap-1">
            Capped <CountBadge value={42} />
          </span>
          <span className="text-sm text-(--ink-2)">value=0 → nothing</span>
          <CountBadge value={0} />
        </Cell>

        <Cell label="StatTile — full">
          <div className="w-full">
            <StatTile
              label="Installs"
              value="12,480"
              hint="across every agent"
              delta={
                <Badge variant="success" appearance="chip">
                  +5%
                </Badge>
              }
            />
          </div>
        </Cell>

        <Cell label="StatTile — compact">
          <StatTile variant="compact" label="Followers" value="1.2K" href="#" />
          <StatTile variant="compact" label="Skills" value="38" />
        </Cell>

        <Cell label="Icons" wide>
          {ICON_NAMES.map((n) => {
            const Icon = Icons[n]
            return (
              <span key={n} className="flex flex-col items-center gap-1 text-(--ink-2)">
                <Icon className="h-5 w-5" />
                <span className="text-2xs">{n}</span>
              </span>
            )
          })}
        </Cell>
      </Group>

      <Group id="feedback" title="Feedback">
        <Cell label="Notice — tones" wide>
          <div className="w-full space-y-2">
            <Notice tone="info">Heads up — this skill is a mirror of an upstream repo.</Notice>
            <Notice tone="success">Published. Your skill is live.</Notice>
            <Notice tone="danger">This version failed verification.</Notice>
          </div>
        </Cell>

        <Cell label="EmptyState — quiet">
          <EmptyState
            action={
              <Button type="button" variant="tertiary">
                Browse skills
              </Button>
            }
          >
            No saved skills yet.
          </EmptyState>
        </Cell>

        <Cell label="EmptyState — card">
          <div className="w-full">
            <EmptyState variant="card">Nothing here yet.</EmptyState>
          </div>
        </Cell>

        <Cell label="Tooltip">
          <Tooltip content="Sync this skill everywhere">
            <Button type="button" variant="secondary">
              Hover me
            </Button>
          </Tooltip>
        </Cell>

        <Cell label="Toast">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              toast({ message: 'Unsubscribed', action: { label: 'Undo', onClick: () => {} } })
            }
          >
            Fire a toast
          </Button>
        </Cell>

        <Cell label="Shimmer">
          <div className="w-full space-y-2">
            <Shimmer className="h-3 w-1/3" />
            <Shimmer className="h-3 w-2/3" />
            <Shimmer className="h-3 w-1/2" />
          </div>
        </Cell>
      </Group>

      <Group id="overlays" title="Overlays">
        <Cell label="Popover">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="secondary">
                Open popover
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <p className="text-sm text-(--ink)">A floating panel for richer content than a menu.</p>
              <p className="mt-1 text-sm text-(--ink-2)">Forms, pickers, info cards.</p>
            </PopoverContent>
          </Popover>
        </Cell>

        <Cell label="DropdownMenu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="secondary">
                Open menu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Kit</DropdownMenuLabel>
              <DropdownMenuItem>Edit</DropdownMenuItem>
              <DropdownMenuItem>Share</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Cell>

        <Cell label="Dialog + DialogFooter" wide>
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" variant="secondary">
                Open dialog
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Make this public?</DialogTitle>
              <p className="mt-2 text-sm text-(--ink-2)">
                Anyone will be able to find and add this skill.
              </p>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="button" variant="primary">
                  Make public
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Cell>
      </Group>

      <Group id="cards" title="Cards">
        <Cell label="SkillCard — md (browse / feed)" wide>
          <div className="w-full max-w-[320px]">
            <SkillCard
              author="taylor"
              slug="ship-frontend"
              title="Ship Frontend"
              description="A kit for shipping polished React UI fast — components, tokens, and review checks."
              category="frontend"
              installCount={1280}
              addToKit={false}
            />
          </div>
        </Cell>

        <Cell label="SkillCard — sm (rail row)">
          <div className="w-full">
            <SkillCard
              size="sm"
              author="taylor"
              slug="secure-by-default"
              title="Secure by Default"
              category="security"
              installCount={340}
              addToKit={false}
            />
          </div>
        </Cell>

        <Cell label="PersonCard — md">
          <div className="w-full max-w-[320px]">
            <PersonCard
              handle="taylor"
              name="Ada Lovelace"
              avatarUrl={null}
              stats={['38 skills', '1.2K followers']}
            />
          </div>
        </Cell>
      </Group>
    </div>
  )
}
