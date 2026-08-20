import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import eslintPluginUnicorn from "eslint-plugin-unicorn";

// Design-token guardrails (KNO design system): make off-scale choices a lint
// error, not a guideline. Hardcoded colors and arbitrary font sizes in Tailwind
// classes are the two highest-drift categories, so they're banned in className —
// use the --token color vars and the named text-* scale instead.
const colorPattern =
  "(?:bg|text|border|ring|fill|stroke|from|via|to|outline|shadow|decoration|divide|caret|accent)-\\[#[0-9a-fA-F]{3,8}\\]";
const fontPattern = "text-\\[[0-9.]+px\\]";

// Product copy voice: no em-dashes in user-facing strings — short declarative
// sentences, split in two or use a comma. AST-based so code comments stay free;
// a lone "—" (the empty-value placeholder glyph) is allowed. Applied to the
// user-facing surfaces: web, desktop, and CLI sources.
const emDashCopyPattern = "\\S\\s*—|—\\s*\\S";
const emDashMessage =
  "Em-dash in user-facing copy. Product voice is short declarative sentences: split into two sentences or use a comma. (A standalone \"—\" placeholder glyph is fine.)";
const emDashCopyRules = [
  { selector: `Literal[value=/${emDashCopyPattern}/]`, message: emDashMessage },
  {
    selector: `TemplateElement[value.cooked=/${emDashCopyPattern}/]`,
    message: emDashMessage,
  },
  { selector: `JSXText[value=/${emDashCopyPattern}/]`, message: emDashMessage },
];

// Client modules must not runtime-import the @skillet/protocol barrel: it
// statically pulls node:crypto (bundle.ts, delegation.ts), which Next only
// tolerates via a browser shim that bloats the client bundle — and which
// Vite (desktop) doesn't tolerate at all (blank page). Import the node-free
// subpath instead (./covers, ./attention-events, ./device-sync-events, …).
const protocolBarrelClientRule = {
  selector:
    "Program:has(ExpressionStatement > Literal[value='use client']) ImportDeclaration[source.value='@skillet/protocol']:not([importKind='type'])",
  message:
    "Client code must not import the @skillet/protocol barrel (it pulls node:crypto). Import a node-free subpath like @skillet/protocol/covers or @skillet/protocol/attention-events.",
};

const sidecarDynamicImportRule = {
  selector: "ImportExpression > Literal[value=/^node:/]",
  message:
    "Dynamic import of a node builtin throws silently in the packaged sidecar. Use a static top-of-file import instead.",
};

const designTokenRules = {
  "no-restricted-syntax": [
    "error",
    {
      selector: `Literal[value=/${colorPattern}/]`,
      message:
        "Hardcoded hex color in a Tailwind class. Use a design token instead, e.g. text-(--danger), bg-(--success-bg), border-(--warning-line).",
    },
    {
      selector: `TemplateElement[value.cooked=/${colorPattern}/]`,
      message:
        "Hardcoded hex color in a Tailwind class. Use a design token instead, e.g. text-(--danger), bg-(--success-bg), border-(--warning-line).",
    },
    {
      selector: `Literal[value=/${fontPattern}/]`,
      message:
        "Arbitrary font size. Use the named scale (text-xs..text-4xl) so type stays on one decision, not a one-off pixel value.",
    },
    {
      selector: `TemplateElement[value.cooked=/${fontPattern}/]`,
      message:
        "Arbitrary font size. Use the named scale (text-xs..text-4xl) so type stays on one decision, not a one-off pixel value.",
    },
  ],
};

export default [
  {
    files: ["packages/*/src/**/*.ts", "packages/adapters/*/src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Web only: enforce the design-token guardrails on every component/page.
    files: ["packages/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    // Inline `eslint-disable` comments reference the Next.js and react-hooks
    // plugins, which this minimal flat config doesn't load. Register them as
    // no-ops so those directives resolve (they were never enforced on tsx); the
    // design-token rules are what we actually gate on here.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: {
      "@next/next": { rules: { "no-img-element": { create: () => ({}) } } },
      "react-hooks": { rules: { "exhaustive-deps": { create: () => ({}) } } },
      unicorn: eslintPluginUnicorn,
    },
    rules: {
      ...designTokenRules,
      "no-restricted-syntax": [
        "error",
        ...designTokenRules["no-restricted-syntax"].slice(1),
        ...emDashCopyRules,
        protocolBarrelClientRule,
      ],
      // One canonical filename convention: kebab-case everywhere under web/src.
      // Matches the App Router's own files (page.tsx, route.ts) and the rest of
      // the monorepo, and sidesteps the macOS/Linux git case-collision class.
      // App Router special files are already lowercase, so no app/ carve-out.
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      // Avatars are unified: every surface renders identities via the <Avatar>
      // component or resolveAvatar(), so person-vs-team and photo-vs-default-vs-tint
      // can't drift. Hand-rolling the old colored-initials identicon is banned.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/avatar-color",
              importNames: ["avatarColor", "avatarInitials"],
              message:
                "Don't hand-roll identicon avatars. Use the <Avatar> component (kind=\"person\"|\"team\") or resolveAvatar() so avatars stay unified.",
            },
          ],
        },
      ],
    },
  },
  {
    // The sanctioned homes for the raw identicon helpers: the Avatar component and
    // its monogram, the kit-cover mosaic, and the satori OG renderer (no component).
    files: [
      "packages/web/src/components/ui/avatar.tsx",
      "packages/web/src/components/kit-card.tsx",
      "packages/web/src/app/api/og/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // Surfaces where raw color is legitimate, not UI chrome: brand marks, OG/share
    // image renderers (no token cascade in satori), the GitHub-styled code block,
    // and the internal design showcase. Bespoke hero/display type lives here too.
    files: [
      "packages/web/src/components/brand-logos.tsx",
      "packages/web/src/components/doc-code-block.tsx",
      "packages/web/src/app/api/og/**",
      "packages/web/src/app/**/opengraph-image.tsx",
      "packages/web/src/app/internal/og/**",
      "packages/web/src/app/internal/design/**",
      "packages/web/src/app/(consumer)/page.tsx",
      "packages/web/src/app/docs/page.tsx",
    ],
    rules: {
      // Raw color is sanctioned here, but these are still product surfaces:
      // the copy voice (em-dash ban) and the barrel guard stay on.
      "no-restricted-syntax": ["error", ...emDashCopyRules, protocolBarrelClientRule],
    },
  },
  {
    // Desktop runs entirely inside a Tauri webview bundled by Vite, which does
    // not shim node builtins — the @skillet/protocol barrel (node:crypto) blank-
    // pages the app. Subpath imports only (./covers, ./untrusted-href, …).
    files: ["packages/desktop/src/**/*.ts", "packages/desktop/src/**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@skillet/protocol",
              message:
                "The protocol barrel pulls node:crypto and blank-pages the Vite webview. Import a node-free subpath like @skillet/protocol/covers.",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...emDashCopyRules],
    },
  },
  {
    // Desktop tests are colocated in src; test strings aren't product copy.
    files: ["packages/desktop/src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // Not product copy either: web colocated tests, the /lab internal design
    // playground, and /legal lawyer prose. They keep the design-token rules and
    // the protocol-barrel guard (restated — flat-config rule entries replace,
    // not merge); only the em-dash ban is lifted.
    files: [
      "packages/web/src/**/*.test.{ts,tsx}",
      "packages/web/src/app/lab/**",
      "packages/web/src/app/legal/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...designTokenRules["no-restricted-syntax"].slice(1),
        protocolBarrelClientRule,
      ],
    },
  },
  {
    // core and cli ship inside the packaged desktop sidecar, where dynamic
    // `await import('node:…')` throws silently (caused the sign-out bug).
    // Static imports only; tests are exempt (they never run in the sidecar).
    files: ["packages/core/src/**/*.ts", "packages/cli/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", sidecarDynamicImportRule],
    },
  },
  {
    // CLI output is product copy too — same em-dash ban as web/desktop. This
    // block must re-state the sidecar rule: flat-config rule entries replace,
    // not merge.
    files: ["packages/cli/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        sidecarDynamicImportRule,
        ...emDashCopyRules,
      ],
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
];
