/**
 * A fifth Playwright config, and the first one whose subject is a *sequence*.
 *
 * `playwright.config.ts` drives an application this repository does not ship.
 * `ct/` bundles components. `intercept/` measures what a browser does with a
 * route handler. `matrix/` measures what a project's `use` block does to a
 * page. This one measures what a scan can see, which depends entirely on when
 * it is run — so there is one project, and the variation lives in the journey
 * rather than in the configuration.
 *
 * Chromium only, and that is the one decision here worth arguing with. The
 * verdicts in `hazards.ts` are axe-core's, and axe-core is a script that runs
 * in the page: what decides whether `color-contrast` resolves is whether there
 * is a layout and a computed colour, not which engine computed it. A second
 * engine would re-run the same rules against the same DOM and add no rows —
 * whereas the one environment difference that *does* move verdicts, jsdom
 * versus a browser, is measured in `environment.test.ts` under `pnpm test`,
 * where it costs nothing.
 *
 * `retries: 0`, on CI too, for the reason `matrix/` gives: every assertion here
 * is a difference from a published table, there is no wall clock and no network
 * in any of them, and re-running a measurement is how it becomes a mood. The
 * fixture's one piece of asynchrony is gated on an explicit call rather than a
 * timer precisely so that this line can be honest — see `RELEASE_ORDERS` in
 * `page.ts`.
 */

import { defineConfig } from '@playwright/test'

import { PAGE_PORT, PAGE_URL } from './page.ts'

const isCI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: '.',
  testMatch: ['journey.spec.ts'],

  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,

  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: '../playwright-report/a11y' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: '../playwright-report/a11y' }]],

  outputDir: '../playwright-results/a11y',

  use: {
    baseURL: PAGE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  webServer: {
    command: 'node a11y/server.ts',
    url: `${PAGE_URL}/`,
    reuseExistingServer: !isCI,
    cwd: '..',
    timeout: 30_000,
  },

  projects: [{ name: 'a11y-journey' }],

  metadata: { pagePort: PAGE_PORT },
})
