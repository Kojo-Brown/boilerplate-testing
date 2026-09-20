/**
 * A third Playwright config, for the third thing Playwright can be pointed at.
 *
 * `playwright.config.ts` drives an application this repository does not ship.
 * `ct/playwright-ct.config.ts` drives components it bundles itself. This one
 * drives a browser against an origin *it starts* — seven routes of Node in
 * `origin.ts`, bound by `server.ts` — because what these specs measure is what
 * happens between the two, and neither of the other configs has a between.
 *
 * Two settings here are load-bearing rather than taste:
 *
 * **`workers: 1`, `fullyParallel: false`.** The origin keeps one ledger and one
 * flaky-endpoint flag, and every cell resets them before it measures. Two
 * workers would interleave those resets and each would read the other's
 * requests — the `reaches-origin` probe would become a race rather than a
 * measurement. A ledger per worker was the alternative and is worse: it needs
 * the browser to carry a worker id in a header, which changes the requests
 * being recorded and replayed, which is the thing under measurement.
 *
 * **`retries: 0`, on CI too.** Every other Playwright config here retries twice
 * because a flake in a browser test is usually a timing accident. These specs
 * have no timing in them: no wall clock, no sleep, no animation, no polling
 * against a moving target. A failure is a difference from `matrix.ts`, and
 * re-running it twice to see whether it goes away is precisely the habit that
 * turns a measurement into a mood.
 */

import { defineConfig, devices } from '@playwright/test'

import { ORIGIN_PORT, ORIGIN_URL } from './origin.ts'

const isCI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',

  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,

  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: '../playwright-report/intercept' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: '../playwright-report/intercept' }]],

  outputDir: '../playwright-results/intercept',

  use: {
    baseURL: ORIGIN_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  // The origin, started as a child process and waited for. `cwd` is the
  // repository root rather than this directory so the command reads the way it
  // would be typed by hand.
  webServer: {
    command: 'node intercept/server.ts',
    url: `${ORIGIN_URL}/`,
    reuseExistingServer: !isCI,
    cwd: '..',
    timeout: 30_000,
  },

  // Chromium only. Every behaviour measured here is Playwright's — routing,
  // HAR matching, offline emulation — rather than an engine's, and the one
  // engine-decided cell (`navigator.onLine`) is specified. A second browser
  // would re-derive the same table at twice the cost; the cross-browser matrix
  // is its own SPEC item.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // A port that must be free, and is the one baked into the recording. Stated
  // here so a reader looking for it finds it next to the `webServer` that
  // binds it rather than only in `origin.ts`.
  metadata: { originPort: ORIGIN_PORT },
})
