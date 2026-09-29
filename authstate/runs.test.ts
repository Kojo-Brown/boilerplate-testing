// @vitest-environment node
//
// Node rather than the jsdom default, for the plain reason that this file
// starts a TCP server and spawns child processes: under jsdom `import.meta.url`
// is an `http:` URL and `fileURLToPath` refuses it.

/**
 * The isolation half: ten real `playwright test` runs, one origin, one table.
 *
 * Five strategies × two phases. Each run gets a fresh origin state, a fresh
 * directory for its `.auth/` files, and its own environment; the fixture suite
 * files a row per test and this file reads the ledger back and derives the
 * strategy's row of `isolation.ts`.
 *
 * Why real runs rather than a model of Playwright's scheduler: the two facts
 * this half turns on are both the runner's. That a failed test discards its
 * worker, and that the replacement keeps the `parallelIndex` while taking a new
 * `workerIndex`, are behaviours of a released version of a tool — not of a
 * specification, and not of anything this repository could reimplement without
 * reimplementing the thing under measurement. `matrix/partition.test.ts` made
 * the same call about sharding for the same reason.
 *
 * No browser is launched: the fixture builds `APIRequestContext`s, which carry
 * cookies and take `storageState` exactly as a browser context does. So this
 * whole half rides `pnpm test` on every Node major, and only the capture half
 * needs a job with Chromium in it.
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { deriveRow, type LedgerRow, type RunResult } from './derive.ts'
import { EXPECTED_ISOLATION, HAZARDS } from './isolation.ts'
import { startOrigin, type RunningOrigin } from './server.ts'
import { STRATEGIES } from './strategies.ts'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONFIG = 'authstate/fixture/playwright-fixture.config.ts'
const PLAYWRIGHT = join(REPO_ROOT, 'node_modules/@playwright/test/cli.js')

/**
 * Asynchronous, and that is not a style choice.
 *
 * The origin runs in *this* process, and `execFileSync` blocks the event loop
 * for as long as the child runs — so every request the fixture suite makes
 * would sit unanswered in the listen queue until the child it is waiting for
 * had exited. The first version of this file was synchronous and the symptom
 * was a worker timing out while setting up its session against a server that
 * was, technically, listening.
 */
const run = promisify(execFile)

let origin: RunningOrigin
let scratch = ''

beforeAll(async () => {
  origin = await startOrigin(0)
  scratch = mkdtempSync(join(tmpdir(), 'authstate-runs-'))
}, 30_000)

afterAll(async () => {
  await origin?.close()
  rmSync(scratch, { recursive: true, force: true })
})

/**
 * Run the fixture suite once and read back what it filed.
 *
 * `process.execPath` rather than `pnpm exec`, for the reason `shape/collect.ts`
 * gives: it inherits the exact Node running this test, which matters on a
 * version matrix, and it depends on nothing being on `PATH`.
 *
 * A non-zero exit is not automatically a failure. The restart phase *ends*
 * green — the deliberate failure passes on its retry — but the parallel phase
 * of a strategy whose session gets evicted can still end green too, because the
 * fixture files a 401 rather than throwing on one. So the exit code is checked
 * against what the phase is supposed to do, and the ledger is what decides the
 * cells.
 */
async function runPhase(strategy: string, phase: 'parallel' | 'restart'): Promise<RunResult> {
  const authDir = join(scratch, `${strategy}-${phase}`)

  origin.state.accounts.clear()
  origin.state.sessions.clear()
  origin.state.barriers.clear()
  origin.state.ledger.length = 0
  origin.state.logins = 0
  origin.state.counter = 0

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AUTHSTATE_ORIGIN: `http://127.0.0.1:${origin.port}`,
    AUTHSTATE_STRATEGY: strategy,
    AUTHSTATE_PHASE: phase,
    AUTHSTATE_AUTH_DIR: authDir,
    AUTHSTATE_PARTIES: phase === 'parallel' ? '2' : '0',
    AUTHSTATE_REPORT: join(authDir, 'report.json'),
    // Playwright reads `CI` to decide `forbidOnly` and its reporter defaults.
    // The config sets both explicitly; clearing it keeps a local run and a CI
    // run spawning the identical child.
    CI: '',
  }

  try {
    await run(process.execPath, [PLAYWRIGHT, 'test', '--config', CONFIG], { cwd: REPO_ROOT, env })
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string }

    // A run is allowed to end red — the fixture files a 401 rather than
    // throwing on one, but a strategy can still fail a test for its own
    // reasons. What is never allowed is a run that produced nothing, and this
    // message is what a reader gets when the fixture suite itself is broken
    // rather than the strategy being measured.
    if (origin.state.ledger.length === 0) {
      throw new Error(
        `The ${strategy} / ${phase} run filed no rows at all.\n${stdout}\n${stderr}`.trim(),
        { cause: error },
      )
    }
  }

  return {
    rows: [...origin.state.ledger] as unknown as LedgerRow[],
    logins: origin.state.logins,
  }
}

describe('the isolation table, re-derived from ten real Playwright runs', () => {
  for (const strategy of STRATEGIES) {
    describe(strategy.key, () => {
      let measured: ReturnType<typeof deriveRow>

      beforeAll(async () => {
        measured = deriveRow(
          await runPhase(strategy.key, 'parallel'),
          await runPhase(strategy.key, 'restart'),
        )
      }, 180_000)

      for (const hazard of HAZARDS) {
        it(`answers ${hazard} the way isolation.ts declares`, () => {
          expect(measured[hazard]).toBe(EXPECTED_ISOLATION[strategy.key]?.[hazard])
        })
      }

      it('signs in as many times as isolation.ts declares', () => {
        expect(measured.logins).toBe(EXPECTED_ISOLATION[strategy.key]?.logins)
      })

      it('uses as many accounts as isolation.ts declares', () => {
        expect(measured.accounts).toBe(EXPECTED_ISOLATION[strategy.key]?.accounts)
      })
    })
  }
})
