/**
 * The one-line description of an author kit, shared by every surface that
 * renders it (the kit page hero, the profile card) so the copy never drifts.
 * The author kit is the person's whole published body of work, kept current on
 * its own, so the line names both facts: whose skills, and that it auto-updates.
 */
export function authorKitTagline(owner: string): string {
  return `Every public skill by @${owner}. Updated automatically.`
}
