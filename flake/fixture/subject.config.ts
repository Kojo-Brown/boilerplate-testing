/**
 * The Vitest config `../runs.ts` spawns, once per Vitest wiring.
 *
 * Retry count and reporters are left to the command line: they are the two
 * axes of the matrix, and a run whose wiring were half in this file and half in
 * `../wirings.ts` could not print the command it actually ran.
 *
 * `environment: 'node'` because the subject writes files, and `pool: 'forks'`
 * so each wiring's workers are real processes — the ledger's concurrency note
 * in `ledger.ts` is about that case rather than about threads.
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['subject.test.ts'],
    pool: 'forks',
    // No `setupFiles`: the root setup imports `@testing-library/jest-dom`,
    // which expects a DOM this subject does not have and does not need.
  },
})
