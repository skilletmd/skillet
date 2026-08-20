/**
 * Redirect process home for tests that load @skillet/core before imports.
 * On Windows, os.homedir() reads USERPROFILE — HOME alone is ignored.
 */
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { randomBytes } = require('node:crypto')

function redirectHome(prefix) {
  const root = join(tmpdir(), `${prefix}-${randomBytes(4).toString('hex')}`)
  process.env.HOME = root
  process.env.SKILLET_DIR = join(root, '.skillet')
  if (process.platform === 'win32') {
    process.env.USERPROFILE = root
  }
  return root
}

module.exports = { redirectHome }
