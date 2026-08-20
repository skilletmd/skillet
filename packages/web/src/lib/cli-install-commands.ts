import { NPX_SKILLET_COMMAND } from '@/config'

/** Normalize a skill ref to `@owner/slug`. */
export function normalizeSkillRef(ref: string): string {
  const trimmed = ref.trim()
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

/** Copy-paste one-liner for registry skill install (skills.sh-style). */
export function skillInstallCommand(ref: string): string {
  const normalized = normalizeSkillRef(ref)
  return `${NPX_SKILLET_COMMAND} add ${normalized} -y`
}

/** Copy-paste one-liner for named kit subscribe + sync. */
export function kitInstallCommand(owner: string, slug: string): string {
  const handle = `@${owner}/${slug}`
  return `${NPX_SKILLET_COMMAND} add kit ${handle} -y`
}
