import Link from 'next/link'
import { C, TourHero, TourLimits, TourList, TourNext, TourNote, TourSection, TourSteps, TourTable } from './tour-ui'

// Stop 2: skill management. Docs register. The order is where the file lives,
// how it reaches each runtime, how a change lands, and what happens to a copy
// you edited by hand, which is the case people get bitten by.
export function SkillsStop() {
  return (
    <>
      <TourHero
        title="One copy, every agent"
        cta={{ label: 'Install Skillet', href: '/install', note: 'Free. Mac, Windows, or the CLI.' }}
      >
        Skillet keeps one copy of each skill in <C>~/.skillet</C> and writes it into every runtime
        you connect, each in the format that runtime expects. Edit the copy once and every runtime
        has it on the next sync.
      </TourHero>

      <TourSection title="Where skills live">
        <p>
          <C>~/.skillet</C> holds the clean copy. It is the only one you edit. Everything under a
          runtime&rsquo;s own skills folder is written from it and can be regenerated.
        </p>
        <TourTable
          head={['Runtime', 'How it gets the skill']}
          rows={[
            ['Claude Code, Cursor, Codex', 'Written to that runtime’s skills folder on sync'],
            ['Windsurf, Devin, Hermes, OpenClaw, OpenCode', 'Same, in each one’s own format'],
            ['ChatGPT, Claude.ai', 'No skills folder, so they read the same store over MCP'],
          ]}
        />
        <p>
          Adding a runtime does not mean porting what you own. The canonical copy has not changed,
          so the new adapter writes the same skills into one more place.{' '}
          <Link href="/docs/runtimes" className="text-(--ink) underline underline-offset-2">
            Every supported runtime
          </Link>
        </p>
      </TourSection>

      <TourSection title="How updates land">
        <p>
          Nothing on your machine changes until you approve it. Editing your own skill is the
          exception: your own republish flows to your machines without asking, because approval
          exists to gate other people&rsquo;s changes.
        </p>
        <TourSteps
          items={[
            { title: 'The author publishes a new version', body: 'The old version stays on your machine.' },
            {
              title: 'The update queues at /updates',
              body: 'Each row shows the skill, the version it moves to, and a diff of what changed.',
            },
            {
              title: 'You take it or leave it',
              body: 'Update applies it, Skip declines it, Update all clears the batch. Approve some and leave the rest pending.',
            },
          ]}
        />
        <TourList
          items={[
            {
              term: 'Auto-apply',
              body: (
                <>
                  Off by default. Turn on <strong>Auto-update subscribed skills</strong> under
                  Settings &gt; Account and signed, scanned updates apply on next sync instead of
                  queueing
                </>
              ),
            },
            {
              term: 'Where approval happens',
              body: (
                <>
                  The web, at{' '}
                  <Link href="/updates" className="text-(--ink) underline underline-offset-2">
                    /updates
                  </Link>
                  , or the same queue in the app. The website cannot write to disk, so the app or the
                  CLI does the sync
                </>
              ),
            },
          ]}
        />
      </TourSection>

      <TourSection title="Skills you have edited">
        <p>
          Hand-edit a synced skill and sync keeps your edit. That skill gets its own section on the
          updates page and is held out of <strong>Update all</strong>, so it moves only when you
          decide.
        </p>
        <TourTable
          head={['Choice', 'What happens']}
          rows={[
            ['Upgrade', 'Their version applies, your edit is backed up first and stays recoverable'],
            ['Leave it', 'Your edit stays exactly as it is and their future versions keep queueing'],
          ]}
        />
        <TourNote label="Good to know">
          Your edited content never leaves the machine. Skillet records only that a skill was edited
          on a device: which skill, which device, and which version you edited from.
        </TourNote>
      </TourSection>

      <TourSection title="Recovery">
        <TourList
          items={[
            {
              term: 'Atomic',
              body: 'An update applies completely or not at all. A half-written skills folder is not a state you can land in',
            },
            {
              term: 'Backed up',
              body: 'Your previous version is saved before anything is written, so a bad update is recoverable',
            },
            {
              term: 'Immutable',
              body: 'A published version never changes after the fact, so the version you approved is the version you keep',
            },
            {
              term: 'Never deleted',
              body: 'Skillet does not remove your skills. If a sync fails you keep what you had',
            },
          ]}
        />
      </TourSection>

      <TourSection title="Kits">
        <p>
          A kit is a named set of skills. Two things describe any kit: who owns it, and who can see
          it.
        </p>
        <TourTable
          head={['Kit', 'Who sees it', 'Use it for']}
          rows={[
            ['Personal', 'Just you, unless you publish', 'Your own skills'],
            ['Team', 'Members, and every tool they connect', 'Runbooks that must not drift between people'],
          ]}
        />
        <p>
          A team kit puts every member and every CI runner on the same approved version. Incoming
          changes arrive as diffs the same way. A skill can sit in more than one kit without leaving
          yours.
        </p>
      </TourSection>

      <TourLimits>
        <p>
          <strong>The website cannot write to your disk.</strong> Approving an update in the browser
          records the decision. The app or the CLI applies it on the next sync.
        </p>
        <p>
          <strong>Cloud runtimes do not auto-sync.</strong> ChatGPT and Claude.ai have no local
          skills folder, so they read the store over MCP or take a downloadable bundle you upload.
        </p>
        <p>
          <strong>Updates are scanned, not certified.</strong> A scan flags what it can and links the
          report next to the diff. A person decides.
        </p>
      </TourLimits>

      <TourNext
        from="skills"
        cta={{ label: 'Install Skillet', href: '/install', note: 'Free. Mac, Windows, or the CLI.' }}
        links={[
          { href: '/docs/updates', label: 'Keeping skills updated', note: 'the full approval flow' },
          { href: '/docs/runtimes', label: 'Runtimes', note: 'every tool Skillet writes to' },
          { href: '/docs/teams', label: 'Teams and shared kits', note: 'setup and roles' },
        ]}
      />
    </>
  )
}
