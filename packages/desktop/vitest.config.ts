import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    // .agents is a gitignored local synced-skills dir (runtime adapters install
    // skill bundles there); their template tests must never run as ours.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.agents/**'],
  },
})
