/**
 * The fixture suite's auth fixture — all five strategies, one code path.
 *
 * This is the subject of the isolation measurement rather than a test of
 * anything, and it is written the way the recipes it implements are written:
 * a worker-scoped fixture, an `existsSync` check deciding between signing in
 * and restoring, and a saved `storageState` file per slot. The only thing it
 * adds is that the slot identifier comes from `strategies.ts` instead of being
 * hardcoded to `parallelIndex`, so the five rows differ by data rather than by
 * five copies of the same fixture.
 *
 * No browser is launched. Every context here is an `APIRequestContext`, which
 * carries cookies and accepts `storageState` exactly as a browser context does
 * — so what is measured is genuinely storage-state reuse, and the whole
 * isolation half rides `pnpm test` on every Node major instead of needing a
 * browser job.
 */

import {
  test as base,
  type APIRequest,
  type APIRequestContext,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { FIXTURE_PASSWORD } from '../origin.ts'
import { accountFor, strategyByKey, testIdFrom, type Strategy } from '../strategies.ts'

/** Read a required environment variable, failing with the name rather than `undefined`. */
function required(name: string): string {
  const value = process.env[name]

  if (value === undefined || value === '') {
    throw new Error(`${name} must be set: the fixture run is driven by authstate/runs.test.ts`)
  }

  return value
}

export const ORIGIN = (): string => required('AUTHSTATE_ORIGIN')
export const strategyKey = (): string => required('AUTHSTATE_STRATEGY')
export const STRATEGY = (): Strategy => strategyByKey(strategyKey())
export const AUTH_DIR = (): string => required('AUTHSTATE_AUTH_DIR')

/** How many workers meet at each barrier; 0 means "do not use barriers". */
export const PARTIES = (): number => Number(process.env['AUTHSTATE_PARTIES'] ?? '0')

/** A signed-in session: the account it belongs to and a context that carries it. */
export interface Session {
  readonly email: string
  readonly slot: string
  readonly context: APIRequestContext
  /** Whether this worker signed in, or restored a file somebody else wrote. */
  readonly acquired: 'signed-in' | 'restored'
}

/**
 * The `playwright` fixture's own type, named rather than written out.
 *
 * `typeof import('playwright-core')` is what it resolves to and is not a thing
 * to depend on; `PlaywrightWorkerArgs['playwright']` is the same type read off
 * the public fixture table, so it follows the version rather than a path into
 * a transitive package.
 */
type Playwright = PlaywrightWorkerArgs['playwright']

/** Sign in as `email` and save the resulting state to `file`. */
export async function signInAndSave(
  request: APIRequest,
  origin: string,
  email: string,
  file: string,
): Promise<APIRequestContext> {
  const context = await request.newContext({ baseURL: origin })
  const response = await context.post('/api/login', {
    data: { email, password: FIXTURE_PASSWORD },
  })

  if (response.status() !== 200) {
    throw new Error(`Signing in as ${email} answered ${response.status()}`)
  }

  mkdirSync(AUTH_DIR(), { recursive: true })
  await context.storageState({ path: file })

  return context
}

/** The file a slot's storage state lives in. */
export const stateFile = (slot: string): string => join(AUTH_DIR(), `${slot}.json`)

/**
 * Build the session one worker (or one test) uses.
 *
 * The `existsSync` branch is the documented recipe verbatim, and it is where
 * `restart-inheritance` comes from: a replacement worker at the same
 * `parallelIndex` finds the dead worker's file and restores it, so it does not
 * sign in, does not get a new account, and inherits whatever that account's
 * server-side state had become.
 */
export async function buildSession(
  playwright: Playwright,
  strategy: Strategy,
  identity: { workerIndex: number; parallelIndex: number; testId: string },
): Promise<Session> {
  const origin = ORIGIN()
  const { email, slot } = accountFor(strategy, identity)
  const file = stateFile(slot)

  if (strategy.acquisition === 'restore-only') {
    if (!existsSync(file)) {
      throw new Error(
        `${strategy.key} expects ${file} to have been written by the setup project, and it ` +
          'was not. Either the project dependency is missing or the setup failed.',
      )
    }

    return {
      email,
      slot,
      acquired: 'restored',
      context: await playwright.request.newContext({ baseURL: origin, storageState: file }),
    }
  }

  if (strategy.acquisition === 'save-and-restore' && existsSync(file)) {
    return {
      email,
      slot,
      acquired: 'restored',
      context: await playwright.request.newContext({ baseURL: origin, storageState: file }),
    }
  }

  return {
    email,
    slot,
    acquired: 'signed-in',
    context: await signInAndSave(playwright.request, origin, email, file),
  }
}

interface WorkerFixtures {
  /** The worker's session, or `null` for the strategy that has none. */
  workerSession: Session | null
}

interface TestFixtures {
  session: Session
}

/**
 * `per-test` is the one strategy with nothing worker-scoped about it, so the
 * worker fixture resolves to `null` and the test fixture signs in instead. A
 * worker fixture that quietly signed in per test would still be called a worker
 * fixture by anyone reading the run, and the cost column is one of the things
 * this table is for.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerSession: [
    async ({ playwright }, use, workerInfo) => {
      const strategy = STRATEGY()

      if (strategy.scope === 'test') {
        await use(null)

        return
      }

      const session = await buildSession(playwright, strategy, {
        workerIndex: workerInfo.workerIndex,
        parallelIndex: workerInfo.parallelIndex,
        testId: 'worker',
      })

      await use(session)
      await session.context.dispose()
    },
    { scope: 'worker' },
  ],

  session: async ({ playwright, workerSession }, use, testInfo) => {
    if (workerSession !== null) {
      await use(workerSession)

      return
    }

    const session = await buildSession(playwright, STRATEGY(), {
      workerIndex: testInfo.workerIndex,
      parallelIndex: testInfo.parallelIndex,
      testId: testIdFrom(testInfo.titlePath),
    })

    await use(session)
    await session.context.dispose()
  },
})

export { expect } from '@playwright/test'
