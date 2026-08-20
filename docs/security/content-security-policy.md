# Content-Security-Policy (web)

Defense-in-depth for the skillet.md web app. CSP is a **browser backstop** on top of render-time sanitization; it does not replace it.

---

## Layered model

| Layer | Where | What it stops |
|-------|--------|----------------|
| **Primary** | Render sinks | XSS in user-authored HTML/markdown |
| **Secondary** | CSP header | External script/load exfil, clickjacking, plugin vectors, form hijacking, `<base>` tampering |

**Primary controls (must stay green before tightening CSP):**

- Skill **views**: `react-markdown` without `rehype-raw` (`packages/web/tests/render-xss-regression.test.ts`).
- Skill **editor preview**: `marked` + DOMPurify (`skill-markdown-editor-sanitize.test.ts`).
- Trust panel and similar: text children only, no `dangerouslySetInnerHTML` for untrusted input.

**Known CSP limitation:** the policy is **static** (no per-request nonce) so `script-src` includes `'unsafe-inline'`. Injected inline script is **not** blocked by CSP; sanitization is the control there. External script, bad `connect-src`, framing, and object/embed vectors **are** blocked in enforce mode.

---

## Policy source of truth

| File | Role |
|------|------|
| `packages/web/src/lib/security-headers.ts` | Directive values, mode → header name |
| `packages/web/src/proxy.ts` | Attaches headers on every document route |
| `ecosystem.config.cjs` | Prod `WEB_CSP_MODE` (runtime, no rebuild to change) |
| `packages/web/.env.example` | Local dev override |

Companion headers (always sent): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.

---

## Modes (`WEB_CSP_MODE`)

| Value | Header | Use |
|-------|--------|-----|
| `enforce` | `Content-Security-Policy` | **Production default** — browser blocks violations |
| `report-only` | `Content-Security-Policy-Report-Only` | Pre-flight sweep, staging, or rollback step |
| `off` | (none) | Emergency rollback; companions still sent |
| unset / typo | `report-only` | Safe default (`resolveCspMode`) |

Prod sets `enforce` in `ecosystem.config.cjs`. Local dev may use `report-only` or `enforce` in `.env.local`.

---

## Lifecycle (adding or changing surface)

1. **Change code** that loads scripts, styles, fonts, images, or fetch targets from new origins.
2. **Update** `buildCspValue()` in `security-headers.ts` if a new origin is required.
3. **Run** `pnpm --filter @skillet/web test` (includes `security-headers.test.ts`).
4. **Deploy with `report-only`** only if you need a prod sweep before enforce (optional; most changes are caught in CI + local enforce).
5. **Verify** OAuth round-trips, editor preview, skill pages with external images, admin if touched.
6. **Flip to `enforce`** (or keep enforce if sweep was local-only).

Do **not** widen `script-src` with `'unsafe-eval'` in production. Dev-only `'unsafe-eval'` is already gated on `isDev`.

---

## Production deploy

After pulling a release that changes CSP or sets enforce:

```bash
git pull
pnpm exec pm2 reload ecosystem.config.cjs --update-env --only web
```

No rebuild required for a mode-only change. Rebuild web if application code changed.

**Verify:**

```bash
pnpm check:web-csp
# or against prod explicitly:
SITE_URL=https://skillet.md WEB_CSP_MODE=enforce pnpm check:web-csp
```

Manual: DevTools → document response → `Content-Security-Policy` present, console free of `Refused to` on home, feed, settings, skill view, editor preview, sign-in (GitHub/Google).

---

## Rollback

On the prod box, in `ecosystem.config.cjs`:

```js
WEB_CSP_MODE: "report-only",  // or "off"
```

Then:

```bash
pnpm exec pm2 reload ecosystem.config.cjs --update-env --only web
```

Effective immediately. Prefer `report-only` over `off` so violations stay visible in the console.

---

## Developer rules

1. **Never** add `rehype-raw` or unsanitized HTML rendering for skill/user content.
2. **Never** add third-party `<script src="…">` without updating CSP and tests.
3. **Prefer** same-origin BFF (`/api/registry/…`) for browser fetch; keeps `connect-src 'self'`.
4. **New inline boot scripts** in `layout.tsx` are allowed by policy but increase XSS blast radius if sanitization fails — keep them minimal and static.
5. **Desktop app** has its own CSP (`packages/desktop`); do not loosen web CSP to fix desktop avatar/images — use data URIs (see `skillet avatar` CLI).

---

## When to change directives

| Need | Directive | Notes |
|------|-----------|--------|
| Cloudflare Web Analytics (edge-injected beacon) | `script-src` | `https://static.cloudflareinsights.com` — analytics only; skill/kit covers are inline SVG (`coverSvg`), not loaded by Insights |
| New analytics / widget script | `script-src` | Avoid if possible; prefer server-side |
| New CDN for assets | `script-src` / `style-src` / `font-src` | Prefer `'self'` + Next static |
| User markdown images | `img-src` | Already `https:` — do not add `http:` |
| WebSocket (dev HMR) | `connect-src` | Dev-only `ws:` / `wss:` |
| OAuth iframe (rare) | `frame-src` | Currently `'none'` — changing this is high scrutiny |

---

## Follow-up (out of scope for static policy)

- **Nonce- or hash-based `script-src`** without breaking static/CDN caching (scoped design).
- **CSP violation reporting endpoint** (`report-uri` / `report-to`) if we want centralized telemetry instead of console-only.

---

## Related tests

- `packages/web/tests/security-headers.test.ts` — mode and directive shape
- `packages/web/tests/security-tier0.test.ts` — proxy attaches CSP on admin pass-through
- `packages/web/tests/render-xss-regression.test.ts` — view path
- `packages/web/tests/skill-markdown-editor-sanitize.test.ts` — editor path
