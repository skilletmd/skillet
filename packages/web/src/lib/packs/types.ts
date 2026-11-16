// Packs: a premade set of job slots, each holding one skill. The preview's data
// lives in ./data.ts.

/** What a skill wrote for the sample brief, shaped like the thing it is. */
export type Sample =
  | { kind: 'post'; text: string }
  | { kind: 'email'; subject: string; body: string }
  | { kind: 'hero'; headline: string; sub: string; button: string }
  | { kind: 'ad'; headline: string; body: string }

export interface PackSkill {
  /** The skill's folder name in its repo. */
  slug: string
  name: string
  maker: string
  makerHandle: string
  avatarUrl: string | null
  /** Where the skill's source lives. */
  sourceUrl: string
  /** One line on what it does, in plain words. */
  description: string
}

export interface PackSlot {
  job: string
  skill: PackSkill
  sample: Sample
}

export interface Pack {
  id: string
  /** Catalogue number, permanent: 01, 02. */
  number: string
  name: string
  /** The pack's foil and the ink printed on it. */
  color: string
  ink: string
  /** The jobs printed on the pack's front. */
  jobs: string[]
  /** Filled slots. Empty while the pack isn't out yet. */
  slots: PackSlot[]
}
