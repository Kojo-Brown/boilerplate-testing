/**
 * A seventh Playwright config, and the first whose subject is the artefact
 * Playwright produces rather than anything it does to a page.
 *
 * `visual/` measures the image comparator, `matrix/` a project's `use` block,
 * `a11y/` what a scan can see, `intercept/` what a browser does with a route
 * handler. This one measures what ends up inside `trace.zip`, so almost
 * everything below is chosen to make the recording readable rather than to make
 * the suite pass — the suite does not pass. See `evidence.spec.ts`.
 *
 * ---------------------------------------------------------------------------
 * `trace: 'on'`, not `retain-on-failure`
 * ---------------------------------------------------------------------------
 * The repository's own `playwright.config.ts` uses `retain-on-failure`, and
 * `retention.ts` measures why that is the right default for a real suite. Here
 * the tests all fail, so the two modes would record the same thing — except for
 * one case. `missing-env` fails in the test body before any action, and a mode
 * that decides retention from the outcome still has to have been recording from
 * the start to have anything to keep. `'on'` removes that variable from the
 * measurement: every row of the evidence table is a trace that was recorded
 * unconditionally, so an empty channel is empty because nothing happened, not
 * because a mode declined to record it.
 *
 * ---------------------------------------------------------------------------
 * `retries: 0` and `workers: 1`
 * ---------------------------------------------------------------------------
 * `check.ts` reads one trace per case and matches it to that case by directory
 * name. A retry overwrites the trace of the attempt before it, so retries here
 * would silently measure the last attempt while the table claims to describe the
 * first. Serial for the same kind of reason: `hanging-api` leaves a request open
 * for the whole test, and parallel workers sharing one fixture server make the
 * network channel of every other case dependent on scheduling.
 *
 * `sources: true` is explicit rather than left to the default, because the
 * `source` column of the table is a claim about it: it is the only channel whose
 * contents are a config decision rather than a consequence of the run, and
 * `README.md` says so.
 *
 * ---------------------------------------------------------------------------
 * `TRACE_CHROMIUM_EXECUTABLE`
 * ---------------------------------------------------------------------------
 * CI runs `playwright install --with-deps chromium` and this variable is unset
 * there, so the pinned build is what every published cell was measured on. It
 * exists for the other case: a container whose egress policy does not reach
 * `cdn.playwright.dev`, where `playwright install` cannot run and a Chromium is
 * already on disk from somewhere else. Pointing this at that binary is how the
 * measurement is reproduced in such a place, and `check.ts` prints the override
 * in its report so that a table regenerated against an unpinned browser cannot
 * be mistaken for one regenerated against the pinned one.
 */

import { defineConfig } from '@playwright/test'

import { SUBJECT_PORT, SUBJECT_URL } from './server.ts'

const isCI = Boolean(process.env['CI'])

/** See the note above. Unset in CI. */
const CHROMIUM_EXECUTABLE = process.env['TRACE_CHROMIUM_EXECUTABLE']

export default defineConfig({
  testDir: '.',
  testMatch: ['evidence.spec.ts'],

  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,

  // `list`, not `github`: the GitHub reporter annotates failures on the pull
  // request diff, and nine intentional failures would annotate nine lines of a
  // fixture as broken code on every run.
  reporter: [['list']],

  outputDir: '../playwright-results/trace',

  use: {
    baseURL: SUBJECT_URL,
    trace: { mode: 'on', sources: true, screenshots: true, snapshots: true },
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
    cwd: '..',
    timeout: 30_000,
  },

  projects: [{ name: 'evidence' }],

  metadata: { subjectPort: SUBJECT_PORT },
})
