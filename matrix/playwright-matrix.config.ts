/**
 * A fourth Playwright config, and the first one whose *projects* are the
 * subject rather than the vehicle.
 *
 * `playwright.config.ts` drives an application this repository does not ship.
 * `ct/` bundles components. `intercept/` measures what a browser does with a
 * route handler. This one measures what a project's `use` block does to a
 * page — so the three projects below are the three conditions of
 * `conditions.ts`, one each, and every one of them is Chromium.
 *
 * That last part is deliberate and is the config's only real decision. A
 * matrix that changed engine *and* emulation at once would make every moved
 * cell ambiguous: `Desktop Safari` against `iPhone 13` differs by WebKit
 * versus WebKit-with-a-phone, and there would be no way to say which half
 * moved `hover-capable`. Holding the engine still is what makes the table in
 * `emulation.ts` mean something.
 *
 * `retries: 0`, on CI too, for the reason `intercept/playwright-intercept.config.ts`
 * gives: there is no wall clock, no animation and no network in any of these
 * assertions, so a failure is a difference from the table and re-running it is
 * how a measurement becomes a mood.
 */

import { defineConfig } from '@playwright/test'

import { CONDITIONS } from './conditions.ts'
import { PAGE_PORT, PAGE_URL } from './page.ts'

const isCI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: '.',
  // Named rather than globbed: `fixture/specs/` is full of `*.spec.ts` files
  // that belong to the sharding measurement and must not be run here.
  testMatch: ['emulation.spec.ts'],

  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,

  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: '../playwright-report/matrix' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: '../playwright-report/matrix' }]],

  outputDir: '../playwright-results/matrix',

  use: {
    baseURL: PAGE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  webServer: {
    command: 'node matrix/server.ts',
    url: `${PAGE_URL}/`,
    reuseExistingServer: !isCI,
    cwd: '..',
    timeout: 30_000,
  },

  projects: CONDITIONS.map((condition) => ({
    name: condition.name,
    use: condition.use,
  })),

  metadata: { pagePort: PAGE_PORT },
})
