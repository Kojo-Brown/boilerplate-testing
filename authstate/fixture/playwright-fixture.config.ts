/**
 * The config the isolation runs drive, and the only one in this repository that
 * is configured from the environment.
 *
 * That is not a style preference: the thing under measurement is a Playwright
 * *configuration*, so the strategy, the phase and the worker count have to be
 * inputs. `runs.test.ts` sets them, spawns `playwright test` against this file
 * once per cell, and reads the ledger back. Ten runs, five strategies, two
 * phases.
 *
 * It is registered with no collector in `shape/collect.ts` and its specs are in
 * `EXPECTED_EMPTY`, for the reason `matrix/fixture/` and `trace/attempts/` are:
 * these are subjects of a measurement rather than tests of anything, one of
 * them is red by design, and counting them would put five end-to-end
 * declarations into the pyramid ratio for files nobody wrote to catch a bug.
 *
 * No browser is launched — every context the fixture builds is an
 * `APIRequestContext` — so the isolation half rides `pnpm test` on every Node
 * major rather than needing a job with Chromium in it.
 */

import { defineConfig } from '@playwright/test'

import { strategyByKey } from '../strategies.ts'

const strategy = strategyByKey(process.env['AUTHSTATE_STRATEGY'] ?? 'shared-lazy')
const phase = process.env['AUTHSTATE_PHASE'] ?? 'parallel'

if (phase !== 'parallel' && phase !== 'restart') {
  throw new Error(`AUTHSTATE_PHASE must be "parallel" or "restart", got ${JSON.stringify(phase)}`)
}

/**
 * The two phases ask different questions and therefore need different runs.
 *
 * `parallel` needs two workers, because `session-eviction` and
 * `parallel-mutation` are both about what one worker does to another. It
 * disables retries: a failure there is a real one and a retry would file a
 * second set of rows into the same ledger.
 *
 * `restart` needs exactly one worker and exactly one retry, because the
 * question is what happens to `parallelIndex` 0 when the worker holding it
 * dies. More workers would make which slot restarted a matter of scheduling.
 */
const phases = {
  parallel: { testMatch: /specs\/(alpha|beta)\.spec\.ts$/, workers: 2, retries: 0 },
  restart: { testMatch: /specs\/restart\.spec\.ts$/, workers: 1, retries: 1 },
} as const

const settings = phases[phase]

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: false,
  workers: settings.workers,
  retries: settings.retries,

  // A JSON reporter written to a file rather than stdout, and never to the
  // repository root: `runs.test.ts` sets `AUTHSTATE_REPORT` to a path inside
  // its own scratch directory, and the fallback stays under the gitignored
  // results directory so a hand-run of this config leaves nothing behind.
  reporter: [
    [
      'json',
      {
        outputFile:
          process.env['AUTHSTATE_REPORT'] ?? '../../playwright-results/authstate-fixture/run.json',
      },
    ],
  ],
  outputDir: '../../playwright-results/authstate-fixture',

  // Generous, because these are the only timeouts in the directory and they
  // bound a barrier rather than a page: a worker parked on `/api/barrier`
  // waiting for a partner that died should be ended by the origin's own 504
  // (which names the barrier) rather than by a test timeout that names nothing.
  timeout: 60_000,

  projects: [
    ...(strategy.needsSetup
      ? [{ name: 'setup', testMatch: /shared\.setup\.ts$/ } as const]
      : []),
    {
      name: 'measure',
      testMatch: settings.testMatch,
      ...(strategy.needsSetup ? { dependencies: ['setup'] } : {}),
    },
  ],
})
