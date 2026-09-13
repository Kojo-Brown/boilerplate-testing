/**
 * The subject's schema, and the one hand-maintained list in this directory.
 *
 * ---------------------------------------------------------------------------
 * Why the schema is this shape
 * ---------------------------------------------------------------------------
 * Every table and every constraint below exists because one isolation strategy
 * behaves differently in its presence. A schema of two plain tables would let
 * all seven strategies score identically and the comparison would have nothing
 * to report.
 *
 *   - **`bigserial` primary keys.** A sequence is nontransactional. `ROLLBACK`
 *     does not give the number back and `TRUNCATE` does not reset it, so an
 *     assertion about an id is the cheapest probe that separates the strategies
 *     that restore the database from the strategies that merely empty it.
 *   - **A `DEFERRABLE INITIALLY DEFERRED` foreign key and unique constraint.**
 *     Deferred constraints are checked at `COMMIT` and nowhere else. A strategy
 *     that turns the subject's `COMMIT` into `RELEASE SAVEPOINT` never reaches
 *     that check, which is measured rather than asserted — see
 *     `mechanism.container.test.ts`.
 *   - **A `CHECK` constraint on `stock.on_hand`.** The control: an immediate
 *     constraint, checked by every strategy, so the matrix has a row that
 *     everything catches and a column of misses cannot be read as "the harness
 *     is broken".
 *   - **`audit_log`, which {@link TRUNCATED_TABLES} does not name.** See below.
 *
 * ---------------------------------------------------------------------------
 * The list that is deliberately wrong
 * ---------------------------------------------------------------------------
 * {@link TRUNCATED_TABLES} omits `audit_log`. That is the experiment, not an
 * oversight, and it is the only hand-maintained list in this directory: every
 * other table set is derived from the catalogue at runtime.
 *
 * A `TRUNCATE` list is written once, by the person who added the reset, from
 * the tables that existed that day. `audit_log` is the table somebody adds six
 * months later, in a pull request about audit logging, whose author has no
 * reason to open the test harness. Nothing fails. The suite goes on passing and
 * quietly stops isolating one table, and the first symptom is a test that
 * counts audit rows and passes alone and fails in the suite.
 *
 * `truncate-derived` is the same strategy with the list read from
 * `information_schema` instead, and the point of having both columns is that
 * the difference between them is a maintenance property rather than a
 * capability: neither strategy can do anything the other cannot, and one of
 * them is wrong six months from now.
 */

import type { Queryable } from './orders.ts'

/** Every table the subject writes to. */
export const ALL_TABLES = ['order_lines', 'orders', 'stock', 'audit_log'] as const

export type TableName = (typeof ALL_TABLES)[number]

/**
 * The tables the `truncate` strategies name explicitly.
 *
 * Deliberately missing `audit_log`. See the note above; `catalogue.test.ts`
 * pins the omission so that "somebody fixed the list and the finding evaporated"
 * is a failing test rather than a silently emptier matrix.
 */
export const TRUNCATED_TABLES = ['order_lines', 'orders', 'stock'] as const

/**
 * The DDL, in order.
 *
 * Written as separate statements rather than one script because
 * `schema-per-test` runs it inside a `search_path` it has just set, and a
 * multi-statement string through `pg` is a simple query that would report a
 * syntax error at an offset into the whole blob rather than at a statement.
 */
export const DDL: readonly string[] = [
  `create table orders (
     id          bigserial primary key,
     ref         text    not null,
     customer    text    not null,
     total_cents integer not null default 0
   )`,
  // Deferrable, so a duplicate reference survives inside the transaction that
  // created it and is rejected only when that transaction commits.
  `alter table orders
     add constraint orders_ref_key unique (ref)
     deferrable initially deferred`,
  `create table order_lines (
     id       bigserial primary key,
     order_id bigint  not null,
     sku      text    not null,
     cents    integer not null
   )`,
  `alter table order_lines
     add constraint order_lines_order_id_fkey
     foreign key (order_id) references orders (id) on delete cascade
     deferrable initially deferred`,
  // Immediate by construction: a CHECK is not deferrable, which is what makes
  // it the control row.
  `create table stock (
     sku     text primary key,
     on_hand integer not null check (on_hand >= 0)
   )`,
  `create table audit_log (
     id       bigserial primary key,
     ref      text not null,
     recorded timestamptz not null default now()
   )`,
]

/** The reference rows every test starts from. */
export const SEED_STOCK: readonly { readonly sku: string; readonly onHand: number }[] = [
  { sku: 'WIDGET', onHand: 10 },
  { sku: 'GASKET', onHand: 10 },
]

/** Apply the schema to a connection. */
export async function applySchema(db: Queryable): Promise<void> {
  for (const statement of DDL) {
    await db.query(statement)
  }
}

/**
 * Insert the reference rows.
 *
 * Every strategy calls this in its per-test setup, after whatever isolating it
 * does — including the strategies whose isolation would not have removed the
 * rows. Uniformity is the point: a seed that only some columns pay for would
 * show up in the cost table as a property of the strategy rather than of the
 * fixture, and the cost table is the one place in this directory where a
 * difference of ten milliseconds is the finding.
 */
export async function seed(db: Queryable): Promise<void> {
  for (const { sku, onHand } of SEED_STOCK) {
    await db.query('insert into stock (sku, on_hand) values ($1, $2) on conflict (sku) do update set on_hand = $2', [
      sku,
      onHand,
    ])
  }
}

/** The `TRUNCATE` a strategy issues, given the tables it knows about. */
export const truncateStatement = (tables: readonly string[], restartIdentity: boolean): string =>
  `truncate ${tables.join(', ')}${restartIdentity ? ' restart identity' : ''} cascade`

/**
 * The tables that actually exist, asked of the server rather than remembered.
 *
 * This is `truncate-derived`'s whole difference from `truncate`, and it is four
 * lines. `information_schema.tables` is filtered to the current schema so the
 * query means the same thing under `schema-per-test` as it does anywhere else.
 */
export async function tablesInSchema(db: Queryable): Promise<readonly string[]> {
  const result = await db.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = current_schema()
        and table_type = 'BASE TABLE'
      order by table_name`,
  )

  return result.rows.map((row) => row.table_name)
}
