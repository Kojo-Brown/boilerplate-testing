/**
 * The body every measuring test runs, written once.
 *
 * Three specs use it — two in the parallel phase and one in the restart phase —
 * and they differ only in their marker and in whether the barriers are armed.
 * Keeping the body here is what makes a cell in the isolation table a property
 * of the strategy rather than of which spec happened to run: two rows that
 * disagree disagree because the fixture resolved a different account, not
 * because somebody wrote the second spec slightly differently.
 *
 * The barriers are the determinism. `parallel-mutation` and `session-eviction`
 * are both questions about what one worker sees *after* another worker has had
 * its turn, and "has had its turn" has to be a rendezvous: a sleep long enough
 * to be reliable on a loaded CI runner is a sleep long enough to make the suite
 * slow, and one short enough to be quick is a flake. So each worker parks on a
 * named barrier at the origin and is released when the other arrives.
 */

import type { APIRequestContext } from '@playwright/test'

import { PARTIES, type Session } from './session.ts'

/** One row in the ledger the isolation runs read back. */
export interface MeasuredRow {
  readonly strategy: string
  readonly phase: string
  readonly marker: string
  readonly workerIndex: number
  readonly parallelIndex: number
  readonly retry: number
  readonly email: string
  readonly slot: string
  readonly acquired: string
  /** What `GET /api/me` answered with the restored session. 200, or 401 once evicted. */
  readonly meStatus: number
  /** Every note the account held after this test wrote its own, in arrival order. */
  readonly notes: string
}

/** Park on a named barrier, unless this phase runs with a single worker. */
async function rendezvous(context: APIRequestContext, name: string): Promise<void> {
  const parties = PARTIES()

  if (parties < 2) {
    return
  }

  const response = await context.get(`/api/barrier?name=${name}&parties=${parties}`)

  if (response.status() !== 200) {
    throw new Error(`Barrier ${name} answered ${response.status()}: ${await response.text()}`)
  }
}

/**
 * Sign in (via the fixture), write a note, read the account back, and file a row.
 *
 * The order matters and is the measurement:
 *
 *   1. everybody is signed in — which, for a strategy that signs in per worker
 *      into a shared account, is the moment the eviction has happened;
 *   2. `GET /api/me`, which is where an evicted session answers 401;
 *   3. write this test's own marker;
 *   4. everybody has written — so a read now sees whatever the other worker
 *      put in the same account, or does not;
 *   5. read, and file the row.
 */
export async function measure(
  session: Session,
  options: { strategy: string; phase: string; marker: string; workerIndex: number; parallelIndex: number; retry: number },
): Promise<MeasuredRow> {
  const { context } = session

  await rendezvous(context, 'signed-in')

  const me = await context.get('/api/me')
  const meStatus = me.status()

  let notes: string[] = []

  if (meStatus === 200) {
    const written = await context.post('/api/notes', { data: { note: options.marker } })

    if (written.status() !== 200) {
      throw new Error(`Writing a note answered ${written.status()}`)
    }

    await rendezvous(context, 'written')

    const read = await context.get('/api/notes')

    if (read.status() !== 200) {
      throw new Error(`Reading notes answered ${read.status()}`)
    }

    notes = ((await read.json()) as { notes: string[] }).notes
  } else {
    // An evicted session cannot write, and the other worker must not be left
    // parked on a barrier waiting for it. Arriving without writing is the
    // honest thing: the row records a 401 and no note.
    await rendezvous(context, 'written')
  }

  const row: MeasuredRow = {
    strategy: options.strategy,
    phase: options.phase,
    marker: options.marker,
    workerIndex: options.workerIndex,
    parallelIndex: options.parallelIndex,
    retry: options.retry,
    email: session.email,
    slot: session.slot,
    acquired: session.acquired,
    meStatus,
    notes: notes.join('|'),
  }

  // Filed through the session's own context, which may be carrying a cookie the
  // origin has already evicted. `/api/ledger` takes no credential precisely so
  // that a worker whose session is dead can still report that it is — a ledger
  // behind the auth it measures would lose exactly the rows worth having.
  const filed = await context.post('/api/ledger', { data: row })

  if (filed.status() !== 200) {
    throw new Error(`Filing a ledger row answered ${filed.status()}`)
  }

  return row
}
