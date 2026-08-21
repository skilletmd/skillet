'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  SKILLET_APPCAST_URL,
  SKILLET_APP_SIZE_LABEL,
  SKILLET_DMG_URL,
  SKILLET_INSTALL_URL,
  SKILLET_MIN_OS_LABEL,
  SKILLET_WINDOWS_APP_SIZE_LABEL,
  SKILLET_WINDOWS_INSTALLER_URL,
  SKILLET_WINDOWS_MIN_OS_LABEL,
  NPX_SKILLET_COMMAND,
} from '@/config'
import { CommandBlock } from '@/components/command-block'
import { SyncDiagram } from '@/components/sync-diagram'
import { AppleLogo, WindowsLogo, TerminalLogo } from '@/components/os-logos'
import { Button, buttonClasses } from '@/components/ui/button'
import { PillToggle } from '@/components/ui/pill-toggle'
import { ArrowRight } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { detectInstallPlatform, type InstallPlatform } from '@/lib/install-platform'
import { installCopyFor, PLATFORM_LABELS } from './install-content'
import { InstallQR } from './install-qr'

function useInstallPlatform(initial: InstallPlatform): InstallPlatform {
  const [platform, setPlatform] = useState<InstallPlatform>(initial)

  useEffect(() => {
    setPlatform(detectInstallPlatform(navigator.userAgent || '', navigator.platform || ''))
  }, [])

  return platform
}

type InstallHeroProps = {
  platform: InstallPlatform
  onPlatformChange: (platform: InstallPlatform) => void
}

export function InstallHero({ platform, onPlatformChange }: InstallHeroProps) {
  return (
    <div className="flex max-w-[640px] flex-col items-start">
      <PlatformPicker active={platform} onChange={onPlatformChange} />
      {platform === 'mac' ? (
        <MacHero />
      ) : platform === 'windows' ? (
        <WindowsHero />
      ) : platform === 'mobile' ? (
        <MobileHero />
      ) : (
        <CliHero />
      )}
    </div>
  )
}

function PlatformPicker({
  active,
  onChange,
}: {
  active: InstallPlatform
  onChange: (p: InstallPlatform) => void
}) {
  const options: InstallPlatform[] = ['mac', 'windows', 'linux']
  return (
    <PillToggle
      semantics="tab"
      ariaLabel="Choose your platform"
      className="mb-6"
      options={options.map((p) => ({
        value: p,
        label: PLATFORM_LABELS[p],
        icon: <OsLogo platform={p} className="h-3.5 w-3.5" />,
      }))}
      value={active}
      onChange={onChange}
    />
  )
}

function OsLogo({ platform, className }: { platform: InstallPlatform; className?: string }) {
  if (platform === 'mac') return <AppleLogo className={className} />
  if (platform === 'windows') return <WindowsLogo className={className} />
  return <TerminalLogo className={className} />
}

function MacHero() {
  return (
    <>
      <p className="manual-eyebrow">macOS app</p>
      <h1 className="hero-title mt-4 max-w-[14ch] text-4xl leading-none sm:text-5xl lg:text-6xl">
        Skillet on your Mac.
      </h1>
      <p className="mt-5 max-w-[42ch] text-lg leading-[1.45] text-(--ink-2) sm:text-xl">
        The skills you add on Skillet sync straight into every AI tool you use: Claude, Cursor,
        ChatGPT, and more. No terminal, no copy-paste.
      </p>
      <a
        href={SKILLET_DMG_URL}
        download
        aria-label="Download Skillet for Mac"
        className={cn(
          buttonClasses('primary', { size: 'lg' }),
          'mt-8 w-full max-w-[400px]',
        )}
      >
        <AppleLogo className="h-5 w-5" />
        Download for Mac
      </a>
      <p className="mt-3 text-sm text-(--ink-2)">
        {SKILLET_MIN_OS_LABEL} · {SKILLET_APP_SIZE_LABEL}
      </p>
      {SKILLET_APPCAST_URL ? (
        <p className="mt-1 text-sm text-(--ink-2)">Already have it? It updates itself.</p>
      ) : null}
    </>
  )
}

function WindowsHero() {
  return (
    <>
      <p className="manual-eyebrow">Windows app</p>
      <h1 className="hero-title mt-4 max-w-[16ch] text-4xl leading-none sm:text-5xl lg:text-6xl">
        Skillet on Windows.
      </h1>
      <p className="mt-5 max-w-[42ch] text-lg leading-[1.45] text-(--ink-2) sm:text-xl">
        The skills you add on Skillet sync straight into every AI tool you use: Claude, Cursor,
        ChatGPT, and more. No terminal, no copy-paste.
      </p>
      <a
        href={SKILLET_WINDOWS_INSTALLER_URL}
        download
        aria-label="Download Skillet for Windows"
        className={cn(
          buttonClasses('primary', { size: 'lg' }),
          'mt-8 w-full max-w-[400px]',
        )}
      >
        <WindowsLogo className="h-[18px] w-[18px]" />
        Download for Windows
      </a>
      <p className="mt-3 text-sm text-(--ink-2)">
        {SKILLET_WINDOWS_MIN_OS_LABEL} · {SKILLET_WINDOWS_APP_SIZE_LABEL}
      </p>
      <p className="mt-4 text-sm text-(--ink-2)">
        Prefer the CLI? Run{' '}
        <code className="rounded bg-(--surface) px-1.5 py-0.5 text-(--ink)">
          {NPX_SKILLET_COMMAND}
        </code>{' '}
        in PowerShell or Windows Terminal.
      </p>
    </>
  )
}

function CliHero() {
  return (
    <>
      <p className="manual-eyebrow">Command line</p>
      <h1 className="hero-title mt-4 max-w-[16ch] text-4xl leading-none sm:text-5xl lg:text-6xl">
        Skillet from the terminal.
      </h1>
      <p className="mt-5 max-w-[48ch] text-lg leading-[1.45] text-(--ink-2) sm:text-xl">
        One command runs the onboarding wizard. Paste it into your shell or an agent like Claude
        Code or Codex. It imports the skills you already use, links your account, and syncs to every
        runtime we find. Works on macOS, Windows, and Linux.
      </p>
      <div className="mt-8 w-full max-w-[480px]">
        <CommandBlock command={NPX_SKILLET_COMMAND} accent={NPX_SKILLET_COMMAND} size="lg" />
      </div>
      <p className="mt-3 text-sm text-(--ink-2)">
        Requires{' '}
        <a
          href="https://nodejs.org/en/download"
          className="underline decoration-(--line) underline-offset-2 hover:text-(--ink)"
        >
          Node.js 22+
        </a>
        . Prefer a global install?{' '}
        <Link
          href="/docs/install"
          className="underline decoration-(--line) underline-offset-2 hover:text-(--ink)"
        >
          See the docs
        </Link>
        .
      </p>
    </>
  )
}

function MobileHero() {
  const [shared, setShared] = useState(false)
  const [canShare, setCanShare] = useState(false)

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && !!navigator.share)
  }, [])

  async function handleShare() {
    try {
      await navigator.share({
        title: 'Install Skillet',
        url: SKILLET_INSTALL_URL,
      })
      setShared(true)
    } catch {
      // User dismissed the share sheet.
    }
  }

  const mailtoHref = `mailto:?subject=${encodeURIComponent(
    'Install Skillet',
  )}&body=${encodeURIComponent(SKILLET_INSTALL_URL)}`

  return (
    <>
      <p className="manual-eyebrow">Install on your computer</p>
      <h1 className="hero-title mt-4 max-w-[14ch] text-4xl leading-none sm:text-5xl lg:text-6xl">
        Open this on your Mac or PC.
      </h1>
      <p className="mt-5 max-w-[44ch] text-lg leading-[1.45] text-(--ink-2) sm:text-xl">
        Mac and Windows get the menu bar / tray app. Linux uses the CLI wizard: same page, right
        install steps for your OS.
      </p>
      {canShare ? (
        <Button
          variant="primary"
          size="lg"
          block
          type="button"
          onClick={handleShare}
          className="mt-8 max-w-[400px]"
        >
          {shared ? 'Link shared ✓' : 'Share install link'}
        </Button>
      ) : (
        <a
          href={mailtoHref}
          className={cn(buttonClasses('primary', { size: 'lg' }), 'mt-8 w-full max-w-[400px]')}
        >
          Send to my computer <ArrowRight />
        </a>
      )}
      <div className="mt-10 flex flex-col items-center gap-3 self-stretch sm:items-start">
        <InstallQR />
        <p className="text-sm text-(--ink-2)">Scan from your Mac or PC browser</p>
      </div>
    </>
  )
}

type InstallPageBodyProps = {
  initialPlatform: InstallPlatform
  showDemo: boolean
  demoPosterUrl?: string
  demoVideoUrl?: string
}

export function InstallPageBody({
  initialPlatform,
  showDemo,
  demoPosterUrl,
  demoVideoUrl,
}: InstallPageBodyProps) {
  const detected = useInstallPlatform(initialPlatform)
  const [override, setOverride] = useState<InstallPlatform | null>(null)
  const platform = override ?? detected
  const copy = installCopyFor(platform)

  return (
    <main className="marketing-home consumer-theme">
      <section className="relative overflow-hidden border-b border-(--line)">
        <div className="hero-glow absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-x-12 gap-y-10 px-[clamp(18px,4vw,40px)] pb-12 pt-[clamp(40px,6vw,64px)] lg:grid-cols-[1fr_minmax(0,460px)]">
          <InstallHero platform={platform} onPlatformChange={(p) => setOverride(p)} />
          <div className="hidden lg:block" aria-hidden="true">
            <SyncDiagram />
          </div>
        </div>
      </section>

      {showDemo && demoVideoUrl ? (
        <section className="mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] pb-16">
          <div className="manual-panel mx-auto max-w-[720px] overflow-hidden p-0">
            <video
              autoPlay
              loop
              muted
              playsInline
              poster={demoPosterUrl || undefined}
              className="w-full"
            >
              <source src={demoVideoUrl} type="video/mp4" />
            </video>
          </div>
          <h2 className="hero-title mt-8 text-center text-2xl sm:text-3xl">
            You saw it, now run it.
          </h2>
          <p className="mx-auto mt-3 max-w-[52ch] text-center text-base leading-[1.55] text-(--ink-2)">
            {copy.demoBlurb}
          </p>
        </section>
      ) : null}

      <section className="mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] pb-20">
        <h2 className="mb-8 text-xl font-semibold tracking-tight text-(--ink)">Set up in a minute</h2>
        <ol className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-3">
          {copy.steps.map((step, i) => (
            <li key={step.n} className="flex flex-col">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--accent) text-sm font-bold text-(--surface)">
                  {i + 1}
                </span>
                {i < copy.steps.length - 1 ? (
                  <span className="hidden h-px flex-1 bg-(--line) sm:block" />
                ) : null}
              </div>
              <h3 className="mt-4 text-base font-semibold text-(--ink)">{step.title}</h3>
              <p className="mt-1 max-w-[34ch] text-sm leading-[1.55] text-(--ink-2)">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
