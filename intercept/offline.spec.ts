/**
 * The two things people mean by "offline", told apart.
 *
 * The matrix records that `abort-api` and `offline` differ on exactly two
 * probes with no network behind them. This file is the part of that difference
 * a row of words cannot carry: how many events fired and in which direction,
 * what the failure actually said, and what an offline-capable application can
 * still be driven through.
 *
 * Every assertion here is about Chromium's emulation rather than about a URL,
 * which is why none of it belongs in the table: a matrix cell is a per-request
 * answer, and these are statements about the connection.
 */

import { expect, test } from '@playwright/test'

import {
  CONNECTION_COUNTER,
  probeFetch,
  readAppColour,
  readConnection,
} from './client.ts'
import { classifyStylesheet, STYLED_COLOUR } from './outcomes.ts'
import { REACHES_ORIGIN } from './probes.ts'
import { openSession } from './session.ts'
import { wiringByName } from './wirings.ts'

/** A wiring by name, or a failure that names it rather than a type error. */
const wiring = (name: string) => {
  const found = wiringByName(name)

  if (found === undefined) {
    throw new Error(`no wiring named ${name}`)
  }

  return found
}

test('flips navigator.onLine and fires exactly one offline event', async ({ browser }) => {
  const session = await openSession(browser, { wiring: wiring('offline'), condition: 'connected' })

  try {
    const state = await session.page.evaluate(readConnection, CONNECTION_COUNTER)

    expect(state.onLine).toBe(false)
    // Exactly one: an emulation that fired on every request, or fired again on
    // each failure, would make a listener that queues work for later queue it
    // several times over.
    expect(state.offlineEvents).toBe(1)
    expect(state.onlineEvents).toBe(0)
  } finally {
    await session.close()
  }
})

test('fires an online event and restores the flag when the connection comes back', async ({
  browser,
}) => {
  const session = await openSession(browser, { wiring: wiring('offline'), condition: 'connected' })

  try {
    await session.context.setOffline(false)

    const state = await session.page.evaluate(readConnection, CONNECTION_COUNTER)

    expect(state.onLine).toBe(true)
    expect(state.offlineEvents).toBe(1)
    expect(state.onlineEvents).toBe(1)
  } finally {
    await session.close()
  }
})

test('leaves the page believing it is connected when requests are merely aborted', async ({
  browser,
}) => {
  const session = await openSession(browser, {
    wiring: wiring('abort-api'),
    condition: 'connected',
  })

  try {
    const failure = await session.page.evaluate(probeFetch, {
      url: REACHES_ORIGIN,
      method: 'GET',
      body: null,
    })
    const state = await session.page.evaluate(readConnection, CONNECTION_COUNTER)

    // The request failed and nothing told the page anything. An application
    // that shows an offline banner on `window.offline` shows nothing here, and
    // a suite built on this wiring has never seen that banner.
    expect(failure.failed).toBe(true)
    expect(state.onLine).toBe(true)
    expect(state.offlineEvents).toBe(0)
  } finally {
    await session.close()
  }
})

test('reports a failed fetch to the page without saying which emulation caused it', async ({
  browser,
}) => {
  const aborted = await openSession(browser, {
    wiring: wiring('abort-api'),
    condition: 'connected',
  })
  const disconnected = await openSession(browser, {
    wiring: wiring('offline'),
    condition: 'connected',
  })

  try {
    const request = { url: REACHES_ORIGIN, method: 'GET', body: null }
    const fromAbort = await aborted.page.evaluate(probeFetch, request)
    const fromOffline = await disconnected.page.evaluate(probeFetch, request)

    // `fetch` rejects with the same `TypeError: Failed to fetch` either way.
    // The distinguishing information exists only outside the page, which is
    // why an application cannot branch on it and `navigator.onLine` is the
    // only signal it has.
    expect(fromAbort.error).toBe(fromOffline.error)
    expect(fromAbort.error).toContain('Failed to fetch')
  } finally {
    await aborted.close()
    await disconnected.close()
  }
})

test('answers a fulfilled request while the page believes it is disconnected', async ({
  browser,
}) => {
  const session = await openSession(browser, {
    wiring: wiring('offline-har'),
    condition: 'severed',
  })

  try {
    const state = await session.page.evaluate(readConnection, CONNECTION_COUNTER)
    const answered = await session.page.evaluate(probeFetch, {
      url: REACHES_ORIGIN,
      method: 'GET',
      body: null,
    })

    // The combination an offline-capable application needs, and the one the
    // documentation does not spell out: emulated offline switches off the
    // *connection*, and a route handler that fulfils never touches it.
    expect(state.onLine).toBe(false)
    expect(answered.failed).toBe(false)
    expect(answered.status).toBe(200)
  } finally {
    await session.close()
  }
})

test('renders a styled document from the recording with no network at all', async ({ browser }) => {
  const session = await openSession(browser, {
    wiring: wiring('har-whole-page'),
    condition: 'severed',
  })

  try {
    await session.page.goto('/')

    const colour = await session.page.evaluate(readAppColour, '#app')

    // Not the same claim as "the stylesheet request returned 200": this is the
    // engine having parsed and applied it. A replay that served the CSS with
    // the wrong content type would pass the matrix cell and fail here.
    expect(colour).toBe(STYLED_COLOUR)
    expect(classifyStylesheet(colour)).toBe('origin')
  } finally {
    await session.close()
  }
})

test('refuses to navigate at all when the replay is scoped to the API', async ({ browser }) => {
  const session = await openSession(browser, { wiring: wiring('har-abort'), condition: 'severed' })

  try {
    // The navigation itself fails, which is the point: a suite that scopes its
    // replay to `**/api/**` has no application to drive the moment the runner
    // loses egress.
    await expect(session.page.goto('/')).rejects.toThrow()
  } finally {
    await session.close()
  }
})
