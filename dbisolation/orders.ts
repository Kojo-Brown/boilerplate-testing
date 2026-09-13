/**
 * The subject: one service that places an order, written the way a service is.
 *
 * ---------------------------------------------------------------------------
 * Why the subject manages its own transaction
 * ---------------------------------------------------------------------------
 * This is the single decision the whole directory turns on. Almost every
 * write-up of transaction-rollback isolation demonstrates it against code that
 * issues one statement, and against code that issues one statement it is
 * flawless. Real code opens a transaction, because placing an order is four
 * writes that must land together — and a `BEGIN` from the code under test,
 * arriving inside a transaction the *harness* opened, is where the strategy
 * stops behaving the way the write-ups describe.
 *
 * So `placeOrder` does what the real thing does: `begin`, four writes, a
 * notification, `commit`. `mechanism.container.test.ts` measures what each
 * strategy makes of that, and the answer for the naive wrapper is not "it is a
 * bit slower" — the subject's `COMMIT` commits the harness's transaction and
 * the isolation is simply gone.
 *
 * ---------------------------------------------------------------------------
 * Faults are flags, not copies
 * ---------------------------------------------------------------------------
 * Every fault in `faults.ts` is a branch in the functions below rather than a
 * variant file, for the reason `property/` and `snapshot/` give: a corpus of
 * copies drifts from the subject, and the drift is invisible because each copy
 * passes its own tests. Here the all-correct path is the code, and
 * `catalogue.test.ts` pins that an empty fault set changes nothing.
 *
 * The branches are deliberately narrow. `ORPHAN_LINE` adds a line worth zero
 * pence rather than repointing a real one, and `DUPLICATE_REF` inserts a second
 * header rather than corrupting the first, because a fault that also moves the
 * order total would be caught by an assertion about the total — and then the
 * matrix would be reporting that this suite asserts on totals, which is not the
 * question. Each fault is reachable by exactly one mechanism, and for these two
 * that mechanism is a deferred constraint.
 */

import type { QueryResult, QueryResultRow } from 'pg'

import type { Fault } from './faults.ts'

/**
 * The narrowest thing the subject needs from a connection.
 *
 * Narrow on purpose: `rollback-savepoint` works by substituting an
 * implementation of this interface that rewrites transaction control, which is
 * exactly what Rails' `use_transactional_fixtures` and Django's `TestCase` do
 * one layer further down, in the connection adapter. A subject typed against
 * `pg.Client` could not be given one.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>
}

/** The channel the subject notifies on a successful commit. */
export const ORDER_PLACED_CHANNEL = 'orders_placed'

/** The index `ensureRefIndex` creates. */
export const REF_INDEX = 'orders_ref_lookup'

export interface OrderLine {
  readonly sku: string
  readonly cents: number
}

export interface OrderInput {
  readonly ref: string
  readonly customer: string
  readonly lines: readonly OrderLine[]
}

export interface PlacedOrder {
  readonly id: number
  readonly ref: string
}

/** No faults. The subject as it is meant to be. */
export const CORRECT: ReadonlySet<Fault> = new Set<Fault>()

/**
 * Place an order.
 *
 * `begin` / `commit` are sent as bare statements rather than through a helper
 * so that the string a strategy has to intercept is visible in this file. The
 * keywords are lowercase and alone on the line for the same reason: the
 * rewriting in `strategies.ts` matches on the first word, and a subject that
 * dressed its transaction control up in `START TRANSACTION ISOLATION LEVEL …`
 * would be demonstrating a parser rather than an isolation strategy.
 */
export async function placeOrder(
  db: Queryable,
  input: OrderInput,
  faults: ReadonlySet<Fault> = CORRECT,
): Promise<PlacedOrder> {
  await db.query('begin')

  const inserted = await db.query<{ id: string }>(
    'insert into orders (ref, customer) values ($1, $2) returning id',
    [input.ref, input.customer],
  )
  const id = Number(inserted.rows[0]?.id)

  if (Number.isNaN(id)) {
    throw new Error('The orders insert returned no id')
  }

  // A retry path that does not notice the first attempt succeeded. Rejected by
  // the deferred unique constraint at COMMIT and by nothing before it.
  if (faults.has('DUPLICATE_REF')) {
    await db.query('insert into orders (ref, customer) values ($1, $2)', [input.ref, input.customer])
  }

  // An off-by-one in the loop bound: every line but the last.
  const written = faults.has('WRONG_LINE_COUNT') ? input.lines.slice(0, -1) : input.lines

  for (const line of written) {
    await db.query('insert into order_lines (order_id, sku, cents) values ($1, $2, $3)', [id, line.sku, line.cents])
  }

  // A line written against an order id this transaction never created — the
  // shape a stale variable takes in a loop. Worth zero pence so that it moves
  // nothing an assertion looks at, and is rejected only by the deferred
  // foreign key.
  if (faults.has('ORPHAN_LINE')) {
    await db.query('insert into order_lines (order_id, sku, cents) values ($1, $2, 0)', [id + 1_000_000, 'GHOST'])
  }

  if (!faults.has('TOTAL_NOT_RECOMPUTED')) {
    await db.query(
      'update orders set total_cents = (select coalesce(sum(cents), 0) from order_lines where order_id = $1) where id = $1',
      [id],
    )
  }

  if (!faults.has('STOCK_NOT_DECREMENTED')) {
    for (const line of written) {
      // The immediate-constraint control: a quantity nobody has takes on_hand
      // below zero and the CHECK rejects it on the statement, not at commit.
      const quantity = faults.has('STOCK_OVERSOLD') ? 100 : 1

      await db.query('update stock set on_hand = on_hand - $2 where sku = $1', [line.sku, quantity])
    }
  }

  if (!faults.has('AUDIT_NOT_WRITTEN')) {
    await db.query('insert into audit_log (ref) values ($1)', [input.ref])
  }

  if (!faults.has('NOTIFY_MISSING')) {
    await db.query('select pg_notify($1, $2)', [ORDER_PLACED_CHANNEL, input.ref])
  }

  if (!faults.has('NEVER_COMMITS')) {
    await db.query('commit')
  }

  return { id, ref: input.ref }
}

/**
 * The migration step: an index built without taking a write lock.
 *
 * `CREATE INDEX CONCURRENTLY` is here because it is the most common piece of
 * production DDL that *cannot* run inside a transaction block — Postgres
 * rejects it with 25001 — and because `IF NOT EXISTS` does not save it: the
 * check happens after the transaction-block test, which
 * `mechanism.container.test.ts` verifies rather than assumes.
 *
 * That makes it the one operation in the subject that a rollback-based strategy
 * cannot run at all, correct or faulted, which is a different kind of result
 * from a missed fault and the matrix scores it as one.
 */
export async function ensureRefIndex(db: Queryable, faults: ReadonlySet<Fault> = CORRECT): Promise<void> {
  const statement = `create index concurrently if not exists ${REF_INDEX} on orders (ref)`

  // A migration runner that wraps every step in a transaction so it can roll
  // the batch back. Correct for every other kind of DDL and fatal for this one.
  if (faults.has('MIGRATION_IN_TX')) {
    await db.query('begin')
    await db.query(statement)
    await db.query('commit')

    return
  }

  await db.query(statement)
}

/** Whether the index exists, asked of the catalogue. */
export async function refIndexExists(db: Queryable): Promise<boolean> {
  const result = await db.query<{ count: string }>(
    'select count(*) as count from pg_indexes where schemaname = current_schema() and indexname = $1',
    [REF_INDEX],
  )

  return Number(result.rows[0]?.count ?? 0) > 0
}
