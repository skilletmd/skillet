import type { Metadata } from 'next'
import Link from 'next/link'
import { ObfuscatedEmail } from '@/components/obfuscated-email'
import { GITHUB_REPO_URL } from '@/lib/urls'

export const metadata: Metadata = {
  title: 'Contact Skillet',
  description:
    'How to reach Skillet: bug reports, security disclosures, moderation and takedown requests, conduct reports, and general questions.',
  alternates: { canonical: '/contact' },
}

// One page per channel, so nobody has to guess which one their problem belongs
// in — and so an agent asked "how do I contact them" has a single answer.
// Addresses render through ObfuscatedEmail: the literal string never appears in
// the server-rendered HTML.
export default function ContactPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-(--ink-2)">
      <h1 className="text-2xl font-semibold text-(--ink)">Contact</h1>
      <p className="mt-4">
        Skillet is an independent open-source project. There is no sales team and no ticket queue.
        Pick the channel that matches what you need and a maintainer reads it.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Bugs and feature requests</h2>
      <p className="mt-2">
        Open an issue on{' '}
        <a
          href={`${GITHUB_REPO_URL}/issues`}
          className="text-(--ink) underline underline-offset-2"
          rel="noopener"
        >
          GitHub
        </a>
        . Include what you ran, what you expected, and what happened. For sync problems, the output
        of <code>skillet doctor</code> tells us most of what we need.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Security vulnerabilities</h2>
      <p className="mt-2">
        Use GitHub&rsquo;s private vulnerability reporting: the repository&rsquo;s{' '}
        <a
          href={`${GITHUB_REPO_URL}/security`}
          className="text-(--ink) underline underline-offset-2"
          rel="noopener"
        >
          Security tab
        </a>{' '}
        &rarr; <strong className="font-semibold text-(--ink)">Report a vulnerability</strong>. That
        reaches the maintainers privately. We aim to acknowledge within 72 hours and will agree a
        disclosure timeline with you before anything is published. Please don&rsquo;t file a public
        issue for an exploitable finding.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">A skill that shouldn&rsquo;t be here</h2>
      <p className="mt-2">
        Every skill page has a <strong className="font-semibold text-(--ink)">Report</strong> action;
        it files straight into the moderation queue with the version you were looking at. Enforcement
        that we apply is public in the{' '}
        <Link href="/moderation" className="text-(--ink) underline underline-offset-2">
          moderation log
        </Link>
        .
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Copyright</h2>
      <p className="mt-2">
        Send takedown notices and counter-notices to the address on the{' '}
        <Link href="/legal/dmca" className="text-(--ink) underline underline-offset-2">
          DMCA page
        </Link>
        , which lists what a valid notice has to contain.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Conduct</h2>
      <p className="mt-2">
        Report abusive or harassing behavior to{' '}
        <ObfuscatedEmail
          user="skilletdotmd"
          domain="gmail.com"
          subject="Conduct report"
          className="text-(--ink) underline underline-offset-2"
        />
        . Reports go to the maintainers responsible for enforcing the{' '}
        <a
          href={`${GITHUB_REPO_URL}/blob/main/CODE_OF_CONDUCT.md`}
          className="text-(--ink) underline underline-offset-2"
          rel="noopener"
        >
          Code of Conduct
        </a>
        , and we keep the reporter&rsquo;s identity private.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Anything else</h2>
      <p className="mt-2">
        General questions, press, and partnership mail:{' '}
        <ObfuscatedEmail
          user="skilletdotmd"
          domain="gmail.com"
          subject="Skillet"
          className="text-(--ink) underline underline-offset-2"
        />
        . Check the{' '}
        <Link href="/docs/faq" className="text-(--ink) underline underline-offset-2">
          FAQ
        </Link>{' '}
        first, since most setup questions are answered there. The{' '}
        <Link href="/docs" className="text-(--ink) underline underline-offset-2">
          docs
        </Link>{' '}
        cover install, publishing, and every supported runtime.
      </p>
    </main>
  )
}
