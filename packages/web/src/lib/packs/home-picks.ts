// Generated from Skillet's public registry (registry.skillet.md/api/v1/skills),
// read Nov 16, 2026: 1,504 public skills. Every pick here was scan-clean that
// day. The first skill per job is the pick, the rest are swaps; which skill
// goes where is my curation. An empty list means no clean skill does that job
// on Skillet yet. Keys are job ids from @skillet/protocol/jobs. Regenerate with
// scratchpad/scripts/gen_home_picks.py.

import type { JobId } from "@skillet/protocol/jobs"

export interface HomeSkill {
  handle: string
  slug: string
  name: string
  /** The maker's name on Skillet. */
  by: string
  avatarUrl: string
  /** First sentence of the skill's own description. */
  about: string
}

export interface HomeStack {
  handle: string
  name: string
  avatarUrl: string
  /** Its scan-clean skills on Skillet. */
  skills: number
  /** The GitHub repo `skillet add` installs from. */
  repo: string
}

export const CATALOG_SIZE = 1504

/** Each job's skills by protocol job id, pick first. An empty list means no pick yet. */
export const HOME_PICKS: Record<JobId, HomeSkill[]> = {
  "writing.short-posts": [
    { handle: "openclaudia", slug: "social-content", name: "Social Content", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Create and publish social media posts for Reddit, Twitter/X, LinkedIn, Instagram, Facebook, and TikTok." },
    { handle: "openclaudia", slug: "thread-writer", name: "Thread Writer", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Write viral Twitter/X threads and Reddit posts with proven structures, hooks, and engagement tactics." },
    { handle: "openclaudia", slug: "linkedin-content", name: "LinkedIn Content", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Create high-performing LinkedIn posts and content strategy." },
  ],
  "writing.long-reads": [
    { handle: "openclaudia", slug: "write-blog", name: "Write Blog", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Generate a full SEO-optimized blog post." },
    { handle: "sentry", slug: "blog-writing-guide", name: "Blog Writing Guide", by: "Sentry", avatarUrl: "https://github.com/getsentry.png", about: "Write, review, and improve blog posts for the Sentry engineering blog following Sentry's specific writing standards, voice, and quality bar." },
    { handle: "openclaudia", slug: "publish-article", name: "Publish Article", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Publish an article to a site you own." },
  ],
  "writing.emails": [],
  "writing.editing": [
    { handle: "every", slug: "ce-noslop", name: "Noslop", by: "Every", avatarUrl: "https://github.com/EveryInc.png", about: "Rewrite, check, or draft prose so it carries no AI writing tells, reads plainly on the first read, and keeps every source fact." },
    { handle: "vercel", slug: "writing-guidelines", name: "Writing Guidelines", by: "Vercel", avatarUrl: "https://github.com/vercel.png", about: "Review docs/prose for Writing Guidelines compliance." },
    { handle: "jakubkrehel", slug: "better-writing", name: "Better Writing", by: "Jakub Krehel", avatarUrl: "https://github.com/jakubkrehel.png", about: "Writes and reviews interface copy, from labels and errors to empty states and confirmations, so it matches the product's voice and tells people what to do next." },
  ],
  "writing.docs": [
    { handle: "sentry", slug: "doc-coauthoring", name: "Doc Coauthoring", by: "Sentry", avatarUrl: "https://github.com/getsentry.png", about: "Guide users through a structured workflow for co-authoring documentation." },
    { handle: "garrytan", slug: "document-generate", name: "Document Generate", by: "Garry Tan", avatarUrl: "https://github.com/garrytan.png", about: "Generate missing documentation from scratch for a feature, module, or entire project." },
    { handle: "addyosmani", slug: "documentation-and-adrs", name: "Documentation and ADRs", by: "Addy Osmani", avatarUrl: "https://github.com/addyosmani.png", about: "Records decisions and documentation, and detects when documentation has drifted from the code it describes." },
  ],
  "writing.scripts": [],
  "marketing.landing-pages": [
    { handle: "openclaudia", slug: "write-landing", name: "Write Landing", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Create high-converting landing page copy and structure." },
    { handle: "openclaudia", slug: "copywriting", name: "Copywriting", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Write marketing copy for any page type: landing pages, product pages, about pages, sales pages, ads, and more." },
    { handle: "openclaudia", slug: "page-cro", name: "Page CRO", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Audit and optimize landing pages for conversion rate." },
  ],
  "marketing.ads": [
    { handle: "openclaudia", slug: "google-ads", name: "Google Ads", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Write Google Ads copy and build campaign structures." },
    { handle: "openclaudia", slug: "facebook-ads", name: "Facebook Ads", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Create Facebook and Meta ad campaigns, write ad copy, define audiences, and plan budgets." },
    { handle: "openclaudia", slug: "linkedin-ads", name: "LinkedIn Ads", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Create LinkedIn ad campaigns, write sponsored content, define professional audiences, and plan B2B advertising budgets." },
  ],
  "marketing.newsletters": [
    { handle: "openclaudia", slug: "newsletter", name: "Newsletter", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Plan and grow an email newsletter." },
  ],
  "marketing.launches": [
    { handle: "every", slug: "ce-promote", name: "Promote", by: "Every", avatarUrl: "https://github.com/EveryInc.png", about: "Draft launch or promotion copy for a shipped feature." },
    { handle: "openclaudia", slug: "launch-strategy", name: "Launch Strategy", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Plan and execute product launches with week-by-week timelines and channel-specific playbooks." },
    { handle: "phuryn", slug: "release-notes", name: "Release Notes", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Generate user-facing release notes from tickets, PRDs, or changelogs." },
  ],
  "marketing.seo": [
    { handle: "openclaudia", slug: "seo-audit", name: "SEO Audit", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Run a full technical and on-page SEO audit on any website or page." },
    { handle: "openclaudia", slug: "keyword-research", name: "Keyword Research", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Perform keyword research using the SemRush API." },
    { handle: "openclaudia", slug: "schema-markup", name: "Schema Markup", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Generate Schema.org structured data (JSON-LD) for any page type." },
  ],
  "marketing.social": [
    { handle: "openclaudia", slug: "content-calendar", name: "Content Calendar", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Plan and schedule social media and content marketing calendars." },
    { handle: "openclaudia", slug: "content-repurposing", name: "Content Repurposing", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Repurpose and atomize content across platforms and formats." },
    { handle: "openclaudia", slug: "bluesky", name: "Bluesky", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Create and manage content for Bluesky social network." },
  ],
  "sales.prospecting": [
    { handle: "openclaudia", slug: "icp-builder", name: "ICP Builder", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Define ideal customer profiles and buyer personas with structured frameworks." },
    { handle: "openclaudia", slug: "apollo-outreach", name: "Apollo Outreach", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Research and enrich B2B leads using the Apollo.io API." },
    { handle: "phuryn", slug: "ideal-customer-profile", name: "Ideal Customer Profile", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Identify the Ideal Customer Profile (ICP) from research data with demographics, behaviors, JTBD, and needs." },
  ],
  "sales.cold-outreach": [],
  "sales.follow-ups": [
    { handle: "openclaudia", slug: "email-sequence", name: "Email Sequence", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Create email drip campaigns, nurture sequences, and automated email flows." },
  ],
  "sales.call-notes": [],
  "sales.proposals": [],
  "design.interfaces": [
    { handle: "jakubkrehel", slug: "better-ui", name: "Better UI", by: "Jakub Krehel", avatarUrl: "https://github.com/jakubkrehel.png", about: "Polishes surfaces, icons and motion with exact values for border radius, optical alignment, shadows, icon states and animation." },
    { handle: "jakubkrehel", slug: "build-design", name: "Build Design", by: "Jakub Krehel", avatarUrl: "https://github.com/jakubkrehel.png", about: "Builds UI from a Figma file or a design image so it matches the design, using the project's existing tokens and components." },
    { handle: "stitch", slug: "taste-design", name: "Taste Design", by: "Google Stitch", avatarUrl: "https://github.com/google-labs-code.png", about: "Semantic Design System Skill for Google Stitch." },
  ],
  "design.design-reviews": [
    { handle: "jakubkrehel", slug: "better-interface", name: "Better Interface", by: "Jakub Krehel", avatarUrl: "https://github.com/jakubkrehel.png", about: "Reviews a screen, flow or whole interface across accessibility, layout, writing, typography, color and UI polish, and returns one ranked report." },
    { handle: "vercel", slug: "web-design-guidelines", name: "Web Design Guidelines", by: "Vercel", avatarUrl: "https://github.com/vercel.png", about: "Review UI code for Web Interface Guidelines compliance." },
    { handle: "jakubkrehel", slug: "interface-review", name: "Interface Review", by: "Jakub Krehel", avatarUrl: "https://github.com/jakubkrehel.png", about: "Reviews a branch, pull request or uncommitted change for the interface problems it introduced or regressed, across accessibility, layout, writing, typography, color and UI." },
  ],
  "design.visual-system": [
    { handle: "jakubkrehel", slug: "better-typography", name: "Better Typography", by: "Jakub Krehel", avatarUrl: "https://github.com/jakubkrehel.png", about: "Sets and reviews how text renders, from the type scale and spacing to font features, wrapping, truncation and punctuation." },
    { handle: "jakubkrehel", slug: "better-colors", name: "Better Colors", by: "Jakub Krehel", avatarUrl: "https://github.com/jakubkrehel.png", about: "Builds and checks color systems by generating palettes, naming semantic tokens, converting between formats and measuring contrast." },
    { handle: "stitch", slug: "design-md", name: "Design MD", by: "Google Stitch", avatarUrl: "https://github.com/google-labs-code.png", about: "Analyze Stitch projects and synthesize a semantic design system into DESIGN.md files." },
  ],
  "design.images": [
    { handle: "openclaudia", slug: "generate-image", name: "Generate Image", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Generate images using AI (OpenAI GPT Image or Stability AI)." },
  ],
  "design.motion": [
    { handle: "vercel", slug: "vercel-react-view-transitions", name: "React View Transitions", by: "Vercel", avatarUrl: "https://github.com/vercel.png", about: "Guide for implementing smooth, native-feeling animations using React's View Transition API (`<ViewTransition>` component, `addTransitionType`, and CSS view transition pseudo-elements)." },
    { handle: "garrytan", slug: "design-motion", name: "Design Motion", by: "Garry Tan", avatarUrl: "https://github.com/garrytan.png", about: "Design motion: animate an approved design into a seamless MP4 and GIF loop." },
    { handle: "expo", slug: "expo-animation", name: "Expo Animation", by: "Expo", avatarUrl: "https://github.com/expo.png", about: "Build animations in React Native and Expo, making the decisions in the order that determines whether they feel right." },
  ],
  "design.decks": [
    { handle: "openclaudia", slug: "marketing-slides", name: "Marketing Slides", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Create marketing slides, pitch decks, sales decks, and product presentations." },
    { handle: "sentry", slug: "presentation-creator", name: "Presentation Creator", by: "Sentry", avatarUrl: "https://github.com/getsentry.png", about: "Create data-driven presentation slides using React, Vite, and Recharts with Sentry branding." },
    { handle: "googleworkspace", slug: "recipe-create-presentation", name: "Create Presentation", by: "Google Workspace", avatarUrl: "https://github.com/googleworkspace.png", about: "Create a new Google Slides presentation and add initial slides." },
  ],
  "development.code-review": [
    { handle: "mattpocock", slug: "code-review", name: "Code Review", by: "Matt Pocock", avatarUrl: "https://github.com/mattpocock.png", about: "Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?)." },
    { handle: "sentry", slug: "code-review", name: "Code Review", by: "Sentry", avatarUrl: "https://github.com/getsentry.png", about: "Perform code reviews following Sentry engineering practices." },
    { handle: "obra", slug: "requesting-code-review", name: "Requesting Code Review", by: "Jesse Vincent", avatarUrl: "https://github.com/obra.png", about: "Use when completing tasks, implementing major features, or before merging to verify work meets requirements." },
  ],
  "development.tests": [
    { handle: "mattpocock", slug: "tdd", name: "TDD", by: "Matt Pocock", avatarUrl: "https://github.com/mattpocock.png", about: "Test-driven development." },
    { handle: "obra", slug: "test-driven-development", name: "Test-Driven Development", by: "Jesse Vincent", avatarUrl: "https://github.com/obra.png", about: "Use when implementing any feature or bugfix, before writing implementation code." },
    { handle: "every", slug: "ce-test-browser", name: "Test Browser", by: "Every", avatarUrl: "https://github.com/EveryInc.png", about: "Run browser tests for pages affected by the current branch or PR." },
  ],
  "development.debugging": [
    { handle: "every", slug: "ce-debug", name: "Debug", by: "Every", avatarUrl: "https://github.com/EveryInc.png", about: "Diagnosis loop for bugs and failing behavior." },
    { handle: "mattpocock", slug: "diagnosing-bugs", name: "Diagnosing Bugs", by: "Matt Pocock", avatarUrl: "https://github.com/mattpocock.png", about: "Diagnosis loop for hard bugs and performance regressions." },
    { handle: "addyosmani", slug: "debugging-and-error-recovery", name: "Debugging and Error Recovery", by: "Addy Osmani", avatarUrl: "https://github.com/addyosmani.png", about: "Guides systematic root-cause debugging." },
  ],
  "development.pull-requests": [
    { handle: "every", slug: "ce-commit-push-pr", name: "Commit Push PR", by: "Every", avatarUrl: "https://github.com/EveryInc.png", about: "Commit, push, and open a PR." },
    { handle: "sentry", slug: "pr-writer", name: "PR Writer", by: "Sentry", avatarUrl: "https://github.com/getsentry.png", about: "Create or refresh reviewer-facing PR titles and descriptions." },
    { handle: "mattpocock", slug: "pr", name: "PR", by: "Matt Pocock", avatarUrl: "https://github.com/mattpocock.png", about: "Use when writing a PR body." },
  ],
  "development.specs": [
    { handle: "mattpocock", slug: "to-spec", name: "To Spec", by: "Matt Pocock", avatarUrl: "https://github.com/mattpocock.png", about: "Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed." },
    { handle: "mattpocock", slug: "grill-me", name: "Grill Me", by: "Matt Pocock", avatarUrl: "https://github.com/mattpocock.png", about: "A relentless interview to sharpen a plan or design." },
    { handle: "addyosmani", slug: "spec-driven-development", name: "Spec-Driven Development", by: "Addy Osmani", avatarUrl: "https://github.com/addyosmani.png", about: "Creates specs before coding." },
  ],
  "development.security": [
    { handle: "garrytan", slug: "cso", name: "CSO", by: "Garry Tan", avatarUrl: "https://github.com/garrytan.png", about: "Security audit: supported static findings; qualified profiles add reproduction and repair candidates." },
    { handle: "sentry", slug: "find-bugs", name: "Find Bugs", by: "Sentry", avatarUrl: "https://github.com/getsentry.png", about: "Find bugs, security vulnerabilities, and code quality issues in local branch changes." },
  ],
  "development.platforms": [],
  "research.web-research": [
    { handle: "mattpocock", slug: "research", name: "Research", by: "Matt Pocock", avatarUrl: "https://github.com/mattpocock.png", about: "Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo." },
    { handle: "k-dense-ai", slug: "parallel-web", name: "Parallel Web", by: "K-Dense", avatarUrl: "https://github.com/K-Dense-AI.png", about: "Uses Parallel CLI for web search, URL extraction, deep research, structured data enrichment, entity discovery, and recurring web monitoring." },
    { handle: "wshobson", slug: "social-evidence-research", name: "Social Evidence Research", by: "Seth Hobson", avatarUrl: "https://github.com/wshobson.png", about: "Research public discussion on social platforms and keep every report claim tied to the source material that supports it." },
  ],
  "research.data-analysis": [
    { handle: "k-dense-ai", slug: "exploratory-data-analysis", name: "Exploratory Data Analysis", by: "K-Dense", avatarUrl: "https://github.com/K-Dense-AI.png", about: "Performs bounded, local exploratory analysis of explicitly supported scientific files." },
    { handle: "phuryn", slug: "cohort-analysis", name: "Cohort Analysis", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Perform cohort analysis on user engagement data." },
  ],
  "research.summaries": [
    { handle: "every", slug: "wtf", name: "WTF", by: "Every", avatarUrl: "https://github.com/EveryInc.png", about: "Explain the last message, or a supplied file, link, or passage, in plain language a person follows on the first read." },
    { handle: "every", slug: "ce-explain", name: "Explain", by: "Every", avatarUrl: "https://github.com/EveryInc.png", about: "Explain how and why something has its current shape, or what happened over a window of work, grounded in evidence." },
  ],
  "research.competitors": [
    { handle: "phuryn", slug: "competitor-analysis", name: "Competitor Analysis", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Analyze competitors with strengths, weaknesses, and differentiation opportunities." },
    { handle: "openclaudia", slug: "competitor-analysis", name: "Competitor Analysis", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Conduct full competitor strategy breakdowns across SEO, ads, social, email, pricing, and positioning." },
    { handle: "phuryn", slug: "competitive-battlecard", name: "Competitive Battlecard", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Create sales-ready competitive battlecards comparing your product against a specific competitor." },
  ],
  "research.reports": [
    { handle: "every", slug: "ce-product-pulse", name: "Product Pulse", by: "Every", avatarUrl: "https://github.com/EveryInc.png", about: "Generate time-windowed product pulse reports from configured signals." },
    { handle: "googleworkspace", slug: "recipe-generate-report-from-sheet", name: "Report from Sheet", by: "Google Workspace", avatarUrl: "https://github.com/googleworkspace.png", about: "Read data from a Google Sheet and create a formatted Google Docs report." },
    { handle: "openclaudia", slug: "competitor-traffic-report", name: "Competitor Traffic Report", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Build an interactive competitive-traffic report for any company and its rivals." },
  ],
  "business.strategy": [
    { handle: "every", slug: "ce-strategy", name: "Strategy", by: "Every", avatarUrl: "https://github.com/EveryInc.png", about: "Create or update STRATEGY.md." },
    { handle: "garrytan", slug: "office-hours", name: "Office Hours", by: "Garry Tan", avatarUrl: "https://github.com/garrytan.png", about: "YC Office Hours." },
    { handle: "phuryn", slug: "positioning-ideas", name: "Positioning Ideas", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Brainstorm product positioning ideas differentiated from competitors." },
  ],
  "business.planning": [
    { handle: "phuryn", slug: "brainstorm-okrs", name: "Brainstorm OKRs", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Brainstorm team-level OKRs aligned with company objectives." },
    { handle: "phuryn", slug: "outcome-roadmap", name: "Outcome Roadmap", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Transform an output-focused roadmap into an outcome-focused one that communicates strategic intent." },
    { handle: "phuryn", slug: "sprint-plan", name: "Sprint Plan", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Plan a sprint with capacity estimation, story selection, dependency mapping, and risk identification." },
  ],
  "business.meetings": [
    { handle: "phuryn", slug: "summarize-meeting", name: "Summarize Meeting", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Summarize a meeting transcript into structured notes with date, participants, topic, key decisions, summary points, and action items." },
  ],
  "business.hiring": [
    { handle: "wshobson", slug: "team-composition-analysis", name: "Team Composition Analysis", by: "Seth Hobson", avatarUrl: "https://github.com/wshobson.png", about: "Design optimal team structures, hiring plans, compensation strategies, and equity allocation for early-stage startups from pre-seed through Series A." },
  ],
  "business.finance": [
    { handle: "wshobson", slug: "startup-financial-modeling", name: "Startup Financial Modeling", by: "Seth Hobson", avatarUrl: "https://github.com/wshobson.png", about: "Build comprehensive 3-5 year financial models with revenue projections, cost structures, cash flow analysis, and scenario planning for early-stage startups." },
    { handle: "phuryn", slug: "pricing-strategy", name: "Pricing Strategy", by: "Pawel Huryn", avatarUrl: "https://github.com/phuryn.png", about: "Analyze and design pricing strategies including pricing models, competitive pricing analysis, willingness-to-pay estimation, and price elasticity." },
    { handle: "openclaudia", slug: "pricing-strategy", name: "Pricing Strategy", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Optimize pricing pages, pricing models, and pricing strategy." },
  ],
  "business.docs-and-pdfs": [],
  "business.spreadsheets": [
    { handle: "duckdb", slug: "read-file", name: "Read File", by: "DuckDB", avatarUrl: "https://github.com/duckdb.png", about: "Read any data file (CSV, JSON, Parquet, Avro, Excel, spatial, SQLite) or remote URL (S3, HTTPS)." },
    { handle: "duckdb", slug: "convert-file", name: "Convert File", by: "DuckDB", avatarUrl: "https://github.com/duckdb.png", about: "Convert any data file to another format: CSV, Parquet, JSON, Excel, GeoJSON, and more." },
  ],
  "media.video": [
    { handle: "louisedesadeleer", slug: "clipify", name: "Clipify", by: "Louise de Sadeleer", avatarUrl: "https://github.com/louisedesadeleer.png", about: "Find compelling moments in a video." },
    { handle: "samuraigpt", slug: "muapi-product-video-ad-maker", name: "Product Video Ad Maker", by: "SamurAIGPT", avatarUrl: "https://github.com/SamurAIGPT.png", about: "Create a high-end cinematic product video advertisement starting from a simple product photo." },
  ],
  "media.music-and-audio": [],
  "media.podcasts": [
    { handle: "openclaudia", slug: "podcast-edit", name: "Podcast Edit", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Edit podcast audio or video." },
    { handle: "openclaudia", slug: "podcast-marketing", name: "Podcast Marketing", by: "OpenClaudia", avatarUrl: "https://github.com/OpenClaudia.png", about: "Plan, produce, and market a podcast." },
  ],
  "media.thumbnails": [
    { handle: "agricidaniel", slug: "seo-image-gen-2", name: "SEO Image Gen", by: "Daniel Agrici", avatarUrl: "https://github.com/AgriciDaniel.png", about: "AI image generation for SEO assets: OG/social preview images, blog hero images, schema images, product photography, infographics." },
    { handle: "alonw0", slug: "web-asset-generator", name: "Web Asset Generator", by: "Alon Wolenitz", avatarUrl: "https://github.com/alonw0.png", about: "Generate web assets including favicons, app icons (PWA), and social media meta images (Open Graph) for Facebook, Twitter, WhatsApp, and LinkedIn." },
  ],
  "tools.browser": [
    { handle: "vercel", slug: "agent-browser", name: "Agent Browser", by: "Vercel", avatarUrl: "https://github.com/vercel.png", about: "Browser automation CLI for AI agents." },
  ],
  "tools.computer": [],
}

/** Platforms holds many: one entry per stack you build on. */
export const STACKS: HomeStack[] = [
  { handle: "vercel", name: "Vercel", avatarUrl: "https://github.com/vercel.png", skills: 18, repo: "vercel-labs/agent-skills" },
  { handle: "google", name: "Google", avatarUrl: "https://github.com/google.png", skills: 53, repo: "google/skills" },
  { handle: "azure", name: "Microsoft Azure", avatarUrl: "https://github.com/azure.png", skills: 26, repo: "microsoft/azure-skills" },
  { handle: "dotnet", name: ".NET", avatarUrl: "https://github.com/dotnet.png", skills: 102, repo: "dotnet/skills" },
  { handle: "expo", name: "Expo", avatarUrl: "https://github.com/expo.png", skills: 21, repo: "expo/skills" },
  { handle: "flutter", name: "Flutter", avatarUrl: "https://github.com/flutter.png", skills: 23, repo: "flutter/agent-plugins" },
  { handle: "huggingface", name: "Hugging Face", avatarUrl: "https://github.com/huggingface.png", skills: 16, repo: "huggingface/skills" },
  { handle: "redis", name: "Redis", avatarUrl: "https://github.com/redis.png", skills: 13, repo: "redis/agent-skills" },
]
