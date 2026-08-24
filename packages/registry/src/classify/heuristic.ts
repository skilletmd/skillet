import { CATEGORY_KEYS, type CategoryKey } from '../categories.js';

/**
 * Local, deterministic category guess from a skill's own text — no LLM, no
 * network, so it works identically for PUBLIC and PRIVATE skills and returns
 * instantly at publish/import time. It only ever *prefills*: the category is
 * user-editable afterward, and a wrong guess is one click to fix. That tradeoff
 * (a fast decent guess everyone can override) is why this replaced the Haiku
 * classifier on the hot path — see docs and the publish handler.
 *
 * Scoring: each category has a set of high-precision signal terms. A hit in the
 * slug / title / description (what the author chose to name the thing) weighs
 * more than a hit in the body. Highest score wins; ties break by CATEGORY_KEYS
 * order. No hits → null (stays uncategorized rather than mis-filed).
 */

const STRONG_WEIGHT = 3; // slug + title + description
const BODY_WEIGHT = 1; // SKILL.md body

// Not every term is equal evidence, and counting them as if they were is what
// made this misfile things. `bot-protection-setup` went to backend because
// 'api' + 'server' + 'endpoint' + 'integration' outnumbered 'captcha' +
// 'bot protection', four vague words beating two precise ones.
//
// A multi-word term is the strongest signal available here: nobody writes
// "bot protection" or "core web vitals" by accident. A single word that only
// belongs to one lane is decent evidence. And a single word that shows up
// honestly across several lanes is barely evidence at all — it should be able
// to break a tie, never to win one on its own.
const PHRASE_WEIGHT = 3;
const SPECIFIC_WEIGHT = 2;
const WEAK_WEIGHT = 1;

// Single words that legitimately appear in skills belonging to OTHER categories.
// Every one of these was observed deciding a case it had no business deciding:
// 'audit' sent a Core-Web-Vitals skill and a UI-guidelines skill to security,
// 'sqlite' sent a coordination-object skill to database. They stay in their
// lists — a security skill really does say 'audit' — they just stop outvoting
// precise evidence.
const WEAK_TERMS = new Set([
  // Words another lane claims but that show up honestly all over the catalog.
  'audit', 'plan', 'spec', 'strategy', 'script', 'document', 'task', 'pipeline',
  'integration', 'api', 'server', 'storage', 'query', 'schema', 'sqlite',
  'ui', 'component', 'commit', 'git', 'workflow', 'cloud', 'infra', 'render',
  'canvas', 'editing', 'modeling', 'benchmark', 'survey', 'draft', 'deal',
  'lead', 'ad', 'app store', 'launch', 'blog', 'teach', 'teaching',
  // 'writing' is the worst offender of all: "before writing implementation
  // code" is a QUALITY skill, and "write or fix decorators" is backend. The
  // craft nouns beside it (prose, manuscript, copyedit) carry the real signal.
  'writing',
]);

// High-precision term lists. Prefer terms that rarely collide across categories;
// generic words ("code", "test", "build") are omitted or reserved to one lane.
const SIGNALS: Record<CategoryKey, string[]> = {
  frontend: ['react', 'nextjs', 'next.js', 'vue', 'svelte', 'tailwind', 'css', 'component', 'ui', 'frontend', 'dom', 'jsx', 'tsx', 'gsap', 'shadcn', 'radix', 'core web vitals', 'web performance', 'layout shift', 'render-blocking', 'lcp', 'accessibility', 'responsive', 'bundle size', 'hydration'],
  mobile: ['ios', 'android', 'swift', 'swiftui', 'xcode', 'react native', 'react-native', 'expo', 'mobile', 'app store', 'kotlin', 'flutter', 'dart', 'maui', 'crashlytics', 'gdscript'],
  backend: ['api', 'endpoint', 'server', 'backend', 'rest', 'graphql', 'auth', 'oauth', 'webhook', 'microservice', 'integration', 'grpc', 'rpc', 'websocket', 'stateful', 'coordination', 'rate limit', 'idempoten', 'queue', 'job scheduling'],
  database: ['sql', 'database', 'postgres', 'mysql', 'sqlite', 'schema', 'migration', 'query', 'analytics', 'pipeline', 'etl', 'warehouse', 'prisma', 'duckdb', 'parquet', 'qdrant', 'redis', 'bigquery', 'airflow', 'vector search', 'vector index', 'hnsw', 'data lineage'],
  devops: ['deploy', 'ci/cd', 'cicd', 'docker', 'kubernetes', 'k8s', 'container', 'incident', 'terraform', 'infra', 'pipeline', 'commit', 'git', 'pull request', 'release', 'workflow', 'msbuild', 'nuget', 'dotnet', 'observability', 'opentelemetry', 'telemetry', 'instrumentation', 'monitoring', 'grafana', 'prometheus', 'bazel', 'monorepo', 'istio', 'service mesh', 'azure', 'gke', 'google cloud', 'gcp', 'aws', 'cloud'],
  security: ['security', 'audit', 'threat', 'vuln', 'secret', 'compliance', 'captcha', 'turnstile', 'bot protection', 'pentest', 'exploit', 'cve', 'encryption', 'mtls', 'iam', 'privileged access'],
  quality: ['code review', 'review', 'testing', 'test', 'lint', 'coverage', 'regression', 'e2e', 'unit test', 'qa', 'correctness', 'standards', 'refactor', 'debug', 'mypy', 'type safety', 'anti-pattern', 'profiling', 'commit message', 'conventional commit', 'code smell', 'diff review', 'flaky'],
  agents: ['agent', 'llm', 'rag', 'prompt', 'eval', 'mcp', 'embedding', 'fine-tune', 'inference', 'tool use', 'sub-agent', 'subagent', 'sagemaker', 'training data', 'dpo', 'sft', 'codex', 'skill.md', 'claude.md', 'agents.md', 'frontmatter', 'system prompt', 'context window', 'tool call'],
  design: ['design', 'figma', 'prototype', 'design token', 'critique', 'wireframe', 'ux', 'mockup', 'illustration', 'pptx', 'powerpoint', 'slide deck', 'excalidraw', 'canvas', 'diagram', 'interface guideline', 'visual design', 'design system', 'spacing', 'typography'],
  product: ['roadmap', 'prd', 'product', 'prioritization', 'launch plan', 'spec', 'requirements', 'brainstorm', 'strategy', 'plan', 'user story', 'backlog', 'cohort', 'retention', 'north star', 'segmentation', 'journey map', 'business model', 'market sizing', 'pestle', 'jtbd', 'checklist', 'launch', 'rollout', 'go-to-market'],
  // countHits only ever APPENDS s/es/ing/ed, it never strips, so 'writing' does
  // not catch "writer" or "rewrite". A skill described as "Rewrites text in ...
  // prose style for the ... book" scored zero and stayed uncategorized. The
  // additions are the nouns of the craft, not the verbs: bare 'write' and 'edit'
  // were tried and rejected — they drag in "write or fix @extend_schema
  // decorators" and "restrict file edits to a directory", which are not writing.
  writing: ['writing', 'writer', 'rewrite', 'prose', 'essay', 'editing', 'copyedit', 'manuscript', 'chapter', 'narrative', 'storytelling', 'docs', 'documentation', 'document', 'technical writing', 'script', 'proofread', 'draft', 'long-form', 'ghostwrite', 'teaching', 'teach', 'explainer', 'outline', 'blog', 'article', 'headline'],
  marketing: ['marketing', 'seo', 'campaign', 'social post', 'blog post', 'copywriting', 'ad', 'email campaign', 'newsletter', 'growth', 'landing page copy', 'content gap'],
  sales: ['sales', 'outbound', 'cold email', 'discovery call', 'crm', 'prospect', 'lead', 'account research', 'pipeline', 'outreach', 'deal'],
  finance: ['finance', 'financial', 'accounting', 'invoice', 'invoicing', 'fintech', 'modeling', 'budget', 'revenue', 'bookkeeping', 'tax', 'valuation', 'trading', 'investment', 'investor', 'portfolio', 'backtest', 'earnings', 'technical analysis', 'chargeback', 'dispute', 'drawdown'],
  productivity: ['email', 'calendar', 'notes', 'meeting', 'todo', 'task', 'inbox', 'scheduling', 'reminder', 'personal automation', 'notion', 'gmail', 'google drive', 'google sheets', 'spreadsheet', 'google slides', 'workspace', 'contacts'],
  media: ['video', 'audio', 'music', 'motion graphics', 'editing', 'render', 'podcast', 'voiceover', 'animation', 'soundtrack', 'ffmpeg', 'unsplash', 'stock photo', 'image generation', 'text-to-image', 'style transfer', 'inpainting', 'thumbnail', 'subtitle'],
  research: ['research', 'competitive analysis', 'market analysis', 'synthesis', 'web research', 'deep research', 'literature', 'survey', 'benchmark', 'genomic', 'phylogenetic', 'bioinformatics', 'molecular dynamics', 'scientific', 'web scraping'],
};

function termWeight(term: string): number {
  if (/\s/.test(term)) return PHRASE_WEIGHT;
  return WEAK_TERMS.has(term) ? WEAK_WEIGHT : SPECIFIC_WEIGHT;
}

function countHits(haystack: string, terms: string[]): number {
  let n = 0;
  for (const term of terms) {
    // Word-boundary-ish: guard against substring matches ("ad" in "add").
    // Multi-word terms (they contain a space) match as-is; single words get
    // boundaries plus a small inflection suffix so "test" also catches "tests"
    // and "monitor"→"monitoring", "refactor"→"refactoring", "deploy"→"deployed".
    const pattern = /\s/.test(term)
      ? escapeRegExp(term)
      : `\\b${escapeRegExp(term)}(?:s|es|ing|ed)?\\b`;
    if (new RegExp(pattern).test(haystack)) n += termWeight(term);
  }
  return n;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface GuessCategoryInput {
  slug: string;
  /** Frontmatter name / display title, if distinct from the slug. */
  title?: string | null;
  description?: string | null;
  /** SKILL.md body (or the whole file); only the head is scanned. */
  body?: string | null;
}

/**
 * Best-guess category, or null when nothing matches. Deterministic and cheap.
 */
export function guessCategory(input: GuessCategoryInput): CategoryKey | null {
  const strong = `${input.slug} ${input.title ?? ''} ${input.description ?? ''}`
    .toLowerCase()
    .replace(/[-_/]+/g, ' ');
  const body = (input.body ?? '').slice(0, 1500).toLowerCase();

  let best: { key: CategoryKey; score: number } | null = null;
  for (const key of CATEGORY_KEYS) {
    const terms = SIGNALS[key];
    const score = countHits(strong, terms) * STRONG_WEIGHT + countHits(body, terms) * BODY_WEIGHT;
    if (score > 0 && (best === null || score > best.score)) best = { key, score };
  }
  return best?.key ?? null;
}
