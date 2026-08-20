#!/usr/bin/env node
/** Fail fast when the registry's Node floor is not met. */

const MIN_MAJOR = 24
const major = Number.parseInt(process.version.replace(/^v/, '').split('.')[0] ?? '', 10)

if (Number.isNaN(major) || major < MIN_MAJOR) {
  console.error('')
  console.error(`@skillet/registry requires Node.js ${MIN_MAJOR}+ (found ${process.version}).`)
  console.error('')
  console.error('  nvm install && nvm use   # uses repo .nvmrc')
  console.error('  # or: fnm use')
  console.error('')
  process.exit(1)
}
