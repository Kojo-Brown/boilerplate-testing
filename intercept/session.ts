/**
 * Opening a browser context with one wiring under one condition.
 *
 * Three specs need the same five steps in the same order, and the order is the
 * experiment rather than boilerplate — `fidelity.spec.ts` sets out why each
 * step is where it is. Getting it wrong is not a crash: a connection listener
 * installed after the wiring silently misses the only `offline` event there
 * is, and the cell reads `silent` for a wiring that did fire one.
 *
 * So it lives here, once, and the specs differ only in what they ask
 * afterwards.
 */

import type { Browser, BrowserContext, Page } from '@playwright/test'

import { CONNECTION_COUNTER, watchConnection } from './client.ts'
import { HAR_PATH } from './har.ts'
import { CONTROL_PATHS, ORIGIN_URL } from './origin.ts'
import { severNetwork, type Condition, type Wiring } from './wirings.ts'

/** A context with a wiring applied, plus what the test process saw of it. */
export interface Session {
  readonly context: BrowserContext
  readonly page: Page
  /** Every URL `page.on('request')` reported, in order. */
  readonly observed: readonly string[]
  readonly close: () => Promise<void>
}

/** Empty the origin's ledger and its flaky flag. */
export async function resetOrigin(): Promise<void> {
  const response = await fetch(`${ORIGIN_URL}${CONTROL_PATHS.reset}`, { method: 'POST' })

  if (!response.ok) {
    throw new Error(`the fixture origin refused a ledger reset with ${response.status}`)
  }
}

/** Read the origin's ledger, over a socket no route handler can touch. */
export async function readOriginLog(): Promise<readonly string[]> {
  const response = await fetch(`${ORIGIN_URL}${CONTROL_PATHS.log}`)
  const payload = (await response.json()) as { log: string[] }

  return payload.log
}

export async function openSession(
  browser: Browser,
  options: { wiring: Wiring; condition: Condition },
): Promise<Session> {
  await resetOrigin()

  const context = await browser.newContext()

  // Before any document exists: `setOffline(true)` fires `offline` the moment
  // it is called, and a listener added afterwards would miss it.
  await context.addInitScript(watchConnection, CONNECTION_COUNTER)

  const page = await context.newPage()
  const observed: string[] = []

  page.on('request', (request) => observed.push(request.url()))

  // The pristine load, before anything is intercepted. Every probe issues its
  // request from this document, and `fetch` from `about:blank` has a null
  // origin — a page that failed to load would make every cell a measurement of
  // CORS instead of routing.
  await page.goto('/')

  if (options.condition === 'severed') {
    await severNetwork(context)
  }

  // Last, so it is reached first: Playwright tries route handlers newest-first.
  await options.wiring.apply(context, { harPath: HAR_PATH })

  return {
    context,
    page,
    observed,
    close: () => context.close(),
  }
}
