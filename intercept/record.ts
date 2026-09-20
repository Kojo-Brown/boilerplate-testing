/**
 * Recording `har/origin.har`.
 *
 *     pnpm intercept:record
 *
 * Run by hand, never by CI, and that is the point rather than an oversight: a
 * recording regenerated on every run is not a recording, it is a proxy with
 * extra steps, and a suite built on one has no way to notice that the API
 * changed. The committed file is a snapshot of an origin that no longer
 * exists, `har.test.ts` asserts it is still the *older* one, and
 * `fidelity.spec.ts` measures what a suite reading it would believe.
 *
 * So re-recording is a deliberate act with a consequence, which is what this
 * directory is about. When you run it:
 *
 *   - `INTERCEPT_SCHEMA=1` pins the origin to the shape it had when the
 *     recording was first taken, so the drift the `drifted-get` probe measures
 *     survives the re-record. Dropping that would make the table green by
 *     erasing the thing it measures.
 *   - `/api/notifications` is not requested, because the `unrecorded-get`
 *     probe is about an endpoint the recording predates.
 *   - `/api/flaky` is requested through the same retrying client the specs
 *     use, so the recording holds both of its answers — a 503 and then a 200
 *     for the same URL. What a replayer does with that is measured, not
 *     assumed.
 */

import { rmSync } from 'node:fs'

import { chromium } from '@playwright/test'

import { probeFetch, probeFetchWithRetry } from './client.ts'
import { HAR_PATH } from './har.ts'
import { CONTROL_PATHS, ORIGIN_URL, RECORDED_SCHEMA } from './origin.ts'
import { RECORDED_WORD } from './probes.ts'
import { startOrigin } from './server.ts'

const origin = await startOrigin(RECORDED_SCHEMA)

// A stale file would otherwise be merged into rather than replaced: Playwright
// appends to an existing HAR when the path already holds one.
rmSync(HAR_PATH, { force: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  recordHar: {
    path: HAR_PATH,
    // Everything a replay needs and nothing it does not: no timings, no sizes,
    // no page records. Those fields change on every recording and would make
    // the committed file's diff unreadable without changing what it replays.
    mode: 'minimal',
    content: 'embed',
  },
})

const page = await context.newPage()

await fetch(`${ORIGIN_URL}${CONTROL_PATHS.reset}`, { method: 'POST' })
await page.goto(ORIGIN_URL)

await page.evaluate(probeFetch, { url: '/api/profile', method: 'GET', body: null })
await page.evaluate(probeFetch, { url: '/api/feed', method: 'GET', body: null })
await page.evaluate(probeFetch, {
  url: '/api/echo',
  method: 'POST',
  body: JSON.stringify({ word: RECORDED_WORD }),
})
await page.evaluate(probeFetchWithRetry, { url: '/api/flaky' })

await context.close()
await browser.close()
await new Promise<void>((resolve) => origin.close(() => resolve()))

process.stdout.write(`recorded ${HAR_PATH} against schema ${RECORDED_SCHEMA}\n`)
