/**
 * A sixth Playwright config, and the first one whose subject is Playwright's
 * own image comparator.
 *
 * `playwright.config.ts` drives an application this repository does not ship.
 * `ct/` bundles components. `intercept/` measures what a browser does with a
 * route handler. `matrix/` measures what a project's `use` block does to a
 * page. `a11y/` measures what a scan can see. This one measures what survives
 * a screenshot and a comparison, which is two questions rather than one — see
 * `capture.ts`.
 *
 * ---------------------------------------------------------------------------
 * Baselines are generated, never committed
 * ---------------------------------------------------------------------------
 * `snapshotPathTemplate` points into `playwright-results/`, which is
 * `.gitignore`d, and every baseline this suite compares against is captured by
 * the same browser in the same run a few milliseconds earlier. That is not a
 * shortcut around committing PNGs — it is the only honest arrangement for a
 * suite whose claims must hold on somebody else's machine. A committed
 * baseline is a photograph of one Chromium build's font hinting on one
 * operating system, and a repository of copyable patterns that shipped one
 * would be shipping a suite that is red on arrival for most readers.
 *
 * The cost is real and stated rather than hidden: nothing here checks that a
 * baseline *stored between runs* still matches, which is the thing a real
 * visual suite exists to do. That half is measured without a browser, against
 * real baselines on a real disk, in `lifecycle.test.ts` — see
 * visual/README.md, "What is not measured here".
 *
 * ---------------------------------------------------------------------------
 * The pinned viewport, and `deviceScaleFactor: 1`
 * ---------------------------------------------------------------------------
 * `changes.ts` bands every change as moving more or fewer than a fixed number
 * of pixels, so the number of pixels a thing occupies has to be a constant.
 * A device scale factor of 2 would multiply every area by four and every band
 * with it; it is set explicitly rather than left to the default so that the
 * bands are readable as pixel counts of the fixture's declared CSS sizes.
 *
 * `retries: 0`, on CI too, for the reason `matrix/` and `a11y/` give: every
 * assertion here is a difference from a published table, the fixture has no
 * network, no timer, no randomness and no unpaused animation, and re-running a
 * measurement is how it becomes a mood.
 */

import { defineConfig } from '@playwright/test'

import { SUBJECT_PORT, SUBJECT_URL } from './server.ts'
import { VIEWPORT } from './subject.ts'

const isCI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: '.',
  testMatch: ['matrix.spec.ts', 'calibration.spec.ts'],

  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,

  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: '../playwright-report/visual' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: '../playwright-report/visual' }]],

  outputDir: '../playwright-results/visual',
  snapshotPathTemplate: '{testDir}/../playwright-results/visual/baselines/{arg}{ext}',

  use: {
    baseURL: SUBJECT_URL,
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    // A failing cell is a question about two images, and the report already
    // carries them: `toMatchSnapshot` writes `-expected`, `-actual` and
    // `-diff` into `outputDir` for every comparison that failed.
    screenshot: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  webServer: {
    command: 'node visual/server.ts',
    url: `${SUBJECT_URL}/`,
    reuseExistingServer: !isCI,
    cwd: '..',
    timeout: 30_000,
  },

  projects: [{ name: 'visual-comparator' }],

  metadata: { subjectPort: SUBJECT_PORT },
})
