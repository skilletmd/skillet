// Slug → display title.
//
// The implementation lives in `@skillet/protocol/humanize` so the registry's
// kit-name generator and this app cannot drift (they did: a repo's skill
// rendered "UI Skills Root" here while its kit row was created as "Ui Skills"
// server-side). This module stays as the web-facing import path.
//
// Node-free subpath, never the package barrel — the barrel pulls node:crypto
// and blank-pages the app.
export { humanizeSlug } from '@skillet/protocol/humanize'
