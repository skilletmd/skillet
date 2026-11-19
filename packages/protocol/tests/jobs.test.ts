/**
 * The job list is shared by the CLI scan, the app and the web map, and its ids
 * are stored in saved maps, so these pin the list itself (order, count, ids)
 * as well as the classifier's contract: the known-slug table wins, terms decide
 * the rest, no hit means "Not sorted", and a tie always lands the same place.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JOBS, JOB_SECTIONS, TOOLS_SECTION, classifyJob, isJobId, jobById } from '../src/jobs.js';

// The map as the preview draws it on /packs/kit and /packs/home. Written out
// rather than read back from the module, so a reorder or rename is deliberate.
const PREVIEW: [string, string, string[]][] = [
  ['writing', 'Writing', ['Short posts', 'Long reads', 'Emails', 'Editing', 'Docs', 'Scripts']],
  ['marketing', 'Marketing', ['Landing pages', 'Ads', 'Newsletters', 'Launches', 'SEO', 'Social']],
  ['sales', 'Sales', ['Prospecting', 'Cold outreach', 'Follow-ups', 'Call notes', 'Proposals']],
  ['design', 'Design', ['Interfaces', 'Design reviews', 'Visual system', 'Images', 'Motion', 'Decks']],
  ['development', 'Development', ['Code review', 'Tests', 'Debugging', 'Pull requests', 'Specs', 'Security', 'Platforms']],
  ['research', 'Research', ['Web research', 'Data analysis', 'Summaries', 'Competitors', 'Reports']],
  ['business', 'Business', ['Strategy', 'Planning', 'Meetings', 'Hiring', 'Finance', 'Docs and PDFs', 'Spreadsheets']],
  ['media', 'Media', ['Video', 'Music and audio', 'Podcasts', 'Thumbnails']],
];

// Ids never change once shipped: saved maps and fixes refer to them. Renaming
// a job changes its name, never this list.
const SHIPPED_IDS = [
  'writing.short-posts', 'writing.long-reads', 'writing.emails', 'writing.editing', 'writing.docs', 'writing.scripts',
  'marketing.landing-pages', 'marketing.ads', 'marketing.newsletters', 'marketing.launches', 'marketing.seo', 'marketing.social',
  'sales.prospecting', 'sales.cold-outreach', 'sales.follow-ups', 'sales.call-notes', 'sales.proposals',
  'design.interfaces', 'design.design-reviews', 'design.visual-system', 'design.images', 'design.motion', 'design.decks',
  'development.code-review', 'development.tests', 'development.debugging', 'development.pull-requests', 'development.specs',
  'development.security', 'development.platforms',
  'research.web-research', 'research.data-analysis', 'research.summaries', 'research.competitors', 'research.reports',
  'business.strategy', 'business.planning', 'business.meetings', 'business.hiring', 'business.finance',
  'business.docs-and-pdfs', 'business.spreadsheets',
  'media.video', 'media.music-and-audio', 'media.podcasts', 'media.thumbnails',
];

describe('the job list', () => {
  it('counts 46 jobs in 8 sections, each listed in the preview order', () => {
    assert.equal(JOBS.length, 46);
    assert.deepEqual(
      JOB_SECTIONS.map((sec) => [sec.id, sec.name, sec.jobs.map((job) => job.name)]),
      PREVIEW,
    );
    assert.deepEqual(JOBS, JOB_SECTIONS.flatMap((sec) => sec.jobs));
  });

  it('gives every job a unique id that pairs its section and job', () => {
    const ids = [...JOBS, ...TOOLS_SECTION.jobs].map((job) => job.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const sec of [...JOB_SECTIONS, TOOLS_SECTION]) {
      for (const job of sec.jobs) {
        assert.equal(job.section, sec.id);
        assert.match(job.id, /^[a-z]+\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
        assert.ok(job.id.startsWith(`${sec.id}.`), `${job.id} sits in ${sec.id}`);
        assert.notEqual(job.id, job.name, 'an id is never a display string');
      }
    }
  });

  it('keeps the shipped ids', () => {
    assert.deepEqual(
      JOBS.map((job) => job.id),
      SHIPPED_IDS,
    );
    assert.deepEqual(
      TOOLS_SECTION.jobs.map((job) => job.id),
      ['tools.browser', 'tools.computer'],
    );
  });

  it('marks Platforms as the one many-slot job among the 46', () => {
    assert.deepEqual(
      JOBS.filter((job) => job.many).map((job) => job.id),
      ['development.platforms'],
    );
  });

  it('keeps Tools apart: its own section, every slot many, none of them counted', () => {
    assert.equal(TOOLS_SECTION.id, 'tools');
    assert.equal(TOOLS_SECTION.name, 'Tools');
    assert.deepEqual(
      TOOLS_SECTION.jobs.map((job) => job.name),
      ['Browser', 'Computer'],
    );
    assert.ok(TOOLS_SECTION.jobs.every((job) => job.many));
    assert.ok(JOBS.every((job) => job.section !== 'tools'));
    assert.ok(!JOB_SECTIONS.some((sec) => sec.id === 'tools'));
  });

  it('resolves every id, tools included, and nothing else', () => {
    for (const job of [...JOBS, ...TOOLS_SECTION.jobs]) {
      assert.equal(jobById(job.id), job);
      assert.ok(isJobId(job.id));
    }
    for (const notAnId of ['Editing', 'writing', 'writing.Editing', 'writing/editing', 'tools', '', 'toString']) {
      assert.equal(jobById(notAnId), undefined, notAnId);
      assert.equal(isJobId(notAnId), false, notAnId);
    }
  });
});

describe('classifyJob', () => {
  it('sorts a known slug through the table, whatever its text says', () => {
    assert.equal(classifyJob({ slug: 'ce-noslop' }), 'writing.editing');
    // The table answers before any term is read: this text alone would say
    // Podcasts.
    assert.equal(
      classifyJob({
        slug: 'ce-noslop',
        name: 'Podcast Edit',
        description: 'Edit podcast audio and write show notes.',
        body: 'podcast podcast podcast',
      }),
      'writing.editing',
    );
  });

  it('reads a known slug under a plugin or author prefix, in any case', () => {
    assert.equal(classifyJob({ slug: 'compound-engineering:ce-noslop' }), 'writing.editing');
    assert.equal(classifyJob({ slug: '@every/ce-noslop' }), 'writing.editing');
    assert.equal(classifyJob({ slug: 'CE-Noslop' }), 'writing.editing');
  });

  it('sorts landing page copy into Landing pages by its terms', () => {
    assert.equal(
      classifyJob({
        slug: 'hero-words',
        name: 'Hero Words',
        description: 'Writes landing page copy that turns visitors into signups.',
      }),
      'marketing.landing-pages',
    );
  });

  it('returns null when no term matches, so the map shows it under Not sorted', () => {
    assert.equal(
      classifyJob({
        slug: 'widget-sorter',
        name: 'Widget Sorter',
        description: 'Sorts widgets by size and weight.',
        body: 'Put the widgets in a row. Measure each one.',
      }),
      null,
    );
    assert.equal(classifyJob({ slug: '' }), null);
  });

  it('breaks a tie by job order, the same way every run', () => {
    // 'tweet' (Short posts) and 'newsletter' (Newsletters) are both specific
    // single words, so each alone wins its own job and together they tie.
    assert.equal(classifyJob({ slug: 'x', description: 'tweet' }), 'writing.short-posts');
    assert.equal(classifyJob({ slug: 'x', description: 'newsletter' }), 'marketing.newsletters');
    const runs = new Set<string | null>();
    for (let n = 0; n < 5; n++) {
      runs.add(classifyJob({ slug: 'x', description: 'tweet newsletter' }));
      runs.add(classifyJob({ slug: 'x', description: 'newsletter tweet' }));
    }
    // Short posts comes first on the map, whichever word comes first in the text.
    assert.deepEqual([...runs], ['writing.short-posts']);
    // One more Newsletters term breaks the tie the other way.
    assert.equal(classifyJob({ slug: 'x', description: 'tweet newsletter on substack' }), 'marketing.newsletters');
  });

  it('lets a weak word break a tie but never win on its own', () => {
    // 'review', 'plan' and 'writing' turn up in all kinds of skills, so a skill
    // that says nothing else stays Not sorted rather than landing somewhere wrong.
    assert.equal(classifyJob({ slug: 'x', description: 'Review and plan the writing.' }), null);
    // 'subscriber' is weak, but next to 'newsletter' it tips the tie with 'tweet'.
    assert.equal(classifyJob({ slug: 'x', description: 'tweet newsletter subscriber' }), 'marketing.newsletters');
  });

  it('weighs the slug, name and description over the body', () => {
    // Description: one specific word for Podcasts (2, counted x3 = 6). Body: two
    // specific words for Spreadsheets (4, counted x1 = 4).
    assert.equal(
      classifyJob({ slug: 'x', description: 'For a podcast.', body: 'spreadsheet workbook' }),
      'media.podcasts',
    );
    // With nothing up top, the body decides.
    assert.equal(classifyJob({ slug: 'x', body: 'spreadsheet workbook' }), 'business.spreadsheets');
  });

  it('reads only the first 1500 characters of the body', () => {
    const filler = 'a '.repeat(750); // 1500 characters
    assert.equal(classifyJob({ slug: 'x', body: `${filler}spreadsheet` }), null);
    assert.equal(classifyJob({ slug: 'x', body: `spreadsheet ${filler}` }), 'business.spreadsheets');
  });

  it('matches whole words, so a term inside another word is not a hit', () => {
    // 'ad' (Ads) must not fire on "add", "read" or "loaded".
    assert.equal(classifyJob({ slug: 'x', description: 'Add, read and load files that were loaded.' }), null);
  });
});
