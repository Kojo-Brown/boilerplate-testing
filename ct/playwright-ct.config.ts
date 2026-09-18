/**
 * Playwright component testing — a second Playwright config, deliberately.
 *
 * `playwright.config.ts` at the repository root drives a *running application*
 * over HTTP: its `use.baseURL` points at one, and none of its specs can run
 * without it. This config drives *components*, which it bundles itself: there
 * is no application, no server of ours and no navigation. The two cannot be
 * one config — `@playwright/experimental-ct-react`'s `defineConfig` installs a
 * Vite dev server, a mount fixture and a registry of importable components,
 * and every end-to-end spec in `playwright/` would then be paying for them.
 *
 * Kept separate, each run is what it says it is: `pnpm test:e2e` is the
 * application suite and `pnpm test:ct` is the component suite. See
 * `ct/README.md` for which of the two a given behaviour belongs in, and
 * `shape/README.md` for how the census counts them.
 */

import { defineConfig, devices } from '@playwright/experimental-ct-react'

const isCI = Boolean(process.env['CI'])

export default defineConfig({
  // The specs live next to the components they mount. Paths in this file are
  // resolved against this directory, not the repository root.
  testDir: '.',

  // `*.spec.tsx` only. `*.jsdom.test.tsx` beside it is the same component
  // under Testing Library in jsdom, and belongs to `pnpm test`; Playwright's
  // default `testMatch` would claim both and run the jsdom half in a browser,
  // where its whole argument — that jsdom cannot answer this — is false.
  testMatch: '**/*.spec.tsx',

  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 2 } : {}),

  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: '../playwright-report/ct' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: '../playwright-report/ct' }]],

  // Under the same ignored directory the end-to-end run writes to, one level
  // down, so a failed component run's traces do not land in the repository
  // root and the two suites' artefacts stay apart.
  outputDir: '../playwright-results/ct',

  use: {
    // The mount hooks and the page the components are mounted into.
    ctTemplateDir: '.',

    // A port of its own so a `pnpm test:e2e` dev server on 5173 and this
    // bundler can be up at once — a component suite that cannot run while the
    // application is running is a component suite nobody runs.
    ctPort: 3100,

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },

  // Chromium only, and that is a scope decision rather than a limitation:
  // running the component suite across browsers and device emulations is its
  // own SPEC item (Phase 10, "Cross-browser + mobile-emulation matrix with
  // sharding"), which will add the projects here and the sharding in CI. What
  // these specs assert today — layout metrics, the top layer, the focus trap —
  // is specified behaviour that every engine implements, so a second engine
  // would mostly re-assert the specification.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
