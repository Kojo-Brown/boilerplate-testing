/**
 * The restart phase: what a replacement worker inherits.
 *
 * Playwright discards a worker process when a test in it fails and starts a new
 * one for whatever is left. The new worker gets a fresh `workerIndex` and the
 * *same* `parallelIndex` — which is the whole reason this file exists, because
 * the documented per-worker auth recipe keys its account on `parallelIndex`.
 *
 * Three tests, run with `workers: 1` and `retries: 1`:
 *
 *   1. `settles` — files a row from the first worker.
 *   2. `fails once` — files a row, then throws on its first attempt. That
 *      failure is what discards the worker. It is deterministic: the throw is
 *      guarded on `testInfo.retry === 0`, so the retry passes and the run ends
 *      green with exactly one restart in it.
 *   3. `follows` — files a row from whichever worker is alive by then.
 *
 * The row is filed *before* the throw on purpose: an attempt that recorded
 * nothing would leave the ledger unable to say which account the dead worker
 * had been using, which is half of the question.
 *
 * A failing test as an instrument rather than a defect is the same move
 * `trace/evidence.spec.ts` makes, and it carries the same obligation: this file
 * is excluded from every runner in the repository, and the run that drives it
 * asserts the failure happened.
 */

import { measure } from '../measure.ts'
import { strategyKey, test } from '../session.ts'

const row = (marker: string) =>
  async ({ session }: { session: import('../session.ts').Session }, testInfo: import('@playwright/test').TestInfo) => {
    await measure(session, {
      strategy: strategyKey(),
      phase: 'restart',
      marker,
      workerIndex: testInfo.workerIndex,
      parallelIndex: testInfo.parallelIndex,
      retry: testInfo.retry,
    })

    if (marker === 'restart-trigger' && testInfo.retry === 0) {
      throw new Error(
        'Deliberate failure: this is what discards the worker process. It throws only on the ' +
          'first attempt, so the retry passes and the run ends green with one restart in it.',
      )
    }
  }

test('before-restart runs in the first worker', row('before-restart'))
test('restart-trigger fails once and takes its worker with it', row('restart-trigger'))
test('after-restart runs in whichever worker survived', row('after-restart'))
