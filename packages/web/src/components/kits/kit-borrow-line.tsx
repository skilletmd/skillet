import { CommandBlock } from '@/components/command-block'

/**
 * The borrow action on a kit page: run this kit right now, nothing installed.
 *
 * Every action on this page used to be adopt-stage. Add kit, Get the Skillet
 * app, and the npx line are three faces of one decision, and Following is a
 * state rather than an action, so a visitor who was not ready to commit had
 * nothing to do here at all.
 *
 * `/{owner}/kit/{slug}/summon` returns this kit's members as routing candidates,
 * so an agent that can fetch a URL runs the right one with nothing on disk. The
 * kit is the better borrow unit than the whole handle when someone is already
 * looking at a named, curated set.
 *
 * The `@` form is what the line shows: it reads as a person, it is the form the
 * route skill teaches, and the alias redirect sends it to the canonical path.
 */
export function KitBorrowLine({ owner, slug }: { owner: string; slug: string }) {
  const handle = `@${owner}`
  return (
    <section className="mt-8">
      <p className="text-sm font-medium text-(--ink)">Try it now, nothing installed</p>
      <CommandBlock
        command={`Read skillet.md/${handle}/kit/${slug}/summon and use the right skill from it for my task`}
        accent={handle}
        prompt={null}
        size="sm"
        wrap
        bare
        className="mt-2"
      />
    </section>
  )
}
