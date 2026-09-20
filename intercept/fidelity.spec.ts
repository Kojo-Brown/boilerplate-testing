/**
 * The measurement itself: every cell of `matrix.ts`, against Chromium.
 *
 * One test per wiring per condition — sixteen — each asserting all twelve of
 * that row's cells at once. The grouping is deliberate: a row is measured in a
 * single browser context, because several of the probes are only meaningful
 * *relative to each other*. `reaches-origin` is a statement about the request
 * `known-get` just made; `offline-event` is a statement about the moment the
 * wiring was applied. Splitting them into 192 tests would mean 192 contexts
 * and would make each cell a measurement of a different browser session.
 *
 * ---------------------------------------------------------------------------
 * The order of operations, which is the whole experiment
 * ---------------------------------------------------------------------------
 * `session.ts` performs the first four steps and says why each is where it is:
 * reset the ledger, install the connection listener before any document exists,
 * load the page with nothing intercepted, then sever and apply. What is left
 * here is the fifth — asking — and one ordering constraint of its own: the
 * connection counters are read *before* the `document` probe navigates, because
 * the init script runs again on the new document and the counters start over.
 */

import { expect, test, type Page } from '@playwright/test'

import { probeFetch, probeFetchWithRetry, readConnection, CONNECTION_COUNTER } from './client.ts'
import { MATRIX, type Row } from './matrix.ts'
import { REACHES_ORIGIN, RECORDED_WORD, SENT_WORD } from './probes.ts'
import {
  classifyDrift,
  classifyEcho,
  classifyFetch,
  classifyReach,
  classifyRetry,
} from './outcomes.ts'
import { openSession, readOriginLog } from './session.ts'
import { CONDITIONS, WIRINGS, type Condition, type Wiring } from './wirings.ts'

/** The cache-buster the `query-variance` probe appends.
 *
 * A constant rather than a counter or a timestamp: the question is whether a
 * replayer matches a URL that differs from the recorded one, and any one such
 * URL answers it. A moving value would add the only piece of nondeterminism in
 * the directory for nothing.
 */
const QUERY_BUSTER = '?cb=7'

/**
 * Navigate, and report whether the document arrived.
 *
 * A navigation aborted before it commits rejects rather than returning a
 * response, so both shapes of failure have to be caught. `failed` covers them
 * and the non-2xx case together, for the reason `outcomes.ts` gives: no wiring
 * here produces a 4xx document, so a word distinguishing them would name a
 * cell that cannot exist.
 */
async function navigates(page: Page): Promise<'origin' | 'failed'> {
  try {
    const response = await page.goto('/')

    return response !== null && response.ok() ? 'origin' : 'failed'
  } catch {
    return 'failed'
  }
}

/** Measure one row: one wiring, one condition, twelve probes. */
async function measure(
  browser: Parameters<typeof openSession>[0],
  wiring: Wiring,
  condition: Condition,
): Promise<Row> {
  const session = await openSession(browser, { wiring, condition })

  try {
    const { page } = session

    const known = await page.evaluate(probeFetch, {
      url: REACHES_ORIGIN,
      method: 'GET',
      body: null,
    })
    const drifted = await page.evaluate(probeFetch, { url: '/api/feed', method: 'GET', body: null })
    const unrecorded = await page.evaluate(probeFetch, {
      url: '/api/notifications',
      method: 'GET',
      body: null,
    })
    const varied = await page.evaluate(probeFetch, {
      url: `${REACHES_ORIGIN}${QUERY_BUSTER}`,
      method: 'GET',
      body: null,
    })
    const echoed = await page.evaluate(probeFetch, {
      url: '/api/echo',
      method: 'POST',
      body: JSON.stringify({ word: SENT_WORD }),
    })
    const retried = await page.evaluate(probeFetchWithRetry, { url: '/api/flaky' })
    const stylesheet = await page.evaluate(probeFetch, {
      url: '/assets/app.css',
      method: 'GET',
      body: null,
    })

    const connection = await page.evaluate(readConnection, CONNECTION_COUNTER)
    const log = await readOriginLog()

    return {
      'known-get': classifyFetch(known),
      'reaches-origin': classifyReach(log, REACHES_ORIGIN),
      'drifted-get': classifyDrift(drifted),
      'unrecorded-get': classifyFetch(unrecorded),
      'query-variance': classifyFetch(varied),
      'post-echo': classifyEcho(echoed, { sent: SENT_WORD, recorded: RECORDED_WORD }),
      'retry-recovers': classifyRetry(retried),
      'static-asset': classifyFetch(stylesheet),
      'online-flag': connection.onLine ? 'online' : 'offline',
      'offline-event': connection.offlineEvents > 0 ? 'fired' : 'silent',
      'observed-by-test': session.observed.some((url) => url.endsWith(REACHES_ORIGIN))
        ? 'observed'
        : 'unobserved',
      document: await navigates(page),
    }
  } finally {
    await session.close()
  }
}

for (const wiring of WIRINGS) {
  for (const condition of CONDITIONS) {
    test(`answers every probe as the matrix records for ${wiring.name} under ${condition}`, async ({
      browser,
    }) => {
      const measured = await measure(browser, wiring, condition)

      // One assertion over the whole row rather than twelve, so a failure
      // prints the row it measured next to the row that was expected. A cell
      // at a time would report the first difference and hide the shape of it.
      expect(measured).toEqual(MATRIX[wiring.name][condition])
    })
  }
}
