import type { InstallPlatform } from '@/lib/install-platform'

export type InstallStep = {
  n: string
  title: string
  body: string
}

export type TrustPill = {
  label: string
  detail: string
}

type InstallCopy = {
  trustPills: TrustPill[]
  steps: InstallStep[]
  demoBlurb: string
}

const MAC_COPY: InstallCopy = {
  trustPills: [
    {
      label: 'Signed & notarized',
      detail: 'Apple Developer ID. Opens without a Gatekeeper warning.',
    },
    {
      label: 'Passwordless sign-in',
      detail: 'An email link on skillet.md signs you in. No password to manage.',
    },
    {
      label: 'Auto-updates',
      detail: 'Fetches the latest silently via appcast.',
    },
  ],
  steps: [
    {
      n: '01',
      title: 'Download',
      body: 'Click download, then drag Skillet into your Applications.',
    },
    {
      n: '02',
      title: 'Open it once',
      body: 'It sits in your menu bar and connects to the AI tools you already use.',
    },
    {
      n: '03',
      title: 'Add skills you like',
      body: 'Add any skill on Skillet and it syncs into all your tools. No copy-paste.',
    },
  ],
  demoBlurb: 'It runs quietly in your menu bar: what’s syncing, updates to approve, and publish when you’re ready.',
}

const WINDOWS_COPY: InstallCopy = {
  trustPills: [
    {
      label: 'Tray app + bundled CLI',
      detail: 'Sync and publish without opening a terminal.',
    },
    {
      label: 'Passwordless sign-in',
      detail: 'An email link on skillet.md signs you in. No password to manage.',
    },
    {
      label: 'Pair with the web',
      detail: 'Paste a code from skillet.md → Settings → Devices to link your account.',
    },
  ],
  steps: [
    {
      n: '01',
      title: 'Download',
      body: 'Run the installer. Windows may ask you to confirm. That’s expected.',
    },
    {
      n: '02',
      title: 'Open it once',
      body: 'It sits in your system tray and connects to the AI tools you already use.',
    },
    {
      n: '03',
      title: 'Add skills you like',
      body: 'Add any skill on Skillet and it syncs into all your tools. No copy-paste.',
    },
  ],
  demoBlurb: 'It runs quietly in your tray: what’s syncing, updates to approve, and publish when you’re ready.',
}

const CLI_COPY: InstallCopy = {
  trustPills: [
    {
      label: 'Passwordless sign-in',
      detail: 'Sign in on skillet.md, then link this machine with one pair code.',
    },
    {
      label: 'Every major runtime',
      detail: 'Cursor, Claude Code, Codex, Devin Desktop, OpenClaw, Hermes, and more.',
    },
    {
      label: 'Safe to re-run',
      detail: 'Sync is atomic. Partial failures recover on the next run.',
    },
  ],
  steps: [
    {
      n: '01',
      title: 'Run the wizard',
      body: 'Paste the command in PowerShell, Windows Terminal, or your shell. Node 22+ required.',
    },
    {
      n: '02',
      title: 'Import & link',
      body: 'Skillet finds skills you already use, then optionally links your account with a pair code.',
    },
    {
      n: '03',
      title: 'Sync',
      body: '`skillet sync` writes your kit into every agent runtime we detect on this machine.',
    },
  ],
  demoBlurb:
    'Prefer the menu bar / tray app? Download the native Mac or Windows build, or stay on the CLI on Linux.',
}

export function installCopyFor(platform: InstallPlatform): InstallCopy {
  if (platform === 'mac') return MAC_COPY
  if (platform === 'windows') return WINDOWS_COPY
  if (platform === 'mobile') return CLI_COPY
  return CLI_COPY
}

export const PLATFORM_LABELS: Record<InstallPlatform, string> = {
  mac: 'macOS',
  windows: 'Windows',
  // The `linux` platform is the CLI path. It's labeled "CLI" because the command
  // isn't Linux-specific — people paste `npx skillet` into a shell or an agent
  // (Claude Code, Codex, Cursor) on any OS. Linux users auto-detect here.
  linux: 'CLI',
  mobile: 'Mobile',
}
