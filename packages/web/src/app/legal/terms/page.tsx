import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'What you agree to when you use Skillet, and what publishing a skill grants others.',
}

// Public terms. The load-bearing section is "Publishing a skill" — the baseline
// grant that lets other users download, run, and locally adapt publicly
// published skills through Skillet without every author having to pick a
// license. An author's optional SPDX `license:` frontmatter field (see
// /docs/skill-md) governs reuse BEYOND the platform; Skillet never assigns a
// license on the author's behalf.
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-(--ink-2)">
      <h1 className="text-2xl font-semibold text-(--ink)">Terms of Use</h1>
      <p className="mt-2 text-sm text-(--ink-3)">
        Draft — not legal advice. Skillet is an independent project, not a company.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Your content</h2>
      <p className="mt-2">
        You own the skills you publish. Publishing on Skillet never transfers ownership, and we
        never apply a license to your work on your behalf.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Publishing a skill</h2>
      <p className="mt-2">
        Publishing a skill <strong className="font-semibold text-(--ink)">publicly</strong> grants
        Skillet the right to host and distribute it, and grants other users the right to download
        it, run it in their agents, and adapt their own copies — all through Skillet. That&rsquo;s
        the baseline that makes a public registry work; unpublishing stops new distribution but
        doesn&rsquo;t recall copies people already synced.
      </p>
      <p className="mt-2">
        Private skills are hosted for you and your devices only. They grant nothing to anyone else.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Licenses</h2>
      <p className="mt-2">
        Want to allow more than the baseline — reuse outside Skillet, republishing, commercial use?
        Declare a license in your skill&rsquo;s frontmatter (
        <Link href="/docs/skill-md" className="text-(--ink) underline underline-offset-2">
          <code>license: MIT</code>
        </Link>
        , or any SPDX identifier). It shows on your skill page. No license field means all rights
        reserved beyond the baseline grant above.
      </p>
      <p className="mt-2">
        Skills mirrored from GitHub keep their source repository&rsquo;s license, carried with the
        copy exactly as the source states it.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Acceptable use</h2>
      <p className="mt-2">
        Don&rsquo;t publish skills designed to harm the people who run them — malware, credential
        theft, prompt-injection attacks, or deliberately deceptive behavior. We scan published
        skills and quarantine or remove ones that cross that line.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Takedowns</h2>
      <p className="mt-2">
        Copyright complaints follow our{' '}
        <Link href="/legal/dmca" className="text-(--ink) underline underline-offset-2">
          DMCA policy
        </Link>
        .
      </p>
    </main>
  )
}
