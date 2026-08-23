/**
 * The platforms Skillet ships a native binary for.
 *
 * Pure data, deliberately: this used to live in build-native.mjs, whose module
 * body resolves a target from argv and process.exit(1)s on an unknown one. Any
 * importer inherited that, so `import { NATIVE_TARGETS }` would kill the
 * process on a host outside the table rather than hand over a lookup table.
 *
 * `triple` names the output file and, for linux, decides the libc a package
 * must declare. `ext` is the executable suffix. Adding a platform here means
 * adding a packages/cli-<key>/ directory and a publish matrix entry too;
 * tests/platform-package-manifests.test.ts fails when those drift apart.
 */

/** @type {Record<string, { triple: string; ext?: string }>} */
export const NATIVE_TARGETS = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin' },
  'darwin-x64': { triple: 'x86_64-apple-darwin' },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu' },
  'linux-arm64': { triple: 'aarch64-unknown-linux-gnu' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', ext: '.exe' },
};
