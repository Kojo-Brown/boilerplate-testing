/**
 * The Vitest config for the registry-driven half of the subject.
 *
 * Identical to `subject.config.ts` but for the file it includes and the alias,
 * which this one needs: `quarantined.test.ts` imports `@/vitest/flaky`, the
 * helper under measurement, and resolving `@` is how it finds it.
 *
 * The alias is absolute. A bare `'.'` is not resolved relative to this file,
 * which is the mistake `vitest/quarantine.config.ts` shipped — see
 * `../README.md`.
 */

import { join } from 'node:path'

import { defineConfig } from 'vitest/config'

const repoRoot = join(import.meta.dirname, '..', '..')

export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['quarantined.test.ts'],
    pool: 'forks',
  },
  resolve: {
    alias: { '@': repoRoot },
  },
})
