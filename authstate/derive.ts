/**
 * Turning a ledger into a row of the isolation table.
 *
 * Kept apart from `runs.test.ts` so that the deciding is pure: `runs.test.ts`
 * spawns processes and reads sockets, and `derive.test.ts` checks these rules
 * against hand-written ledgers — including ledgers no real run produces, which
 * is the only way to find out whether a rule fires for the reason it claims to
 * rather than for the reason the run happened to supply.
 *
 * Every rule below is a statement about rows, not about strategies. Nothing
 * here knows which strategy it is looking at, which is what stops the
 * derivation from confirming the table it is supposed to be measuring.
 */

import type { Hazard } from './isolation.ts'

/** One filed row, as `fixture/measure.ts` writes it. */
export interface LedgerRow {
  readonly strategy: string
  readonly phase: string
  readonly marker: string
  readonly workerIndex: number
  readonly parallelIndex: number
  readonly retry: number
  readonly email: string
  readonly slot: string
  readonly acquired: string
  readonly meStatus: number
  readonly notes: string
}

/** What a run of the fixture suite reports back. */
export interface RunResult {
  readonly rows: readonly LedgerRow[]
  /** `POST /api/login` calls the origin answered during the run. */
  readonly logins: number
}

const notesOf = (row: LedgerRow): string[] => (row.notes === '' ? [] : row.notes.split('|'))

/**
 * `session-eviction` — did any worker find its session gone?
 *
 * One 401 is enough. The alternative rule, "every worker got a 401", would be
 * wrong in the direction that flatters: eviction is inherently asymmetric, the
 * worker that signed in *last* keeps its session, and a rule requiring both to
 * fail would report the hazard as absent in exactly the case it is present.
 */
export function evictionVerdict(rows: readonly LedgerRow[]): string {
  return rows.some((row) => row.meStatus === 401) ? 'evicted' : 'survives'
}

/**
 * `parallel-mutation` — did anybody read somebody else's write?
 *
 * Decided on markers rather than on counts. A count is the tempting rule and it
 * is weaker in both directions: two notes could be one worker retried, and two
 * workers writing the same marker into separate accounts would read as one
 * note each and look clean for the wrong reason.
 *
 * The `unreachable` branch is where this measurement's honesty lives, and it
 * was not in the first draft — the run put it there. A strategy whose workers
 * evict each other has a worker that never writes, so nobody can read its
 * write, so the collision does not happen. Scoring that `isolated` is not a
 * rounding error: it ranks the worst strategy in the table level with the best
 * ones on the column it is worst at, and it does so *because* it failed the
 * column to its left. A hazard that could not be posed is reported as not posed.
 */
export function mutationVerdict(rows: readonly LedgerRow[]): string {
  const parallel = rows.filter((row) => row.phase === 'parallel')

  if (parallel.some((row) => row.meStatus !== 200)) {
    return 'unreachable'
  }

  return parallel.some((row) => notesOf(row).some((note) => note !== row.marker))
    ? 'collided'
    : 'isolated'
}

/** A worker that replaced another at the same parallel slot. */
export interface Replacement {
  readonly parallelIndex: number
  readonly before: LedgerRow
  readonly after: LedgerRow
}

/**
 * Find the restart: two workers at one parallel slot, in the order they ran.
 *
 * "In the order they ran" is the ledger's arrival order rather than a
 * comparison of worker indices. They agree today — Playwright's `workerIndex`
 * is monotonic — but the ledger is what was observed and the index is a
 * property of the runner, and a derivation that leans on the second is one
 * runner release away from being about something else.
 */
export function replacements(rows: readonly LedgerRow[]): Replacement[] {
  const restart = rows.filter((row) => row.phase === 'restart')
  const firstBySlot = new Map<number, LedgerRow>()
  const found: Replacement[] = []

  for (const row of restart) {
    const seen = firstBySlot.get(row.parallelIndex)

    if (seen === undefined) {
      firstBySlot.set(row.parallelIndex, row)

      continue
    }

    if (seen.workerIndex !== row.workerIndex) {
      found.push({ parallelIndex: row.parallelIndex, before: seen, after: row })
      firstBySlot.set(row.parallelIndex, row)
    }
  }

  return found
}

/**
 * `restart-inheritance` — does the replacement worker resume the dead one's account?
 *
 * Stated as the account rather than as the leaked data, deliberately. "Did it
 * see the old worker's notes" is true for every shared-account strategy for a
 * reason that has nothing to do with restarts, and would make this column a
 * second copy of `parallel-mutation`. The account is the restart-specific
 * question: it is what the `existsSync` branch decides, and it is what makes
 * one row in the table differ from its neighbour by one identifier.
 */
export function inheritanceVerdict(rows: readonly LedgerRow[]): string {
  const found = replacements(rows)

  if (found.length === 0) {
    throw new Error(
      'The restart phase filed no two rows at one parallel slot from two different workers, ' +
        'so no worker was replaced and the question cannot be answered. Either the ' +
        'deliberate failure in restart.spec.ts stopped failing, or the run was not given ' +
        'a retry.',
    )
  }

  return found.some((pair) => pair.before.email === pair.after.email) ? 'inherited' : 'fresh'
}

/**
 * Every distinct account one run signed in as or restored.
 *
 * Per run, and summed by the caller, rather than counted across the pair. The
 * two phases are two processes and Playwright starts `workerIndex` at 0 in
 * each, so `slot-w0@example.test` appears in both — a set over the combined
 * rows reports `per-worker-index` as using two accounts for four workers, which
 * is the one number in the table it exists to contradict. This was measured,
 * not reasoned: the first draft counted across the pair and reported 2 where
 * the run had plainly used 4.
 */
export function accountsUsed(rows: readonly LedgerRow[]): number {
  return new Set(rows.map((row) => row.email)).size
}

/** Derive one strategy's whole row from the two runs that measured it. */
export function deriveRow(
  parallel: RunResult,
  restart: RunResult,
): Readonly<Record<Hazard, string>> & { readonly logins: number; readonly accounts: number } {
  const rows = [...parallel.rows, ...restart.rows]

  return {
    'session-eviction': evictionVerdict(rows),
    'parallel-mutation': mutationVerdict(rows),
    'restart-inheritance': inheritanceVerdict(rows),
    logins: parallel.logins + restart.logins,
    accounts: accountsUsed(parallel.rows) + accountsUsed(restart.rows),
  }
}
