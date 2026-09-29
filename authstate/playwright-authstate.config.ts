/**
 * The sixth Playwright config, for the capture half.
 *
 * Like `intercept/`, this one drives a browser against an origin it starts —
 * `authstate/server.ts`, bound by the `webServer` below — because what is under
 * measurement lives between the two: what a browser hands back when a context
 * is serialised, and what a different browser context does with it afterwards.
 *
 * Three settings are load-bearing rather than taste:
 *
 * **`workers: 1`, `fullyParallel: false`.** The origin keeps one account map
 * and each test resets it before signing in. Two workers would interleave those
 * resets and each would sign into the other's cleared state — and this origin
 * evicts a session on a second login *by design*, so a parallel run would not
 * merely be racy, it would be measuring eviction in a table about capture.
 *
 * **`retries: 0`, on CI too.** There is no timing in these specs: no sleep, no
 * polling, no wall clock, and every wait is an assertion on a `data-` attribute
 * the page sets once. A failure here is a difference from `capture.ts`, and
 * re-running it twice to see whether it goes away is how a measurement becomes
 * a mood.
 *
 * **Chromium only.** Every cell in the capture table is decided by Playwright's
 * serialisation of a context rather than by an engine's storage implementation,
 * with one arguable exception — IndexedDB — and that one is decided by an
 * option on a Playwright call, not by the engine. The cross-browser matrix is
 * its own directory; re-deriving this table three times would cost three
 * browsers to restate one library's behaviour. `README.md` says so rather than
 * implying the table is universal.
 */

import { defineConfig, devices } from '@playwright/test'

import { ORIGIN_PORT, ORIGIN_URL } from './origin.ts'

const isCI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: '.',
  // This directory's own specs, and deliberately not `**/*.spec.ts`:
  // `fixture/specs/` holds three more, they are the subject of the isolation
  // measurement rather than tests, and one of them fails on its first attempt
  // on purpose. A recursive glob picks them up, so `pnpm test:authstate` would
  // run a suite that is red by design — and the shape census would collect
  // them here while `EXPECTED_EMPTY` still claimed no runner does, which is the
  // stale-exception failure that audit exists for. Both were true of the first
  // version of this file, and the census is what said so.
  testMatch: '*.spec.ts',
  testIgnore: '**/fixture/**',

  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,

  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: '../playwright-report/authstate' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: '../playwright-report/authstate' }]],

  outputDir: '../playwright-results/authstate',

  use: {
    baseURL: ORIGIN_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  webServer: {
    command: 'node authstate/server.ts',
    url: `${ORIGIN_URL}/app/server`,
    reuseExistingServer: !isCI,
    cwd: '..',
    timeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  metadata: { originPort: ORIGIN_PORT },
})
