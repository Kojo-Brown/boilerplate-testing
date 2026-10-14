/**
 * The Playwright config `../runs.ts` spawns, once per Playwright wiring.
 *
 * `retries` and `reporter` come from the command line for the same reason they
 * do in the Vitest config next door. `workers: 1` is not a performance choice:
 * the matrix asks how many attempts an artifact records, and a run that
 * interleaved two cases' attempts across workers would make the ledger's own
 * ordering unreadable as evidence.
 */

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: ['subject.spec.ts'],
  workers: 1,
  // `forbidOnly` and `fullyParallel` deliberately unset: the subject has no
  // `.only` and one worker, so both would be decoration.
})
