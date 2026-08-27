import Link from 'next/link'
import { C, TourHero, TourLimits, TourList, TourNext, TourNote, TourSection, TourSteps, TourTable } from './tour-ui'

// Stop 1: discovery and trust. Docs register, so the page states the ranking
// mechanism and the checks available before a skill runs, and leaves the
// argument for them implicit.
export function DiscoveryStop() {
  return (
    <>
      <TourHero
        title="Finding skills worth running"
        cta={{ label: 'Browse skills', href: '/browse', note: 'Nothing installed to look.' }}
      >
        Skillet ranks skills by the people you follow, not by install count. Every published version
        is scanned before the registry serves it, and the verdict is public. You can run someone
        else&rsquo;s kit before adding anything.
      </TourHero>

      <TourSection title="Follow and Add">
        <p>
          Discovery runs on two verbs. Following watches a person. Adding runs their work. They are
          separate on purpose: you can follow someone for a year without a single file changing on
          your machine.
        </p>
        <TourTable
          head={['', 'Follow', 'Add']}
          rows={[
            ['What it does', 'Watch a person', 'Run a skill or kit'],
            ['Changes your agents', 'No', 'Yes, syncs it in'],
            ['Stays current', 'Not applicable', 'Yes, as they update it'],
          ]}
        />
        <p>
          Your feed ranks on the follow graph. A skill from someone you follow outranks a skill with
          a larger install count behind it, and a skill published this week is not buried by one
          published two years ago.
        </p>
      </TourSection>

      <TourSection title="What you can check before a skill runs">
        <TourList
          items={[
            {
              term: 'The source',
              body: (
                <>
                  A skill is a <C>SKILL.md</C> file. Open it on its page and read the whole thing.
                  There is no compiled artifact and nothing hidden behind an install
                </>
              ),
            },
            {
              term: 'The scan',
              body: (
                <>
                  Every version is scanned before the registry serves it. Quarantined content is
                  never downloadable, and the verdict is public. The{' '}
                  <Link href="/docs/scanner" className="text-(--ink) underline underline-offset-2">
                    scanner reference
                  </Link>{' '}
                  lists what it looks for and what it misses
                </>
              ),
            },
            {
              term: 'The version',
              body: 'Published versions are immutable. Version 2 is always the same version 2, so what you read is what you get',
            },
            {
              term: 'The author',
              body: 'Their profile shows what else they publish and who runs it. Install counts there are public adopters, not raw installs',
            },
          ]}
        />
      </TourSection>

      <TourSection title="Running a kit without installing it">
        <p>
          Type <C>/skillet @handle</C> and the task in any agent that has the route skill. Nothing
          is installed and no account is required.
        </p>
        <TourSteps
          items={[
            {
              title: 'Skillet fetches the handle’s public kit',
              body: 'Live from the registry, read-only. Their private skills are not in it.',
            },
            {
              title: 'It picks the skill that fits the task',
              body: 'Matched against each skill name and description, the same way local routing works.',
            },
            {
              title: 'The skill runs and the author is credited',
              body: 'One attribution line names the skill and links its page, so you can see who wrote it before you decide to keep it.',
            },
          ]}
        />
        <TourNote label="Good to know">
          Adding a skill is private. Nothing you run is announced, and private skills never enter
          the public follow graph.
        </TourNote>
      </TourSection>

      <TourLimits>
        <p>
          <strong>Scanned, not certified.</strong> A scan flags what it can and links the report next
          to the skill. A person decides. Skillet does not vouch for anyone&rsquo;s code, and a clean
          verdict is not an endorsement.
        </p>
        <p>
          <strong>Ranking is not review.</strong> The follow graph reflects who you chose to follow.
          It carries no judgment of its own, and a skill from someone you trust can still be wrong
          for your setup.
        </p>
        <p>
          <strong>Adopter counts are partial.</strong> A profile counts public adopters, kit saves
          and subscriptions, because installer identity is private. The real number is higher and
          Skillet does not publish it.
        </p>
      </TourLimits>

      <TourNext
        from="discovery"
        cta={{ label: 'Browse skills', href: '/browse', note: 'Nothing installed to look.' }}
        links={[
          { href: '/docs/summon', label: 'Summon a kit', note: 'the full syntax and what it fetches' },
          {
            href: '/docs/safety',
            label: 'Safety',
            note: 'what scanning covers and what it leaves to you',
          },
        ]}
      />
    </>
  )
}
