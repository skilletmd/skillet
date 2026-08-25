import Link from 'next/link'
import { FooterMascot } from '@/components/footer-mascot'
import { FooterTagline } from '@/components/footer-tagline'
import { GetAppOsIcon } from '@/components/get-app-os-icon'
import { GithubStarBadge } from '@/components/github-star-badge'

export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-(--line) bg-(--bg)">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-[clamp(16px,4vw,32px)] py-8 text-sm text-(--ink-2)">
        <span className="flex items-center gap-2">
          <FooterMascot />
          <FooterTagline />
        </span>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            href="/install"
            className="inline-flex items-center gap-1.5 font-medium text-(--ink)"
          >
            <GetAppOsIcon className="h-3.5 w-3.5 -translate-y-px" />
            Get app
          </Link>
          <Link href="/stats">Stats</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/docs">Docs</Link>
          <GithubStarBadge />
        </nav>
      </div>
    </footer>
  )
}
