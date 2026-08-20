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

// High-precision term lists. Prefer terms that rarely collide across categories;
// generic words ("code", "test", "build") are omitted or reserved to one lane.
const SIGNALS: Record<CategoryKey, string[]> = {
  frontend: ['react', 'nextjs', 'next.js', 'vue', 'svelte', 'tailwind', 'css', 'component', 'ui', 'frontend', 'dom', 'jsx', 'tsx', 'gsap', 'shadcn', 'radix'],
  mobile: ['ios', 'android', 'swift', 'swiftui', 'xcode', 'react native', 'react-native', 'expo', 'mobile', 'app store', 'kotlin', 'flutter', 'dart', 'maui', 'crashlytics', 'gdscript'],
  backend: ['api', 'endpoint', 'server', 'backend', 'rest', 'graphql', 'auth', 'oauth', 'webhook', 'microservice', 'integration', 'grpc'],
  database: ['sql', 'database', 'postgres', 'mysql', 'sqlite', 'schema', 'migration', 'query', 'analytics', 'pipeline', 'etl', 'warehouse', 'prisma', 'duckdb', 'parquet', 'qdrant', 'redis', 'bigquery', 'airflow', 'vector search', 'vector index', 'hnsw', 'data lineage'],
  devops: ['deploy', 'ci/cd', 'cicd', 'docker', 'kubernetes', 'k8s', 'container', 'incident', 'terraform', 'infra', 'pipeline', 'commit', 'git', 'pull request', 'pr ', 'release', 'workflow', 'msbuild', 'nuget', 'dotnet', 'observability', 'opentelemetry', 'telemetry', 'instrumentation', 'monitoring', 'grafana', 'prometheus', 'bazel', 'monorepo', 'istio', 'service mesh', 'azure', 'gke', 'google cloud', 'gcp', 'aws', 'cloud'],
  security: ['security', 'audit', 'threat', 'vuln', 'secret', 'compliance', 'captcha', 'turnstile', 'bot protection', 'pentest', 'exploit', 'cve', 'encryption', 'mtls', 'iam', 'privileged access'],
  quality: ['code review', 'review', 'testing', 'test', 'lint', 'coverage', 'regression', 'e2e', 'unit test', 'qa', 'correctness', 'standards', 'refactor', 'debug', 'mypy', 'type safety', 'anti-pattern', 'profiling'],
  agents: ['agent', 'llm', 'rag', 'prompt', 'eval', 'mcp', 'embedding', 'fine-tune', 'inference', 'tool use', 'sub-agent', 'subagent', 'sagemaker', 'training data', 'dpo', 'sft', 'codex'],
  design: ['design', 'figma', 'prototype', 'design token', 'critique', 'image generation', 'wireframe', 'ux', 'mockup', 'illustration', 'pptx', 'powerpoint', 'slide deck', 'excalidraw', 'canvas', 'diagram'],
  product: ['roadmap', 'prd', 'product', 'prioritization', 'launch plan', 'spec', 'requirements', 'brainstorm', 'strategy', 'plan', 'user story', 'backlog', 'cohort', 'retention', 'north star', 'segmentation', 'journey map', 'business model', 'market sizing', 'pestle', 'jtbd'],
  writing: ['writing', 'essay', 'editing', 'docs', 'documentation', 'document', 'technical writing', 'script', 'proofread', 'draft', 'long-form', 'ghostwrite', 'teaching', 'teach', 'explainer'],
  marketing: ['marketing', 'seo', 'campaign', 'social post', 'blog post', 'copywriting', 'ad', 'email campaign', 'newsletter', 'growth', 'landing page copy', 'content gap'],
  sales: ['sales', 'outbound', 'cold email', 'discovery call', 'crm', 'prospect', 'lead', 'account research', 'pipeline', 'outreach', 'deal'],
  finance: ['finance', 'financial', 'accounting', 'invoice', 'invoicing', 'fintech', 'modeling', 'budget', 'revenue', 'bookkeeping', 'tax', 'valuation', 'trading', 'investment', 'investor', 'portfolio', 'backtest', 'earnings', 'technical analysis', 'chargeback', 'dispute', 'drawdown'],
  productivity: ['email', 'calendar', 'notes', 'meeting', 'todo', 'task', 'inbox', 'scheduling', 'reminder', 'personal automation', 'notion', 'gmail', 'google drive', 'google sheets', 'spreadsheet', 'google slides', 'workspace', 'contacts'],
  media: ['video', 'audio', 'music', 'motion graphics', 'editing', 'render', 'podcast', 'voiceover', 'animation', 'soundtrack', 'ffmpeg', 'unsplash', 'stock photo'],
  research: ['research', 'competitive analysis', 'market analysis', 'synthesis', 'web research', 'deep research', 'literature', 'survey', 'benchmark', 'genomic', 'phylogenetic', 'bioinformatics', 'molecular dynamics', 'scientific', 'web scraping'],
};

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
    if (new RegExp(pattern).test(haystack)) n++;
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
