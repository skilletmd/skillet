// Labeled corpus for the category-classifier eval (sibling to the scan
// corpus). Each case is a real-or-realistic skill with a hand-assigned expected
// category. We measure top-1 accuracy + a confusion matrix against these labels
// so prompt/model changes are checked against ground truth instead of vibes.
//
// Seeding: most cases are lifted verbatim from the seeded public skills in the
// registry (real slug + real description). The rest are hand-authored to cover
// the taxonomy gaps (finance, productivity, marketing, mobile) and to stress
// the known-confusable pairs (database↔product, agents↔writing, design↔frontend,
// sales↔marketing↔writing). `note` records why a case is hard.

import type { CategoryKey } from '../categories.js';

export interface ClassifyEvalCase {
  id: string;
  slug: string;
  description: string;
  /** Short SKILL.md-ish body; description is the dominant signal regardless. */
  body: string;
  expected: CategoryKey;
  /** Why this case is interesting (confusable pair, gap coverage). */
  note?: string;
}

export const CLASSIFY_EVAL_CORPUS: ClassifyEvalCase[] = [
  // --- Engineering: frontend ---
  {
    id: 'page-speed-audit',
    slug: 'page-speed-audit',
    description:
      'Analyzes web performance from the browser. Measures Core Web Vitals (LCP, INP, CLS), render-blocking resources, layout shifts.',
    body: 'Audit page load. Measure LCP/INP/CLS, find render-blocking JS/CSS, fix layout shift and caching.',
    expected: 'frontend',
  },
  {
    id: 'react-view-transitions',
    slug: 'react-view-transitions',
    description:
      "Implementing smooth, native-feeling animations using React's View Transition API (<ViewTransition> component).",
    body: 'Wrap route changes in <ViewTransition>. Animate shared elements between React component states.',
    expected: 'frontend',
    note: 'animation wording could pull toward design',
  },

  // --- Engineering: mobile (gap: hand-authored) ---
  {
    id: 'expo-push',
    slug: 'expo-push-notifications',
    description:
      'Wire up push notifications in a React Native Expo app: device tokens, permissions, and the Expo push service.',
    body: 'Use expo-notifications. Request iOS/Android permissions, register the device token, send via Expo push API.',
    expected: 'mobile',
    note: 'React Native must beat plain frontend',
  },

  // --- Engineering: backend ---
  {
    id: 'stateful-coordinator',
    slug: 'stateful-coordinator',
    description:
      'Build stateful coordination objects: chat rooms, multiplayer games, booking systems, with RPC methods and embedded SQLite storage.',
    body: 'Define a stateful object class, expose RPC methods, persist with SQLite storage, coordinate WebSocket clients.',
    expected: 'backend',
    note: 'SQLite mention risks database',
  },
  {
    id: 'transactional-email',
    slug: 'transactional-email',
    description:
      'Send and receive transactional emails from a backend service: SDK or REST API, routing, deliverability, SPF/DKIM/DMARC.',
    body: 'Wire a transactional email service into the backend, send mail, configure routing and DKIM.',
    expected: 'backend',
    note: 'email wording risks productivity/marketing',
  },

  // --- Engineering: database (key is "database", label is Data) ---
  {
    id: 'sql-explain',
    slug: 'sql-explain',
    description: 'Explain a gnarly SQL query in plain English.',
    body: 'Walk through a complex SQL query clause by clause, explain joins, subqueries, and window functions.',
    expected: 'database',
  },
  {
    id: 'metric-definition',
    slug: 'metric-definition',
    description: 'Pin down a fuzzy metric so the whole team agrees.',
    body: 'Turn a vague metric into a precise definition: source table, filters, grain, and the exact SQL.',
    expected: 'database',
    note: 'team-alignment framing risks product; it is really analytics/Data',
  },

  // --- Engineering: devops ---
  {
    id: 'k8s-debug',
    slug: 'k8s-debug',
    description: 'Triage a misbehaving pod from logs and describe output.',
    body: 'Read kubectl logs and describe output, identify CrashLoopBackOff causes, propose a fix.',
    expected: 'devops',
  },
  {
    id: 'terraform-review',
    slug: 'terraform-review',
    description: 'Review a Terraform plan for blast radius before apply.',
    body: 'Read a terraform plan, flag destructive changes and blast radius, gate the apply.',
    expected: 'devops',
    note: 'review wording risks quality/security',
  },

  // --- Engineering: security ---
  {
    id: 'security-pass',
    slug: 'security-pass',
    description: 'Second-pass security review for auth and input handling.',
    body: 'Audit auth flows and input handling for injection, authz gaps, and secret leakage.',
    expected: 'security',
    note: 'code-review wording risks quality',
  },
  {
    id: 'bot-protection-setup',
    slug: 'bot-protection-setup',
    description:
      'Set up a CAPTCHA / bot-protection widget end-to-end: scan the codebase, create the widget via the API, deploy the server-side siteverify endpoint, protect a form from bots.',
    body: 'Add bot protection: create the widget, deploy a siteverify endpoint, wire the frontend snippet, validate.',
    expected: 'security',
    note: 'server + frontend wording risks backend/frontend',
  },

  // --- Quality ---
  {
    id: 'pr-review-strict',
    slug: 'pr-review-strict',
    description: 'A strict, kind PR reviewer that catches the real bugs.',
    body: 'Review a diff: real bugs first, then clarity and tests. Kind but exacting.',
    expected: 'quality',
    note: 'classic quality↔security↔devops confusion',
  },
  {
    id: 'test-coverage-gaps',
    slug: 'test-coverage-gaps',
    description: 'Find the untested edge cases that will bite you.',
    body: 'Scan code for missing edge-case tests, weak assertions, and uncovered branches.',
    expected: 'quality',
  },
  {
    id: 'commit-helper',
    slug: 'commit-helper',
    description:
      'Write a clear, conventional commit message from a diff. Use before committing staged changes.',
    body: 'Read the staged diff, summarize intent, emit a conventional-commit message.',
    expected: 'quality',
    note: 'writing-a-message wording risks writing',
  },

  // --- AI & Agents ---
  {
    id: 'agent-runtime-sdk',
    slug: 'agent-runtime-sdk',
    description:
      'Build AI agents with a server-side agent runtime SDK: stateful agents, durable workflows, MCP servers, scheduled tasks.',
    body: 'Define an Agent class, manage state, expose callable RPC, run workflows and MCP tools.',
    expected: 'agents',
    note: 'runs on a server, so risks backend',
  },
  {
    id: 'write-a-skill',
    slug: 'write-a-skill',
    description:
      'Helps you write a good SKILL.md: frontmatter fields, trigger description, scope, and common mistakes.',
    body: 'Guide for authoring a skill: name, description trigger, scope, and pitfalls.',
    expected: 'agents',
    note: 'skill authoring is agents, not writing — the hardest case',
  },

  // --- Design ---
  {
    id: 'ui-guidelines-review',
    slug: 'ui-guidelines-review',
    description:
      'Review UI code for interface-guideline compliance. Use to review my UI, check accessibility, audit visual design.',
    body: 'Audit components against interface guidelines: spacing, hierarchy, accessibility, visual polish.',
    expected: 'design',
    note: 'reviews UI code, so risks frontend/quality',
  },

  // --- Product ---
  {
    id: 'prd-draft',
    slug: 'prd-draft',
    description: 'Draft a tight PRD from a one-line feature idea.',
    body: 'Expand a one-line idea into a PRD: problem, users, scope, success metrics.',
    expected: 'product',
  },
  {
    id: 'user-story-split',
    slug: 'user-story-split',
    description: 'Split a big story into shippable slices.',
    body: 'Break an epic into independently shippable user stories with acceptance criteria.',
    expected: 'product',
  },
  {
    id: 'launch-checklist',
    slug: 'launch-checklist',
    description: 'Generate a launch checklist sized to the risk.',
    body: 'Produce a launch checklist scaled to risk: QA, rollout, comms, rollback.',
    expected: 'product',
    note: 'launch wording risks marketing',
  },

  // --- Writing ---
  {
    id: 'tighten-prose',
    slug: 'tighten-prose',
    description:
      "Cut the flab from any draft without losing the voice. Use when text feels long, hedgy, or repetitive.",
    body: 'Edit prose for concision: cut hedging and repetition, keep the author voice.',
    expected: 'writing',
  },
  {
    id: 'blog-outline',
    slug: 'blog-outline',
    description: 'Outline a blog post that actually has a spine.',
    body: 'Turn a topic into a structured blog outline with a clear argument spine.',
    expected: 'writing',
    note: 'blog/content wording risks marketing',
  },

  // --- Marketing (gap: hand-authored) ---
  {
    id: 'seo-content-brief',
    slug: 'seo-content-brief',
    description:
      'Turn a target keyword into an SEO content brief: search intent, headings, entities, and internal links for ranking.',
    body: 'Build an SEO brief: cluster keywords, map intent, outline headings, suggest internal links and CRO hooks.',
    expected: 'marketing',
    note: 'content wording risks writing; intent is growth/SEO',
  },

  // --- Sales ---
  {
    id: 'cold-email-rewrite',
    slug: 'cold-email-rewrite',
    description: 'Rewrite a cold email so it sounds human and lands.',
    body: 'Rewrite outbound cold email: tighten the hook, cut spam, sound human, drive a reply.',
    expected: 'sales',
    note: 'email rewrite straddles writing↔marketing↔sales',
  },
  {
    id: 'account-research',
    slug: 'account-research',
    description: 'Pre-call account brief from public sources.',
    body: 'Compile a pre-call brief on a target account: news, org, pain, talking points.',
    expected: 'sales',
  },
  {
    id: 'discovery-call-notes',
    slug: 'discovery-call-notes',
    description: 'Turn a messy call transcript into structured discovery notes.',
    body: 'Convert a sales discovery transcript into structured notes: pain, budget, next steps.',
    expected: 'sales',
    note: 'notes/transcript wording risks productivity',
  },

  // --- Finance (gap: hand-authored) ---
  {
    id: 'saas-model',
    slug: 'saas-financial-model',
    description:
      'Build a SaaS financial model: MRR, churn, CAC payback, and a 3-statement projection from assumptions.',
    body: 'Model MRR/ARR, churn, CAC payback, runway, and a 3-statement projection in a spreadsheet.',
    expected: 'finance',
    note: 'metrics wording risks database; intent is financial modeling',
  },
  {
    id: 'invoice-reconcile',
    slug: 'invoice-reconcile',
    description: 'Reconcile invoices against bank transactions and flag mismatches for accounting.',
    body: 'Match invoices to bank lines, flag discrepancies, prep the reconciliation for accounting.',
    expected: 'finance',
  },

  // --- Productivity (gap: hand-authored) ---
  {
    id: 'inbox-triage',
    slug: 'inbox-triage',
    description:
      'Triage an email inbox: summarize threads, draft replies, and surface what needs a decision today.',
    body: 'Summarize unread threads, draft quick replies, flag decisions, schedule follow-ups on the calendar.',
    expected: 'productivity',
    note: 'email/reply wording risks writing/sales; intent is personal automation',
  },
  {
    id: 'meeting-notes',
    slug: 'meeting-notes',
    description: 'Turn a meeting transcript into notes, decisions, and action items with owners.',
    body: 'Convert a meeting transcript into a recap: decisions, action items, owners, due dates.',
    expected: 'productivity',
    note: 'transcript→notes overlaps sales discovery-notes',
  },

  // --- Media (gap closed; real skills.sh cases that previously misfiled) ---
  {
    id: 'video-edit',
    slug: 'video-edit',
    description: 'Edit video: trim clips, add captions, transitions, and export a final cut.',
    body: 'Trim clips, add captions and transitions, color, and export the final video.',
    expected: 'media',
    note: 'pre-media-category this misfiled as writing',
  },
  {
    id: 'image-gen',
    slug: 'image-gen',
    description:
      'Generate images from text prompts and edit them: style transfer, logos, product mockups.',
    body: 'Text-to-image generation and editing: style transfer, logos, mockups, inpainting.',
    expected: 'media',
    note: 'risks design (visual) — image generation is media',
  },
  {
    id: 'programmatic-video',
    slug: 'programmatic-video',
    description:
      'Create videos programmatically in React: compositions, sequences, and rendering frames to a final video file.',
    body: 'Author video compositions and sequences in React, then render to an MP4.',
    expected: 'media',
    note: 'programmatic video in React — risks frontend, but the output is video',
  },

  // --- Extra real skills.sh cases (grow coverage, keep eval adversarial) ---
  {
    id: 'tdd',
    slug: 'tdd',
    description:
      'Test-driven development: write a failing test first, make it pass, refactor. Red-green-refactor.',
    body: 'Drive code with tests: red, green, refactor. Write the failing test before the code.',
    expected: 'quality',
  },
  {
    id: 'ui-component-library',
    slug: 'ui-component-library',
    description:
      'Integrate and customize a headless UI component library in a React app: install, theme, and compose accessible primitives.',
    body: 'Add a headless component library: install components, theme tokens, compose accessible React primitives.',
    expected: 'frontend',
    note: 'component library — risks design',
  },
  {
    id: 'cloud-compute-provisioning',
    slug: 'cloud-compute-provisioning',
    description: 'Provision and manage cloud compute resources: VMs, scale sets, and capacity.',
    body: 'Provision cloud VMs and scale sets, manage capacity and infra.',
    expected: 'devops',
    note: 'cloud infra — risks backend',
  },
  {
    id: 'agent-browser',
    slug: 'agent-browser',
    description:
      'Give an AI agent browser automation: navigate pages, click, fill forms, and extract content in a loop.',
    body: 'Drive a headless browser from an agent loop: navigate, click, fill, extract.',
    expected: 'agents',
    note: 'browser automation — risks backend/productivity',
  },

  // --- Research (gap: hand-authored) ---
  {
    id: 'deep-research',
    slug: 'deep-research',
    description:
      'Run a deep, multi-source research pass on a question: fan out web searches, fetch and read sources, then synthesize a cited report.',
    body: 'Plan sub-questions, search the web, read sources, cross-check claims, and write a synthesized brief with citations.',
    expected: 'research',
    note: 'web research + synthesis — risks writing, but the job is finding and synthesizing, not drafting',
  },
  {
    id: 'competitor-teardown',
    slug: 'competitor-teardown',
    description:
      'Research a market and its players: pull competitor pricing, positioning, and features into a comparison.',
    body: 'Gather competitor pricing, positioning, and feature sets; analyze the landscape into a comparison table.',
    expected: 'research',
    note: 'market/competitive analysis — risks marketing/strategy, but the job is the analysis itself',
  },
];
