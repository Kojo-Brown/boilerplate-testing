/**
 * How Playwright's replayer decides a recorded entry matches.
 *
 * The matrix says a cache-busted URL and a changed POST body both miss, and
 * that a recorded retry never recovers. Those are three cells and they leave
 * the interesting half unsaid — *what* the matcher compares, and what it does
 * with two recorded answers to the same request. Both are decided by
 * Playwright rather than by anything in this directory, neither is promised by
 * its documentation, and a suite that replays a recording is built on them.
 *
 * So they are measured here, one behaviour per test, against the committed
 * recording. Every one of these is a reason a replay-based suite goes green or
 * red for a cause nobody wrote down.
 */

import { expect, test } from '@playwright/test'

import { probeFetch, probeFetchWithRetry } from './client.ts'
import { RECORDED_WORD, SENT_WORD } from './probes.ts'
import { openSession } from './session.ts'
import { wiringByName, type Wiring } from './wirings.ts'

const closedReplay = (): Wiring => {
  const found = wiringByName('har-abort')

  if (found === undefined) {
    throw new Error('har-abort is no longer a wiring')
  }

  return found
}

test('serves the recorded body when the request matches it exactly', async ({ browser }) => {
  const session = await openSession(browser, { wiring: closedReplay(), condition: 'severed' })

  try {
    const answered = await session.page.evaluate(probeFetch, {
      url: '/api/profile',
      method: 'GET',
      body: null,
    })

    expect(answered.status).toBe(200)
    expect(answered.body).toMatchObject({ name: 'Ada Lovelace' })
  } finally {
    await session.close()
  }
})

test('misses a URL that differs only by a cache-busting query', async ({ browser }) => {
  const session = await openSession(browser, { wiring: closedReplay(), condition: 'severed' })

  try {
    const answered = await session.page.evaluate(probeFetch, {
      url: '/api/profile?cb=7',
      method: 'GET',
      body: null,
    })

    // The whole URL is the key. Any client that appends a timestamp, a
    // request id or a `_=` buster to its GETs replays nothing at all, and the
    // failure arrives as a network error rather than as "no recording for
    // this".
    expect(answered.failed).toBe(true)
  } finally {
    await session.close()
  }
})

test('compares the body of a POST, so a changed payload is a miss', async ({ browser }) => {
  const session = await openSession(browser, { wiring: closedReplay(), condition: 'severed' })

  try {
    const answered = await session.page.evaluate(probeFetch, {
      url: '/api/echo',
      method: 'POST',
      body: JSON.stringify({ word: SENT_WORD }),
    })

    expect(answered.failed).toBe(true)
  } finally {
    await session.close()
  }
})

test('serves the recorded answer when the POST body is the one that was recorded', async ({
  browser,
}) => {
  const session = await openSession(browser, { wiring: closedReplay(), condition: 'severed' })

  try {
    const answered = await session.page.evaluate(probeFetch, {
      url: '/api/echo',
      method: 'POST',
      body: JSON.stringify({ word: RECORDED_WORD }),
    })

    // The pair of tests is the finding: matching on the body is what turns
    // "answered with somebody else's recording" — the quiet failure — into a
    // network error. It is the more useful behaviour and it is the one that
    // makes a replay suite brittle in the presence of any payload that varies.
    expect(answered.status).toBe(200)
    expect(answered.body).toMatchObject({ echoed: RECORDED_WORD.toUpperCase() })
  } finally {
    await session.close()
  }
})

test('replays the first recorded answer to every attempt, failure included', async ({ browser }) => {
  const session = await openSession(browser, { wiring: closedReplay(), condition: 'severed' })

  try {
    const retried = await session.page.evaluate(probeFetchWithRetry, { url: '/api/flaky' })

    // The recording holds a 503 and then a 200 for this URL — `har.test.ts`
    // asserts both are in the file. The replayer hands the 503 to the retry as
    // well, so a client that recovered against the origin cannot recover
    // against the recording, and the suite reports a bug in a retry that works.
    expect(retried.attempts).toBe(2)
    expect(retried.status).toBe(503)
  } finally {
    await session.close()
  }
})

test('fails an unrecorded request rather than inventing an empty response', async ({ browser }) => {
  const session = await openSession(browser, { wiring: closedReplay(), condition: 'severed' })

  try {
    const answered = await session.page.evaluate(probeFetch, {
      url: '/api/notifications',
      method: 'GET',
      body: null,
    })

    // `notFound: 'abort'` is a network failure, not a 404. An application that
    // handles 404 and not a rejected `fetch` behaves differently here than it
    // would against an origin that has never heard of the endpoint.
    expect(answered.failed).toBe(true)
    expect(answered.status).toBe(0)
  } finally {
    await session.close()
  }
})
