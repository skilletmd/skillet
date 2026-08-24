import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import { SingleInstallPanel } from '@/components/single-install-panel'
import { runtimeLabel } from '@/lib/runtime-labels'

/**
 * What happens after Add kit, and only after.
 *
 * Install was rendered beside Add kit as though the two were alternatives. They
 * are not: adding saves the kit to the account and puts nothing on the machine,
 * so install is the second half of the same action. Side by side it made one
 * decision look like three, and it pitched a CLI at a visitor who had not yet
 * decided to add anything.
 *
 * Three states, and the third is the one that was missing entirely: a viewer
 * with a connected agent had already finished, and the page said nothing about
 * it while continuing to ask them to install.
 *
 * The runtime check is per-account, not per-machine, so the connected state
 * still keeps a path for someone adding from a laptop they have not paired.
 */
function runtimeList(keys: readonly string[]): string {
  const names = keys.map(runtimeLabel)
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

export function KitDelivery({
  added,
  runtimes,
  command,
  accent,
}: {
  /** Whether the viewer has this kit. Nothing renders until they do. */
  added: boolean
  /** Runtime keys the viewer's account has connected. Empty means no client. */
  runtimes: readonly string[]
  command: string
  accent?: string
}) {
  if (!added) return null

  if (runtimes.length === 0) {
    return (
      <SingleInstallPanel
        command={command}
        accent={accent}
        lead="Added. Get it on your machine and this kit syncs into every AI tool you use."
      />
    )
  }

  return (
    <section>
      <Eyebrow>Synced</Eyebrow>
      <p className="mt-3 max-w-[64ch] text-sm leading-snug text-(--ink-2)">
        Added, and syncing to {runtimeList(runtimes)}.
      </p>
      <Link
        href="/install"
        className="mt-3 inline-flex items-center text-sm font-medium text-(--accent) hover:underline"
      >
        Not on this machine?
      </Link>
    </section>
  )
}
