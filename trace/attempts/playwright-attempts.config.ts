/**
 * The same three tests, run once per `trace` mode.
 *
 * The mode arrives in `TRACE_RETENTION_MODE` rather than as six committed
 * configs, because six configs differing in one string is six places for the
 * table to drift from what was measured. `check.ts` is the only caller and it
 * iterates `RETENTION_MODES`, so a mode added to that list is measured without
 * touching this file.
 *
 * `retries: 1` is the whole reason this config exists separately from
 * `playwright-trace.config.ts`. Half of what the retention table says is about
 * which *attempt* kept a trace, and with no retries there is only one attempt
 * and three of the six modes are unreachable.
 *
 * `outputDir` is per mode, so that one mode's artefacts cannot be counted as
 * another's — Playwright cleans the output directory at the start of a run, but
 * `check.ts` reads each directory after its own run and a shared one would make
 * the reads order-dependent.
 */

import { defineConfig } from '@playwright/test'

import { SUBJECT_URL } from '../server.ts'
import { RETENTION_MODES, isRetentionMode } from '../retention.ts'

const isCI = Boolean(process.env['CI'])
const CHROMIUM_EXECUTABLE = process.env['TRACE_CHROMIUM_EXECUTABLE']

const requested = process.env['TRACE_RETENTION_MODE'] ?? 'on'

if (!isRetentionMode(requested)) {
  // Failing here rather than falling back: a typo that silently measured `'on'`
  // would fill a row of the published table with another row's answers.
  throw new Error(
    `TRACE_RETENTION_MODE must be one of ${RETENTION_MODES.join(', ')}; got ${requested}`,
  )
}

export default defineConfig({
  testDir: '.',
  testMatch: ['attempts.spec.ts'],

  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 1,

  reporter: [['list']],

  outputDir: `../../playwright-results/trace-retention/${requested}`,

  use: {
    baseURL: SUBJECT_URL,
    trace: requested,
    screenshot: 'off',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    ...(CHROMIUM_EXECUTABLE === undefined
      ? {}
      : { launchOptions: { executablePath: CHROMIUM_EXECUTABLE } }),
  },

  webServer: {
    command: 'node trace/server.ts',
    url: `${SUBJECT_URL}/`,
    reuseExistingServer: !isCI,
    cwd: '../..',
    timeout: 30_000,
  },

  projects: [{ name: 'attempts' }],
})
