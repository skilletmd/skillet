/**
 * The kit map's jobs: the work a person hands their AI, as 8 sections holding
 * 46 jobs, plus Tools (the things the AI operates), which sit on the map in a
 * section of their own and are not counted among the 46.
 *
 * Node-free, and exported as `@skillet/protocol/jobs`, because three places
 * sort skills into these jobs: the CLI's scan, the desktop app and the
 * browser. None of them may send a skill anywhere to be sorted before Save, so
 * `classifyJob` is local and deterministic, like `guessCategory`.
 *
 * Ids pair the section and the job (`writing.editing`). They are never display
 * strings and never change once shipped: saved maps and their fixes refer to
 * them, so renaming a job changes its `name`, never its id. Names live here;
 * colours belong to whoever draws the map.
 */

interface JobDef {
  readonly id: string;
  readonly name: string;
  readonly many?: boolean;
}

interface SectionDef {
  readonly id: string;
  readonly name: string;
  readonly jobs: readonly JobDef[];
}

const SECTION_DEFS = [
  {
    id: 'writing',
    name: 'Writing',
    jobs: [
      { id: 'writing.short-posts', name: 'Short posts' },
      { id: 'writing.long-reads', name: 'Long reads' },
      { id: 'writing.emails', name: 'Emails' },
      { id: 'writing.editing', name: 'Editing' },
      { id: 'writing.docs', name: 'Docs' },
      { id: 'writing.scripts', name: 'Scripts' },
    ],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    jobs: [
      { id: 'marketing.landing-pages', name: 'Landing pages' },
      { id: 'marketing.ads', name: 'Ads' },
      { id: 'marketing.newsletters', name: 'Newsletters' },
      { id: 'marketing.launches', name: 'Launches' },
      { id: 'marketing.seo', name: 'SEO' },
      { id: 'marketing.social', name: 'Social' },
    ],
  },
  {
    id: 'sales',
    name: 'Sales',
    jobs: [
      { id: 'sales.prospecting', name: 'Prospecting' },
      { id: 'sales.cold-outreach', name: 'Cold outreach' },
      { id: 'sales.follow-ups', name: 'Follow-ups' },
      { id: 'sales.call-notes', name: 'Call notes' },
      { id: 'sales.proposals', name: 'Proposals' },
    ],
  },
  {
    id: 'design',
    name: 'Design',
    jobs: [
      { id: 'design.interfaces', name: 'Interfaces' },
      { id: 'design.design-reviews', name: 'Design reviews' },
      { id: 'design.visual-system', name: 'Visual system' },
      { id: 'design.images', name: 'Images' },
      { id: 'design.motion', name: 'Motion' },
      { id: 'design.decks', name: 'Decks' },
    ],
  },
  {
    id: 'development',
    name: 'Development',
    jobs: [
      { id: 'development.code-review', name: 'Code review' },
      { id: 'development.tests', name: 'Tests' },
      { id: 'development.debugging', name: 'Debugging' },
      { id: 'development.pull-requests', name: 'Pull requests' },
      { id: 'development.specs', name: 'Specs' },
      { id: 'development.security', name: 'Security' },
      // One entry per stack you build on, so it holds as many as you like.
      { id: 'development.platforms', name: 'Platforms', many: true },
    ],
  },
  {
    id: 'research',
    name: 'Research',
    jobs: [
      { id: 'research.web-research', name: 'Web research' },
      { id: 'research.data-analysis', name: 'Data analysis' },
      { id: 'research.summaries', name: 'Summaries' },
      { id: 'research.competitors', name: 'Competitors' },
      { id: 'research.reports', name: 'Reports' },
    ],
  },
  {
    id: 'business',
    name: 'Business',
    jobs: [
      { id: 'business.strategy', name: 'Strategy' },
      { id: 'business.planning', name: 'Planning' },
      { id: 'business.meetings', name: 'Meetings' },
      { id: 'business.hiring', name: 'Hiring' },
      { id: 'business.finance', name: 'Finance' },
      { id: 'business.docs-and-pdfs', name: 'Docs and PDFs' },
      { id: 'business.spreadsheets', name: 'Spreadsheets' },
    ],
  },
  {
    id: 'media',
    name: 'Media',
    jobs: [
      { id: 'media.video', name: 'Video' },
      { id: 'media.music-and-audio', name: 'Music and audio' },
      { id: 'media.podcasts', name: 'Podcasts' },
      { id: 'media.thumbnails', name: 'Thumbnails' },
    ],
  },
] as const satisfies readonly SectionDef[];

/** Not jobs: things the AI operates. Each holds as many as you like. */
const TOOLS_DEF = {
  id: 'tools',
  name: 'Tools',
  jobs: [
    { id: 'tools.browser', name: 'Browser', many: true },
    { id: 'tools.computer', name: 'Computer', many: true },
  ],
} as const satisfies SectionDef;

/** One of the 8 sections, or `tools`. */
export type SectionId = (typeof SECTION_DEFS)[number]['id'] | (typeof TOOLS_DEF)['id'];

/** A job's stable id, such as `writing.editing`. Tools have ids too (`tools.browser`). */
export type JobId = (typeof SECTION_DEFS)[number]['jobs'][number]['id'] | (typeof TOOLS_DEF)['jobs'][number]['id'];

export interface Job {
  readonly id: JobId;
  readonly section: SectionId;
  /** As the map shows it. */
  readonly name: string;
  /** Holds as many skills as you like (one per platform or tool), so two in it are not a duplicate. */
  readonly many: boolean;
}

export interface JobSection {
  readonly id: SectionId;
  readonly name: string;
  /** In the map's order. */
  readonly jobs: readonly Job[];
}

function section(def: SectionDef): JobSection {
  const id = def.id as SectionId;
  const jobs = def.jobs.map((job): Job => Object.freeze({ id: job.id as JobId, section: id, name: job.name, many: job.many ?? false }));
  return Object.freeze({ id, name: def.name, jobs: Object.freeze(jobs) });
}

/** The 8 sections of work, in the map's order. Tools are not among them. */
export const JOB_SECTIONS: readonly JobSection[] = Object.freeze(SECTION_DEFS.map(section));

/** Tools: on the map, in a section of their own, and never counted as jobs. */
export const TOOLS_SECTION: JobSection = section(TOOLS_DEF);

/** The 46 jobs a kit is counted against, in the map's order. */
export const JOBS: readonly Job[] = Object.freeze(JOB_SECTIONS.flatMap((sec) => sec.jobs));

/** Every place a skill can sit: the 46 jobs, then the tools. Also the classifier's tie-break order. */
const SLOTS: readonly Job[] = [...JOBS, ...TOOLS_SECTION.jobs];
const BY_ID: ReadonlyMap<string, Job> = new Map(SLOTS.map((job) => [job.id, job]));

/** The job (or tool) with this id. */
export function jobById(id: JobId): Job;
export function jobById(id: string): Job | undefined;
export function jobById(id: string): Job | undefined {
  return BY_ID.get(id);
}

export function isJobId(id: string): id is JobId {
  return BY_ID.has(id);
}

// ---------------------------------------------------------------------------
// classifyJob
// ---------------------------------------------------------------------------

/**
 * Skills whose job is known by their slug. Every pick on the map is here, so a
 * skill the person filled a job with lands back in that job on the next scan,
 * plus common skills whose slug says what they do. Checked before any term.
 * An object literal so a slug listed twice is a compile error.
 */
const KNOWN_SLUG_TABLE: Readonly<Record<string, JobId>> = {
  // Writing
  'social-content': 'writing.short-posts',
  'thread-writer': 'writing.short-posts',
  'linkedin-content': 'writing.short-posts',
  'write-blog': 'writing.long-reads',
  'blog-writing-guide': 'writing.long-reads',
  'publish-article': 'writing.long-reads',
  'ce-noslop': 'writing.editing',
  'writing-guidelines': 'writing.editing',
  'better-writing': 'writing.editing',
  'doc-coauthoring': 'writing.docs',
  'document-generate': 'writing.docs',
  'documentation-and-adrs': 'writing.docs',
  // Marketing
  'write-landing': 'marketing.landing-pages',
  copywriting: 'marketing.landing-pages',
  'page-cro': 'marketing.landing-pages',
  'google-ads': 'marketing.ads',
  'facebook-ads': 'marketing.ads',
  'linkedin-ads': 'marketing.ads',
  newsletter: 'marketing.newsletters',
  'ce-promote': 'marketing.launches',
  'launch-strategy': 'marketing.launches',
  'release-notes': 'marketing.launches',
  'seo-audit': 'marketing.seo',
  'keyword-research': 'marketing.seo',
  'schema-markup': 'marketing.seo',
  'content-calendar': 'marketing.social',
  'content-repurposing': 'marketing.social',
  bluesky: 'marketing.social',
  // Sales
  'icp-builder': 'sales.prospecting',
  'apollo-outreach': 'sales.prospecting',
  'ideal-customer-profile': 'sales.prospecting',
  'email-sequence': 'sales.follow-ups',
  // Design
  'better-ui': 'design.interfaces',
  'build-design': 'design.interfaces',
  'taste-design': 'design.interfaces',
  'frontend-design': 'design.interfaces',
  'web-artifacts-builder': 'design.interfaces',
  'better-interface': 'design.design-reviews',
  'web-design-guidelines': 'design.design-reviews',
  'interface-review': 'design.design-reviews',
  'better-typography': 'design.visual-system',
  'better-colors': 'design.visual-system',
  'design-md': 'design.visual-system',
  'brand-guidelines': 'design.visual-system',
  'theme-factory': 'design.visual-system',
  'generate-image': 'design.images',
  'canvas-design': 'design.images',
  'algorithmic-art': 'design.images',
  'vercel-react-view-transitions': 'design.motion',
  'design-motion': 'design.motion',
  'expo-animation': 'design.motion',
  'marketing-slides': 'design.decks',
  'presentation-creator': 'design.decks',
  'recipe-create-presentation': 'design.decks',
  pptx: 'design.decks',
  // Development
  'code-review': 'development.code-review',
  'requesting-code-review': 'development.code-review',
  'receiving-code-review': 'development.code-review',
  'ce-code-review': 'development.code-review',
  tdd: 'development.tests',
  'test-driven-development': 'development.tests',
  'ce-test-browser': 'development.tests',
  'webapp-testing': 'development.tests',
  'ce-debug': 'development.debugging',
  'diagnosing-bugs': 'development.debugging',
  'debugging-and-error-recovery': 'development.debugging',
  'systematic-debugging': 'development.debugging',
  'ce-commit-push-pr': 'development.pull-requests',
  'pr-writer': 'development.pull-requests',
  pr: 'development.pull-requests',
  'ce-commit': 'development.pull-requests',
  'ce-resolve-pr-feedback': 'development.pull-requests',
  'to-spec': 'development.specs',
  'grill-me': 'development.specs',
  'spec-driven-development': 'development.specs',
  'ce-plan': 'development.specs',
  'ce-brainstorm': 'development.specs',
  'writing-plans': 'development.specs',
  brainstorming: 'development.specs',
  cso: 'development.security',
  'find-bugs': 'development.security',
  'security-review': 'development.security',
  'claude-api': 'development.platforms',
  cloudflare: 'development.platforms',
  wrangler: 'development.platforms',
  'cf-cli': 'development.platforms',
  'durable-objects': 'development.platforms',
  'workers-best-practices': 'development.platforms',
  'nextjs-on-cloudflare': 'development.platforms',
  'agents-sdk': 'development.platforms',
  'sandbox-sdk': 'development.platforms',
  'remotion-best-practices': 'development.platforms',
  // Research
  research: 'research.web-research',
  'parallel-web': 'research.web-research',
  'social-evidence-research': 'research.web-research',
  'deep-research': 'research.web-research',
  'exploratory-data-analysis': 'research.data-analysis',
  'cohort-analysis': 'research.data-analysis',
  dataviz: 'research.data-analysis',
  wtf: 'research.summaries',
  'ce-explain': 'research.summaries',
  'competitor-analysis': 'research.competitors',
  'competitive-battlecard': 'research.competitors',
  'ce-product-pulse': 'research.reports',
  'recipe-generate-report-from-sheet': 'research.reports',
  'competitor-traffic-report': 'research.reports',
  // Business
  'ce-strategy': 'business.strategy',
  'office-hours': 'business.strategy',
  'positioning-ideas': 'business.strategy',
  'brainstorm-okrs': 'business.planning',
  'outcome-roadmap': 'business.planning',
  'sprint-plan': 'business.planning',
  'summarize-meeting': 'business.meetings',
  'team-composition-analysis': 'business.hiring',
  'startup-financial-modeling': 'business.finance',
  'pricing-strategy': 'business.finance',
  docx: 'business.docs-and-pdfs',
  pdf: 'business.docs-and-pdfs',
  'read-file': 'business.spreadsheets',
  'convert-file': 'business.spreadsheets',
  xlsx: 'business.spreadsheets',
  // Media
  clipify: 'media.video',
  'muapi-product-video-ad-maker': 'media.video',
  'podcast-edit': 'media.podcasts',
  'podcast-marketing': 'media.podcasts',
  'seo-image-gen-2': 'media.thumbnails',
  'web-asset-generator': 'media.thumbnails',
  // Tools
  'agent-browser': 'tools.browser',
  'claude-in-chrome': 'tools.browser',
  'computer-use': 'tools.computer',
};

// A Map, so a slug like "constructor" can't hit Object.prototype.
const KNOWN_SLUGS: ReadonlyMap<string, JobId> = new Map(Object.entries(KNOWN_SLUG_TABLE));

// Weighted like guessCategory: a hit in the slug, name or description (what the
// author chose to call the thing) counts three times a hit in the body, and
// only the head of the body is read.
const STRONG_WEIGHT = 3;
const BODY_WEIGHT = 1;
const BODY_CHARS = 1500;

// A phrase is the strongest evidence ("landing page" is never an accident), a
// word that belongs to one job is decent evidence, and a word that shows up
// honestly across many jobs only breaks ties: a job needs at least one phrase
// or specific word to win, so a skill that only says "writing" or "review"
// stays Not sorted instead of landing somewhere wrong.
const PHRASE_WEIGHT = 3;
const SPECIFIC_WEIGHT = 2;
const WEAK_WEIGHT = 1;

// Single words that belong to a job but also turn up all over unrelated
// skills: 'review' in every checker, 'plan' in every workflow, 'thread' in
// concurrency, 'contract' in Solidity, 'budget' in token budgets,
// 'reconcile' in state sync. They stay in their lists and stop outvoting
// precise evidence. Phrases are never weak.
const WEAK_TERMS = new Set([
  'thread', 'linkedin', 'reddit', 'blog', 'email', 'outlook', 'edit', 'writing', 'rewrite', 'tighten', 'concise',
  'clarity', 'readability', 'docs', 'speech', 'ad', 'campaign', 'subscriber', 'launch', 'promote', 'announcement',
  'announce', 'keyword', 'social', 'tiktok', 'lead', 'enrich', 'enrichment', 'outbound', 'sequence', 'cadence',
  'quote', 'bid', 'transcript', 'ui', 'interface', 'component', 'layout', 'website', 'dashboard', 'polish', 'css',
  'figma', 'prototype', 'heuristic', 'color', 'colour', 'contrast', 'spacing', 'brand', 'theme', 'radius', 'image',
  'photo', 'icon', 'svg', 'transition', 'spring', 'gesture', 'review', 'reviewer', 'diff', 'lint', 'refactor',
  'simplify', 'coverage', 'playwright', 'fixture', 'bug', 'error', 'exception', 'crash', 'failing', 'broken',
  'regression', 'reproduce', 'commit', 'git', 'github', 'push', 'merge', 'branch', 'plan', 'planning', 'brainstorm',
  'scope', 'architecture', 'secure', 'secret', 'credential', 'auth', 'authentication', 'authorization', 'permission',
  'injection', 'api', 'sdk', 'workers', 'lambda', 'cloud', 'sandbox', 'research', 'investigate', 'graph', 'plot',
  'query', 'metric', 'kpi', 'funnel', 'retention', 'notebook', 'csv', 'explain', 'explanation', 'digest', 'brief',
  'competition', 'landscape', 'alternative', 'comparison', 'report', 'insight', 'finding', 'memo', 'pulse',
  'strategy', 'positioning', 'vision', 'founder', 'pivot', 'priority', 'prioritize', 'prioritization', 'goal',
  'todo', 'estimate', 'timeline', 'minutes', 'calendar', 'schedule', 'zoom', 'attendee', 'candidate', 'interview',
  'resume', 'cv', 'onboarding', 'equity', 'sourcing', 'employee', 'hr', 'revenue', 'pricing', 'budget', 'reconcile',
  'reconciliation', 'runway', 'books', 'cost', 'document', 'contract', 'form', 'letter', 'sheet', 'formula', 'cell',
  'clip', 'youtube', 'ffmpeg', 'caption', 'sound', 'score', 'beat', 'mixing', 'mastering', 'synth', 'episode',
  'guest', 'spotify', 'banner', 'poster', 'browser', 'firefox', 'safari', 'headless', 'click', 'navigate',
  'computer', 'desktop', 'keyboard', 'screen', 'screenshot', 'gui', 'macos',
]);

// What each job is called in a skill's own words. Prefer terms that rarely
// collide across jobs. Write words in their base form: matching adds the
// plural and -ed / -ing forms (see inflect).
const TERMS: Record<JobId, readonly string[]> = {
  'writing.short-posts': [
    'tweet', 'twitter', 'thread', 'x thread', 'twitter thread', 'social post', 'social media post', 'linkedin post',
    'reddit post', 'short post', 'viral', 'linkedin', 'reddit',
  ],
  'writing.long-reads': [
    'blog post', 'blog', 'article', 'essay', 'long form', 'long read', 'case study', 'manuscript', 'chapter',
    'storytelling', 'narrative', 'op ed', 'ghostwrite',
  ],
  'writing.emails': [
    'email', 'inbox', 'gmail', 'outlook', 'email reply', 'reply to email', 'email draft', 'draft email',
    'write email', 'email writing',
  ],
  'writing.editing': [
    'copyedit', 'proofread', 'rewrite', 'prose', 'grammar', 'readability', 'edit', 'writing', 'tighten', 'concise',
    'clarity', 'jargon', 'microcopy', 'ai writing', 'writing tell', 'writing style', 'writing guideline',
    'ux writing', 'interface copy', 'tone of voice', 'line edit',
  ],
  'writing.docs': [
    'documentation', 'docs', 'readme', 'api doc', 'technical writing', 'user guide', 'how to guide', 'tutorial',
    'docstring', 'adr', 'architecture decision record', 'knowledge base', 'wiki', 'runbook', 'help center', 'faq',
  ],
  'writing.scripts': [
    'video script', 'podcast script', 'youtube script', 'voiceover script', 'scriptwriting', 'screenplay',
    'screenwriting', 'teleprompter', 'talk track', 'speech',
  ],
  'marketing.landing-pages': [
    'landing page', 'landing', 'homepage', 'home page', 'hero section', 'sales page', 'product page', 'pricing page',
    'signup page', 'conversion rate', 'cro', 'copywriting', 'copywriter', 'marketing copy', 'web copy',
    'website copy', 'call to action', 'above the fold', 'value proposition',
  ],
  'marketing.ads': [
    'ad', 'ad copy', 'ad creative', 'ad campaign', 'advertising', 'advert', 'google ad', 'facebook ad', 'meta ad',
    'linkedin ad', 'tiktok ad', 'paid social', 'paid search', 'ppc', 'cpc', 'cpm', 'roas', 'sponsored', 'campaign',
  ],
  'marketing.newsletters': [
    'newsletter', 'email newsletter', 'substack', 'beehiiv', 'mailchimp', 'convertkit', 'subscriber',
    'email campaign', 'email list', 'mailing list',
  ],
  'marketing.launches': [
    'launch', 'product launch', 'launch plan', 'launch strategy', 'launch copy', 'launch post', 'product hunt',
    'release note', 'changelog', 'announcement', 'announce', 'go to market', 'promote', 'promotion', 'waitlist',
    'hacker news', 'show hn',
  ],
  'marketing.seo': [
    'seo', 'search engine', 'keyword research', 'keyword', 'schema markup', 'json ld', 'serp', 'backlink',
    'meta description', 'meta tag', 'sitemap', 'organic traffic', 'search ranking', 'search console', 'semrush',
    'ahrefs',
  ],
  'marketing.social': [
    'social media', 'content calendar', 'social calendar', 'repurpose', 'bluesky', 'mastodon', 'instagram',
    'tiktok', 'pinterest', 'social network', 'community management', 'social', 'influencer', 'ugc',
    'schedule post',
  ],
  'sales.prospecting': [
    'prospect', 'lead generation', 'lead gen', 'lead list', 'lead', 'icp', 'ideal customer',
    'ideal customer profile', 'buyer persona', 'target account', 'account research', 'enrich', 'enrichment',
    'sales navigator', 'decision maker',
  ],
  'sales.cold-outreach': [
    'cold email', 'cold outreach', 'cold dm', 'cold message', 'cold call', 'outreach', 'outbound', 'sales email',
    'personalized outreach',
  ],
  'sales.follow-ups': [
    'follow ups', 'follow up email', 'follow up sequence', 'sales follow up', 'followup', 'email sequence', 'drip',
    'nurture', 'sequence', 'cadence', 'touchpoint',
  ],
  'sales.call-notes': [
    'call note', 'sales call', 'discovery call', 'call transcript', 'call summary', 'call recording', 'demo call',
    'gong', 'crm', 'objection', 'meddic', 'bant', 'transcript',
  ],
  'sales.proposals': [
    'proposal', 'sales proposal', 'business proposal', 'rfp', 'request for proposal', 'statement of work',
    'scope of work', 'sow', 'quote', 'pricing proposal', 'bid',
  ],
  'design.interfaces': [
    'user interface', 'ui', 'ui design', 'interface', 'frontend', 'front end', 'web design', 'web app', 'website',
    'component', 'tailwind', 'shadcn', 'css', 'layout', 'responsive', 'dashboard', 'app design', 'design to code',
    'figma to code', 'ux', 'mockup', 'wireframe', 'prototype', 'polish', 'figma',
  ],
  'design.design-reviews': [
    'design review', 'ui review', 'ux review', 'interface review', 'design critique', 'critique', 'design feedback',
    'usability', 'heuristic', 'accessibility', 'a11y', 'wcag', 'interface guideline', 'design guideline',
    'design audit', 'ui audit', 'visual qa',
  ],
  'design.visual-system': [
    'design system', 'visual system', 'design token', 'typography', 'type scale', 'font', 'typeface',
    'color palette', 'colour palette', 'palette', 'color system', 'color', 'colour', 'contrast', 'spacing',
    'brand guideline', 'brand identity', 'brand', 'theme', 'dark mode', 'css variable', 'radius', 'radii', 'figma',
  ],
  'design.images': [
    'image generation', 'generate image', 'ai image', 'text to image', 'illustration', 'illustrate', 'image',
    'photo', 'photography', 'midjourney', 'dall e', 'stable diffusion', 'gpt image', 'image editing', 'inpainting',
    'background removal', 'logo', 'icon', 'artwork', 'generative art', 'algorithmic art', 'svg',
  ],
  'design.motion': [
    'animation', 'animate', 'motion', 'motion design', 'transition', 'view transition', 'easing', 'spring',
    'framer motion', 'gsap', 'lottie', 'keyframe', 'micro interaction', 'microinteraction', 'gesture',
    'scroll animation', 'interaction design',
  ],
  'design.decks': [
    'slides', 'deck', 'slide deck', 'pitch deck', 'presentation', 'pptx', 'powerpoint', 'keynote', 'google slides',
  ],
  'development.code-review': [
    'code review', 'review', 'reviewer', 'pull request review', 'pr review', 'diff', 'code quality', 'code smell',
    'lint', 'refactor', 'simplify', 'clean code', 'maintainability',
  ],
  'development.tests': [
    'test', 'unit test', 'integration test', 'e2e', 'end to end', 'test suite', 'test coverage', 'coverage', 'tdd',
    'test driven', 'red green', 'regression test', 'flaky', 'qa', 'playwright', 'cypress', 'vitest', 'jest',
    'pytest', 'mocha', 'browser test', 'snapshot test', 'fixture',
  ],
  'development.debugging': [
    'debug', 'debugging', 'debugger', 'bug', 'bugfix', 'root cause', 'stack trace', 'diagnose', 'diagnosis',
    'troubleshoot', 'error', 'exception', 'crash', 'failing', 'broken', 'regression', 'reproduce', 'repro',
    'memory leak',
  ],
  'development.pull-requests': [
    'pull request', 'pr', 'pr description', 'pr body', 'pr title', 'commit', 'commit message', 'git', 'github',
    'push', 'merge', 'branch', 'changeset', 'rebase', 'squash', 'cherry pick',
  ],
  'development.specs': [
    'spec', 'specification', 'prd', 'requirement', 'implementation plan', 'technical design', 'design doc', 'rfc',
    'plan', 'planning', 'brainstorm', 'scope', 'acceptance criteria', 'user story', 'architecture',
  ],
  'development.security': [
    'security', 'secure', 'vulnerability', 'vuln', 'threat model', 'pentest', 'penetration test', 'cve', 'owasp',
    'xss', 'csrf', 'sql injection', 'prompt injection', 'injection', 'secret', 'credential', 'auth',
    'authentication', 'authorization', 'permission', 'exploit', 'security review', 'security audit',
    'bot protection', 'bot verification', 'captcha', 'turnstile', 'malware', 'supply chain', 'sast', 'dast',
    'hardening',
  ],
  'development.platforms': [
    'cloudflare', 'wrangler', 'durable object', 'workers', 'vercel', 'netlify', 'aws', 'lambda', 'azure', 'gcp',
    'google cloud', 'firebase', 'supabase', 'heroku', 'fly.io', 'railway', 'docker', 'kubernetes', 'k8s',
    'terraform', 'next.js', 'nextjs', 'react native', 'expo', 'flutter', 'dotnet', 'swiftui', 'android', 'ios',
    'stripe', 'redis', 'postgres', 'mongodb', 'hugging face', 'huggingface', 'remotion', 'claude api',
    'anthropic api', 'anthropic sdk', 'openai api', 'sdk', 'api', 'deploy', 'deployment', 'hosting', 'serverless',
    'edge function', 'sandbox', 'cloud',
  ],
  'research.web-research': [
    'web research', 'deep research', 'research', 'web search', 'search the web', 'online research', 'scrape',
    'scraper', 'crawl', 'crawler', 'citation', 'primary source', 'fact check', 'literature review', 'investigate',
  ],
  'research.data-analysis': [
    'data analysis', 'analyze data', 'data analytics', 'analytics', 'dataset', 'statistics', 'statistical',
    'cohort', 'exploratory data analysis', 'chart', 'graph', 'plot', 'visualization', 'visualisation',
    'data visualization', 'dataviz', 'data viz', 'pandas', 'numpy', 'jupyter', 'notebook', 'sql', 'query',
    'metric', 'kpi', 'funnel', 'retention', 'dashboard', 'csv',
  ],
  'research.summaries': [
    'summary', 'summarize', 'summarise', 'summarization', 'tldr', 'recap', 'key takeaway', 'key point', 'explain',
    'explanation', 'plain language', 'eli5', 'condense', 'distill', 'digest', 'brief',
  ],
  'research.competitors': [
    'competitor', 'competitive', 'competitive analysis', 'competitor analysis', 'competitive intelligence',
    'battlecard', 'competition', 'market landscape', 'landscape', 'alternative', 'comparison',
  ],
  'research.reports': [
    'report', 'research report', 'market research', 'status report', 'weekly report', 'monthly report',
    'progress report', 'executive summary', 'briefing', 'whitepaper', 'white paper', 'investment memo', 'memo',
    'pulse', 'insight', 'finding',
  ],
  'business.strategy': [
    'strategy', 'business strategy', 'product strategy', 'company strategy', 'positioning', 'business model',
    'moat', 'vision', 'north star', 'swot', 'pestle', 'jtbd', 'jobs to be done', 'product market fit', 'pmf',
    'market sizing', 'tam', 'strategic', 'office hours', 'founder', 'what to build', 'monetization', 'growth lever',
    'pivot',
  ],
  'business.planning': [
    'plan', 'planning', 'roadmap', 'okr', 'sprint', 'sprint planning', 'milestone', 'project plan',
    'project management', 'quarterly plan', 'weekly plan', 'daily plan', 'gantt', 'backlog', 'prioritize',
    'prioritization', 'priority', 'goal setting', 'goal', 'todo', 'estimate', 'timeline', 'jira', 'asana',
  ],
  'business.meetings': [
    'meeting', 'meeting note', 'meeting transcript', 'meeting summary', 'meeting minutes', 'agenda', 'standup',
    'one on one', 'action item', 'minutes', 'calendar', 'schedule', 'zoom', 'google meet', 'transcript',
    'attendee', 'granola',
  ],
  'business.hiring': [
    'hire', 'recruit', 'recruiter', 'job description', 'job post', 'candidate', 'interview', 'resume', 'cv',
    'onboarding', 'team composition', 'org chart', 'compensation', 'equity', 'offer letter', 'headcount', 'talent',
    'applicant', 'sourcing', 'employee', 'hr', 'performance review',
  ],
  'business.finance': [
    'finance', 'financial', 'financial model', 'accounting', 'bookkeeping', 'invoice', 'budget', 'expense',
    'revenue', 'pricing', 'tax', 'valuation', 'cash flow', 'profit and loss', 'balance sheet', 'ledger', 'payroll',
    'reconcile', 'reconciliation', 'fundraising', 'investor', 'cap table', 'runway', 'burn rate', 'unit economics',
    'books', 'cost', 'quickbooks', 'xero',
  ],
  'business.docs-and-pdfs': [
    'pdf', 'docx', 'word document', 'word doc', 'google doc', 'document', 'contract', 'legal document', 'form',
    'fillable form', 'ocr', 'letter', 'cover letter', 'handbook', 'worksheet', 'office document', 'tracked change',
    'redline', 'docusign', 'e signature', 'extract text',
  ],
  'business.spreadsheets': [
    'spreadsheet', 'excel', 'xlsx', 'google sheet', 'sheet', 'csv', 'formula', 'pivot table', 'workbook', 'cell',
    'vlookup', 'data file', 'tsv',
  ],
  'media.video': [
    'video', 'film', 'movie', 'clip', 'footage', 'b roll', 'video editing', 'edit video', 'short form video', 'reel',
    'youtube', 'tiktok', 'trailer', 'storyboard', 'motion graphic', 'cinematic', 'mp4', 'ffmpeg',
    'screen recording', 'subtitle', 'caption', 'shot list',
  ],
  'media.music-and-audio': [
    'music', 'audio', 'sound', 'soundtrack', 'song', 'score', 'voiceover', 'voice over', 'text to speech',
    'speech to text', 'tts', 'transcribe', 'transcription', 'whisper', 'sfx', 'sound effect', 'sound design',
    'melody', 'beat', 'mixing', 'mastering', 'midi', 'synth', 'synthesizer', 'jingle', 'elevenlabs', 'suno',
  ],
  'media.podcasts': [
    'podcast', 'episode', 'show note', 'podcast guest', 'guest', 'podcast interview', 'spotify', 'apple podcast',
  ],
  'media.thumbnails': [
    'thumbnail', 'og image', 'open graph', 'social preview', 'social card', 'link preview', 'share image',
    'share card', 'cover image', 'hero image', 'banner', 'favicon', 'app icon', 'meta image', 'twitter card',
    'poster',
  ],
  'tools.browser': [
    'browser', 'browser automation', 'web automation', 'browser extension', 'chrome', 'chromium', 'firefox',
    'safari', 'headless', 'puppeteer', 'playwright', 'selenium', 'devtools', 'click', 'navigate', 'fill form',
    'form filling',
  ],
  'tools.computer': [
    'computer use', 'computer', 'desktop', 'desktop automation', 'remote desktop', 'gui', 'gui automation',
    'accessibility tree', 'mouse', 'keyboard', 'screen', 'screenshot', 'click', 'macos', 'applescript',
  ],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The common forms of a term's last word: "summary" also catches "summaries",
 * "summarize" catches "summarized" and "summarizing", and anything else takes
 * s / es / ing / ed, the way guessCategory's terms do. Doubled consonants
 * ("debugging") are listed as their own terms.
 */
function inflect(word: string): string {
  if (/[^aeiou]y$/.test(word)) return `${escapeRegExp(word.slice(0, -1))}(?:y|ies|ied|ying)`;
  if (word.length > 3 && word.endsWith('e')) return `${escapeRegExp(word.slice(0, -1))}(?:e|es|ed|ing)`;
  return `${escapeRegExp(word)}(?:s|es|ing|ed)?`;
}

interface Matcher {
  readonly re: RegExp;
  readonly weight: number;
}

function matcher(term: string): Matcher {
  const words = term.split(' ');
  const last = inflect(words.pop()!);
  const head = words.map((w) => `${escapeRegExp(w)} `).join('');
  // Word boundaries on both ends, so 'ad' never fires inside "add" or "read".
  const re = new RegExp(`\\b${head}${last}\\b`);
  if (words.length > 0) return { re, weight: PHRASE_WEIGHT };
  return { re, weight: WEAK_TERMS.has(term) ? WEAK_WEIGHT : SPECIFIC_WEIGHT };
}

// Compiled once: a scan classifies every skill on the computer.
const MATCHERS: ReadonlyMap<JobId, readonly Matcher[]> = new Map(
  SLOTS.map((job) => [job.id, TERMS[job.id].map(matcher)]),
);

/** Lowercase, with slug and path separators read as spaces. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[-_/:]+/g, ' ').replace(/\s+/g, ' ');
}

/** A job's score, or 0 when only weak words hit (they break ties, never win alone). */
function score(strong: string, body: string, matchers: readonly Matcher[]): number {
  let total = 0;
  let evidence = false;
  for (const m of matchers) {
    const times = (m.re.test(strong) ? STRONG_WEIGHT : 0) + (m.re.test(body) ? BODY_WEIGHT : 0);
    if (times === 0) continue;
    total += m.weight * times;
    if (m.weight > WEAK_WEIGHT) evidence = true;
  }
  return evidence ? total : 0;
}

/** A slug as the known-slug table writes it: no plugin or author prefix, lowercase, dashed. */
function slugKey(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^.*[:/]/, '')
    .replace(/[\s_]+/g, '-');
}

export interface ClassifyJobInput {
  /** Folder or registry slug. A plugin or author prefix (`plugin:slug`, `@handle/slug`) is ignored. */
  slug: string;
  /** Frontmatter name or display title. */
  name?: string | null;
  description?: string | null;
  /** SKILL.md body (or the whole file); only the first 1500 characters are read. */
  body?: string | null;
}

/**
 * The job a skill does, or null when nothing says (the map shows it under
 * "Not sorted"). The known-slug table answers first; otherwise each job's
 * terms are scored and the highest score wins, ties going to the job that
 * comes first on the map. Local, deterministic and cheap, so the CLI, the app
 * and the browser all sort the same skill the same way.
 */
export function classifyJob(input: ClassifyJobInput): JobId | null {
  const known = KNOWN_SLUGS.get(slugKey(input.slug)) ?? KNOWN_SLUGS.get(slugKey(input.name));
  if (known) return known;

  const strong = normalize(`${input.slug} ${input.name ?? ''} ${input.description ?? ''}`);
  const body = normalize((input.body ?? '').slice(0, BODY_CHARS));

  let best: { id: JobId; score: number } | null = null;
  for (const [id, matchers] of MATCHERS) {
    const total = score(strong, body, matchers);
    // Strictly greater, so a tie stays with the job that comes first on the map.
    if (total > 0 && (best === null || total > best.score)) best = { id, score: total };
  }
  return best?.id ?? null;
}
