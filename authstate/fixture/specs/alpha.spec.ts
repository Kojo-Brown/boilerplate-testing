/**
 * One half of the parallel phase; `beta.spec.ts` is the other.
 *
 * Two files rather than two tests in one file, on purpose: with
 * `fullyParallel: false` Playwright hands a whole file to a worker, so two
 * files and two workers is two workers — deterministically, rather than
 * depending on how a scheduler happened to split a pair of tests.
 *
 * Nothing is asserted here. This spec is the *subject* of a measurement: it
 * files a row and `../../runs.test.ts` reads the ledger and does the deciding.
 * A test that failed on what it found would stop the run before the other
 * worker had filed anything, which is the one outcome that makes the table
 * unreadable.
 */

import { measure } from '../measure.ts'
import { strategyKey, test } from '../session.ts'

test('alpha writes a note and files what the account then held', async ({ session }, testInfo) => {
  await measure(session, {
    strategy: strategyKey(),
    phase: 'parallel',
    marker: 'alpha',
    workerIndex: testInfo.workerIndex,
    parallelIndex: testInfo.parallelIndex,
    retry: testInfo.retry,
  })
})
