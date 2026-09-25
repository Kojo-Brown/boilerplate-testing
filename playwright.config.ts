import { defineConfig, devices } from '@playwright/test'

const isCI = Boolean(process.env['CI'])
const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './playwright',
  // Exclude setup scripts from the default test run; run them via --project=setup.
  testIgnore: ['**/setup/**'],
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Spread rather than `workers: undefined`: under exactOptionalPropertyTypes
  // an explicit `undefined` is not assignable to `workers?: string | number`.
  // Omitting the key entirely is what "let Playwright decide" actually means.
  ...(isCI ? { workers: 2 } : {}),
  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  // Screenshot-comparison defaults deliberately left unset. Playwright's own
  // are `threshold: 0.2` and no `maxDiffPixels`, and `visual/` measures what
  // that combination does: it reports a whole region repainted a neighbouring
  // shade as identical, while failing on the anti-aliasing of a 0.4px text
  // shift. A config that restated them here would be shipping that pairing as
  // this repository's advice. See visual/README.md.

  outputDir: 'playwright-results',

  projects: [
    // -----------------------------------------------------------------------
    // Auth setup — writes .auth/admin.json and .auth/user.json.
    // Run once before authenticated test suites:
    //   pnpm test:e2e --project=setup
    // -----------------------------------------------------------------------
    {
      name: 'setup',
      testMatch: ['**/setup/*.setup.ts'],
    },

    // -----------------------------------------------------------------------
    // Browser projects — standard cross-browser matrix.
    // Tests tagged @flaky in their title are excluded from the main run;
    // they land in the quarantine project below instead.
    // Add `dependencies: ['setup']` to make auth setup run automatically.
    // -----------------------------------------------------------------------
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@flaky/,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      grepInvert: /@flaky/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grepInvert: /@flaky/,
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      grepInvert: /@flaky/,
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
      grepInvert: /@flaky/,
    },

    // -----------------------------------------------------------------------
    // Quarantine project — runs ONLY tests tagged @flaky in their title.
    //
    // Tagging convention:
    //   test('loads user list @flaky', async ({ page }) => { ... })
    //
    // Run in CI via a separate non-blocking job:
    //   pnpm test:e2e --project=quarantine
    //
    // This project uses higher retries and longer timeouts.  Failures do
    // NOT block the main CI pass — they are reported as warnings and
    // uploaded as artifacts for trend tracking.
    //
    // Un-quarantine a test by removing @flaky from its title once it has
    // passed consistently across N quarantine runs.
    // -----------------------------------------------------------------------
    {
      name: 'quarantine',
      grep: /@flaky/,
      retries: 5,
      use: {
        ...devices['Desktop Chrome'],
        actionTimeout: 20_000,
        navigationTimeout: 60_000,
        // Always capture trace + video so flakiness can be diagnosed.
        trace: 'on',
        video: 'on',
      },
    },

  ],
})
