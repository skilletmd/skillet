import Link from 'next/link'
import { C, TourHero, TourLimits, TourList, TourNext, TourNote, TourSection, TourSteps, TourTable } from './tour-ui'

// Stop 3: routing. Docs register. Command in the first two sentences, then the
// pick, then the two things people actually ask about: what happens when
// nothing fits, and what gets recorded.
export function RoutingStop() {
  return (
    <>
      <TourHero
        title="Routing"
        cta={{ label: 'Install Skillet', href: '/install', note: 'Free. Mac, Windows, or the CLI.' }}
      >
        <C>/skillet &lt;task&gt;</C> reads your kit, picks the one skill that fits the task, and
        loads it. You describe the work instead of naming the skill, and only the picked skill
        enters the context.
      </TourHero>

      <TourSection title="How the pick works">
        <TourSteps
          items={[
            {
              title: 'You type the task',
              body: '/skillet review this diff before merge, in the agent you already use. No flags and no skill name.',
            },
            {
              title: 'Skillet reads your kit manifest',
              body: 'Every skill you own, each with the one line that says when to use it. That line is what the task is matched against.',
            },
            {
              title: 'One skill loads and runs',
              body: 'Skillet states which skill it picked and why, then that skill drives the task. Nothing else is loaded.',
            },
          ]}
        />
        <p>
          The pick loads one skill, not the catalog, so a kit that grows does not make every task
          more expensive.
        </p>
      </TourSection>

      <TourSection title="Routing against someone else’s kit">
        <p>
          Put a handle first: <C>/skillet @handle write my changelog</C>. Skillet fetches that
          person&rsquo;s public kit from the registry and routes against it. Nothing is installed,
          nothing syncs, and no account is required.
        </p>
        <p>
          The leading <C>@</C> is optional. <C>/skillet mattpocock review my PR</C> resolves the same
          way.{' '}
          <Link href="/docs/summon" className="text-(--ink) underline underline-offset-2">
            Summon a kit
          </Link>
        </p>
      </TourSection>

      <TourSection title="When nothing fits">
        <p>
          A pick is a judgment, not a lookup, so Skillet declines rather than forcing a weak match.
          What happens next depends on where the gap is.
        </p>
        <TourTable
          head={['Case', 'What Skillet does']}
          rows={[
            ['Nothing in your kit fits', 'Asks once before searching the library, showing the keywords it would send'],
            ['You pick a search result', 'Installs that skill and runs it, in one step'],
            ['The named handle has nothing that fits', 'Searches every author, then names who wrote the best match and asks first'],
            ['Nothing fits anywhere', 'Says so and does the task directly'],
          ]}
        />
        <TourNote label="Good to know">
          Skillet never installs on its own. Choosing a result is the consent, and showing a
          suggestion is not.
        </TourNote>
      </TourSection>

      <TourSection title="What routing records">
        <TourTable
          head={['Recorded', 'Never recorded']}
          rows={[
            ['The skill that ran', 'Your prompt'],
            ['The runtime it fired on', 'Your task text'],
            ['A timestamp and a few fixed tags', 'The agent’s reasoning'],
          ]}
        />
        <TourList
          items={[
            {
              term: 'Why it stays small',
              body: 'Every recorded value is a short slug, so no free text can be attached to a route',
            },
            {
              term: 'The one exception',
              body: 'When no skill fits and you agree to a library search, the short keywords shown in the ask are sent. The task text is not',
            },
            {
              term: 'Your copy',
              body: (
                <>
                  <C>skillet usage</C> reads the local dashboard. <C>skillet activity export</C> and{' '}
                  <C>skillet activity clear</C> show or delete everything recorded about you
                </>
              ),
            },
          ]}
        />
        <p>
          You choose at install whether usage is uploaded or stays on the machine.{' '}
          <Link href="/docs/privacy" className="text-(--ink) underline underline-offset-2">
            What /skillet records
          </Link>
        </p>
      </TourSection>

      <TourLimits>
        <p>
          <strong>Routing picks from your kit.</strong> An empty kit has nothing to route to, so the
          first run offers a search instead of returning a match.
        </p>
        <p>
          <strong>Descriptions drive the match.</strong> A skill with a vague description is hard to
          route to. The line that says when to use it matters more than the instructions underneath
          it.
        </p>
        <p>
          <strong>The library search needs a network path.</strong> With no registry reach, routing
          falls back to the local kit and says so.
        </p>
      </TourLimits>

      <TourNext
        from="routing"
        cta={{ label: 'Install Skillet', href: '/install', note: 'Free. Mac, Windows, or the CLI.' }}
        links={[
          { href: '/docs/summon', label: 'Summon a kit', note: 'routing against a handle you name' },
          { href: '/docs/privacy', label: 'Privacy', note: 'every value a route records' },
          { href: '/docs/skill-md', label: 'skill.md reference', note: 'writing a description that routes well' },
        ]}
      />
    </>
  )
}
