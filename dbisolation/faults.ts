/**
 * The nine faults, and the mechanism that is supposed to catch each one.
 *
 * ---------------------------------------------------------------------------
 * Why the faults are grouped by mechanism rather than by severity
 * ---------------------------------------------------------------------------
 * A corpus of bugs picked for variety measures nothing in particular: the
 * strategies would each catch a scattering and the table would be a ranking
 * with no explanation in it. These nine are picked so that each *mechanism* —
 * the thing in Postgres that actually rejects the write — is represented, and
 * the finding is then a statement about mechanisms rather than about bugs.
 *
 * Four mechanisms, and the strategies do not differ on the first one at all:
 *
 *   - **assertion** — the suite notices, because a value it reads is wrong. No
 *     database feature is involved, so no isolation strategy can interfere. The
 *     control group, and it is a third of the corpus on purpose: a matrix whose
 *     misses were not surrounded by rows everything catches would be as easily
 *     explained by a broken harness as by a real blind spot.
 *   - **immediate constraint** — a `CHECK`, checked on the statement. Still
 *     nothing for a strategy to interfere with.
 *   - **deferred constraint** — checked at `COMMIT`, and only at `COMMIT`. This
 *     is where the rollback family stops seeing things, because it does not
 *     commit.
 *   - **another connection** — the fault is only visible to a session other
 *     than the one that wrote it. This is where the rollback family stops being
 *     *able* to look, because uncommitted rows are visible to nobody else.
 *
 * The last column is what a reader wants and it is deliberately not stated
 * here: which strategies catch which fault is measured in
 * `detection.container.test.ts` and claimed in `README.md`, not declared next
 * to the fault. A corpus that carries its own expected results is a corpus that
 * can only confirm them.
 */

/** Why a fault is rejected, when it is. */
export const MECHANISMS = ['assertion', 'immediate-constraint', 'deferred-constraint', 'other-connection'] as const

export type Mechanism = (typeof MECHANISMS)[number]

export const MECHANISM_NOTES: Readonly<Record<Mechanism, string>> = {
  assertion: 'A value the suite reads back is wrong. Nothing but the test is involved.',
  'immediate-constraint': 'Postgres rejects the statement that does it, inside the transaction.',
  'deferred-constraint': 'Postgres rejects it at COMMIT and at no earlier point.',
  'other-connection':
    'The evidence exists only outside the writing session, so a test has to look from somewhere else to see it.',
}

export const FAULTS = [
  'TOTAL_NOT_RECOMPUTED',
  'STOCK_NOT_DECREMENTED',
  'WRONG_LINE_COUNT',
  'AUDIT_NOT_WRITTEN',
  'STOCK_OVERSOLD',
  'ORPHAN_LINE',
  'DUPLICATE_REF',
  'NEVER_COMMITS',
  'NOTIFY_MISSING',
  'MIGRATION_IN_TX',
] as const

export type Fault = (typeof FAULTS)[number]

export interface FaultEntry {
  readonly fault: Fault
  readonly mechanism: Mechanism
  /** The edit, in one line, as a reviewer would describe it. */
  readonly edit: string
  /** Why a real change would ship it. */
  readonly plausibility: string
}

export const FAULT_CATALOGUE: readonly FaultEntry[] = [
  {
    fault: 'TOTAL_NOT_RECOMPUTED',
    mechanism: 'assertion',
    edit: 'Skip the `update orders set total_cents = …` after the lines are written.',
    plausibility:
      'The total is derived from rows written a moment earlier, which is exactly the update somebody moves into a trigger, a view or a service and forgets to remove from one path.',
  },
  {
    fault: 'STOCK_NOT_DECREMENTED',
    mechanism: 'assertion',
    edit: 'Skip the `update stock` loop entirely.',
    plausibility: 'The write that moves to an event handler and is left behind in the synchronous path.',
  },
  {
    fault: 'WRONG_LINE_COUNT',
    mechanism: 'assertion',
    edit: 'Write every line but the last one.',
    plausibility: 'An off-by-one in the loop bound, the most ordinary bug in the corpus.',
  },
  {
    fault: 'AUDIT_NOT_WRITTEN',
    mechanism: 'assertion',
    edit: 'Skip the `audit_log` insert.',
    plausibility:
      'Audit rows are written by the path nobody reads, so an early return or a refactor drops them without any behaviour changing.',
  },
  {
    fault: 'STOCK_OVERSOLD',
    mechanism: 'immediate-constraint',
    edit: 'Decrement `on_hand` by 100 rather than by 1.',
    plausibility:
      'A quantity read from the wrong field — the line total instead of the line quantity is the classic — which the CHECK on `on_hand >= 0` turns into an error rather than into negative stock.',
  },
  {
    fault: 'ORPHAN_LINE',
    mechanism: 'deferred-constraint',
    edit: 'Write one extra line, worth zero, against `id + 1_000_000`.',
    plausibility:
      'A stale order id carried across a loop iteration. Worth nothing, so no total moves and no count a test would think to assert changes: the deferred foreign key is the only thing that objects.',
  },
  {
    fault: 'DUPLICATE_REF',
    mechanism: 'deferred-constraint',
    edit: 'Insert the order header a second time with the same `ref`.',
    plausibility:
      'A retry that does not notice the first attempt succeeded. The deferred unique constraint lets both rows sit in the transaction and rejects the pair at COMMIT.',
  },
  {
    fault: 'NEVER_COMMITS',
    mechanism: 'other-connection',
    edit: 'Return without sending `commit`.',
    plausibility:
      'An early return inserted above the commit, or a commit moved into a branch. Every read the same session makes still sees its own writes, so the service looks correct from the inside for as long as the connection lives.',
  },
  {
    fault: 'NOTIFY_MISSING',
    mechanism: 'other-connection',
    edit: 'Skip the `pg_notify` before the commit.',
    plausibility:
      'The notification is not part of the order, so a refactor that extracts the write path leaves it behind and nothing in the row data changes.',
  },
  {
    fault: 'MIGRATION_IN_TX',
    mechanism: 'immediate-constraint',
    edit: 'Wrap `ensureRefIndex`\'s `CREATE INDEX CONCURRENTLY` in `begin` / `commit`.',
    plausibility:
      'A migration runner that wraps each step so a failed batch can be rolled back, which is correct for every other kind of DDL and fatal for this one.',
  },
]

export const entryFor = (fault: Fault): FaultEntry => {
  const entry = FAULT_CATALOGUE.find((candidate) => candidate.fault === fault)

  if (entry === undefined) {
    throw new Error(`No catalogue entry for fault ${fault}`)
  }

  return entry
}

/** A fault as a set, which is what the subject takes. */
export const only = (fault: Fault): ReadonlySet<Fault> => new Set([fault])
