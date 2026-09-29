/**
 * The other half of the parallel phase; see `alpha.spec.ts` for why there are
 * two files.
 *
 * Identical but for the marker, which is what makes the `parallel-mutation`
 * cell legible: a row whose `notes` contain the other file's marker is a worker
 * that read a write it did not make.
 */

import { measure } from '../measure.ts'
import { strategyKey, test } from '../session.ts'

test('beta writes a note and files what the account then held', async ({ session }, testInfo) => {
  await measure(session, {
    strategy: strategyKey(),
    phase: 'parallel',
    marker: 'beta',
    workerIndex: testInfo.workerIndex,
    parallelIndex: testInfo.parallelIndex,
    retry: testInfo.retry,
  })
})
