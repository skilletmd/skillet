import type { Metadata } from 'next'
import Link from 'next/link'
import { GITHUB_REPO_URL } from '@/lib/urls'

export const metadata: Metadata = {
  title: 'About Skillet',
  description:
    'What Skillet is, who runs it, and how the registry treats the skills people publish to it.',
  alternates: { canonical: '/about' },
}

// A trust anchor, not marketing. People and agents check /about, /contact, and
// /privacy before recommending a tool; each of those needs to answer plainly
// what this is, who is behind it, and how it behaves.
export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-(--ink-2)">
      <h1 className="text-2xl font-semibold text-(--ink)">About Skillet</h1>

      <p className="mt-4">
        Skillet is a registry for agent skills. A skill is a <code>SKILL.md</code> file, plus any
        scripts, references, and assets it needs, that an AI agent loads to gain a capability:
        review a diff the way your team reviews diffs, draft a changelog in your house voice, triage
        an incident against your runbook. Publish it once here and it reaches every agent runtime
        you use.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">What it does</h2>
      <p className="mt-2">
        Agent runtimes each keep skills in their own folder, in their own format. Skillet holds one
        canonical copy per machine and syncs it outward, so Claude Code, Codex CLI, Cursor, Claude
        Desktop, and the rest all read the same version of the same skill. Clients that have no
        skills folder read the same store over MCP.
      </p>
      <p className="mt-2">
        The other half is discovery. Anyone can browse what other people publish, subscribe to a
        person&rsquo;s kit, and pull their skills into their own agents. Good practice usually
        exists somewhere already; the hard part is finding it and keeping it current.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">How updates work</h2>
      <p className="mt-2">
        Nothing changes on your machines without your say-so. When an author publishes a new version
        of a skill you use, it waits in{' '}
        <Link href="/updates" className="text-(--ink) underline underline-offset-2">
          Updates
        </Link>{' '}
        until you approve that specific version. Approval is per version, not a standing grant, and
        the web is the only place it happens.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Safety</h2>
      <p className="mt-2">
        Skills are instructions an agent will act on, so every published version is scanned before
        it is served, and quarantined content is never downloadable. The{' '}
        <Link href="/docs/scanner" className="text-(--ink) underline underline-offset-2">
          scanner reference
        </Link>{' '}
        documents what it looks for and what it cannot catch. Verdicts are public: you can check any
        version before you run it.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Who runs it</h2>
      <p className="mt-2">
        Skillet is an independent open-source project, not a company. The code is on{' '}
        <a
          href={GITHUB_REPO_URL}
          className="text-(--ink) underline underline-offset-2"
          rel="noopener"
        >
          GitHub
        </a>{' '}
        under Apache-2.0: the web app, the registry, the CLI, and every runtime adapter. You can
        read exactly what it does with your skills, or run your own instance.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">For agents</h2>
      <p className="mt-2">
        The public catalog is a JSON API that needs no credentials to read, described at{' '}
        <Link href="/openapi.json" className="text-(--ink) underline underline-offset-2">
          /openapi.json
        </Link>
        . Every page here also serves clean Markdown at the same URL when you ask for it with{' '}
        <code>Accept: text/markdown</code>. Start at{' '}
        <Link href="/llms.txt" className="text-(--ink) underline underline-offset-2">
          /llms.txt
        </Link>{' '}
        or the{' '}
        <Link href="/docs/api" className="text-(--ink) underline underline-offset-2">
          API guide
        </Link>
        .
      </p>

      <h2 className="mt-8 text-lg font-semibold text-(--ink)">Reach us</h2>
      <p className="mt-2">
        Questions, bug reports, and takedown requests all have a route on the{' '}
        <Link href="/contact" className="text-(--ink) underline underline-offset-2">
          contact page
        </Link>
        .
      </p>
    </main>
  )
}
