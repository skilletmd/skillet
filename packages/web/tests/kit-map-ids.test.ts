import { describe, expect, it } from 'vitest'
import { JOBS, JOB_SECTIONS, TOOLS_SECTION, classifyJob, isJobId } from '@skillet/protocol/jobs'
import { HOME_PICKS } from '@/lib/packs/home-picks'
import { PICKS, TAKE_MARKETING, TAYLOR_KIT, TAYLOR_TOOLS, sortSkillLink } from '@/lib/packs/kit-map'

// The web draws the map; protocol owns the jobs. Everything the packs preview
// keys by job has to be a protocol job id, or a scan (which sorts by those ids)
// and the map it opens would disagree about where a skill sits.

const SLOT_IDS = [...JOBS, ...TOOLS_SECTION.jobs].map((job) => job.id)

describe('kit map job ids', () => {
  it('keys every HOME_PICKS entry by a protocol job id', () => {
    const keys = Object.keys(HOME_PICKS)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(isJobId(key), key).toBe(true)
  })

  it('gives every job and tool an entry, empty where Skillet has no pick yet', () => {
    expect(Object.keys(HOME_PICKS)).toEqual(SLOT_IDS)
  })

  it('sorts every pick back into the job it fills, so a filled job stays filled on the next scan', () => {
    for (const [id, skills] of Object.entries(HOME_PICKS)) {
      for (const sk of skills) {
        expect(classifyJob({ slug: sk.slug, name: sk.name, description: sk.about }), `@${sk.handle}/${sk.slug}`).toBe(id)
      }
    }
  })

  it('draws the sections and jobs in protocol order, under protocol names', () => {
    expect(TAYLOR_KIT.map((sec) => [sec.id, sec.name, sec.slots.map((sl) => [sl.id, sl.name, sl.many])])).toEqual(
      JOB_SECTIONS.map((sec) => [sec.id, sec.name, sec.jobs.map((job) => [job.id, job.name, job.many])]),
    )
    expect(TAYLOR_TOOLS.slots.map((sl) => sl.id)).toEqual(TOOLS_SECTION.jobs.map((job) => job.id))
  })

  it('keys the preview picks, the Marketing take and the link sort by job id', () => {
    for (const key of [...Object.keys(PICKS), ...Object.keys(TAKE_MARKETING)]) expect(isJobId(key), key).toBe(true)
    for (const link of ['github.com/a/skills/cold-email', 'github.com/a/b/seo-audit', 'github.com/a/b/anything']) {
      expect(isJobId(sortSkillLink(link)), link).toBe(true)
    }
  })
})
