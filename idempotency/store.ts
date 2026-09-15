/**
 * A transactional store small enough to read and faithful enough to lose the
 * argument for you.
 *
 * ---------------------------------------------------------------------------
 * Why not a Map
 * ---------------------------------------------------------------------------
 * Almost every demonstration of idempotency keys backs them with a plain `Map`
 * and a `has`/`set` pair, and every such demonstration is sound — because a
 * `Map` has no concurrency. `has` and `set` cannot be separated by anything, so
 * the check-then-act that is *the entire bug class* is unreachable, and the
 * naive implementation passes. That is the failure this directory exists to
 * measure, so the store has to be able to exhibit it.
 *
 * Three properties are therefore modelled rather than assumed, and each one is
 * load-bearing for at least one cell of the matrix:
 *
 *   1. **Transactions.** Writes are buffered and become visible at `commit`.
 *      Without this, "the effect and the key are written atomically" is not a
 *      strategy anybody can implement here, and `lease` and `outbox` collapse
 *      into `memo-before`.
 *
 *   2. **Unique indexes that block.** A second insert of a value another open
 *      transaction has already inserted does not fail and does not succeed: it
 *      *waits* for that transaction to settle, then fails if it committed and
 *      proceeds if it rolled back. This is what Postgres does, and it is the
 *      single mechanism that makes an atomic lease possible. Model the index as
 *      a `Set` checked at commit time instead and the lease strategy stops
 *      working for a reason that is an artefact of the model.
 *
 *   3. **Crashes that are not exceptions.** A thrown error unwinds and the
 *      handler gets to answer. A crash does not: the transaction is abandoned
 *      unrolled-back, whatever was committed before it stays committed, and the
 *      client receives nothing at all. `crash-after-effect` and
 *      `crash-before-effect` are two of the three hazards no `Map` can pose.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately not modelled
 * ---------------------------------------------------------------------------
 * Isolation levels. Every read here is READ COMMITTED and there is no snapshot,
 * no serialisable conflict detection, and no deadlock detector beyond the cycle
 * check in `acquire`. `dbisolation/` is where that question lives. Modelling it
 * would add two more axes to an eighty-eight cell matrix without changing a
 * single outcome in it — every strategy compared here is decided by the unique
 * index and by transaction boundaries, both of which are the same at every
 * isolation level Postgres offers.
 *
 * There is also no wall clock. Key expiry is a hazard in `hazards.ts` and it is
 * posed by advancing an injected counter, never by sleeping: see `clock.ts`.
 */

/** A row. Deliberately untyped at the store level; tables give it meaning. */
export type Row = Readonly<Record<string, string | number | boolean | null>>

/** The tables this store knows about. */
export const TABLES = ['charges', 'idempotency_keys', 'gateway_calls', 'outbox'] as const

export type TableName = (typeof TABLES)[number]

/**
 * Unique indexes, by table.
 *
 * A row's index value is the named columns joined by a character that cannot
 * appear in an identifier here, so ('a|b', 'c') and ('a', 'b|c') are different
 * values rather than the same string. A real index compares tuples; this is the
 * cheapest way to get the same answer.
 */
export const UNIQUE_INDEXES: Readonly<Record<TableName, readonly (readonly string[])[]>> = {
  charges: [['request_key']],
  // `(scope, key)` and not `(principal, key)`: the schema must not decide the
  // tenancy question for the strategy. See `service.ts#GLOBAL_SCOPE`.
  idempotency_keys: [['scope', 'key']],
  gateway_calls: [],
  outbox: [['dedup_key']],
}

// ASCII unit separator, built rather than written literally: a raw control
// character in a source file makes it a binary blob to `grep`, `git diff` and
// every review tool, which is a high price for a delimiter.
const INDEX_SEPARATOR = String.fromCharCode(31)

/** Raised when an insert collides with a committed row on a unique index. */
export class UniqueViolation extends Error {
  readonly table: TableName
  readonly columns: readonly string[]
  readonly value: string

  constructor(table: TableName, columns: readonly string[], value: string) {
    super(`duplicate key value violates unique constraint on ${table}(${columns.join(', ')})`)
    this.name = 'UniqueViolation'
    this.table = table
    this.columns = columns
    this.value = value
  }
}

/**
 * Raised when a transaction is used after the process it belonged to crashed.
 *
 * Not something a handler catches — it means the harness let a crashed
 * delivery keep running, which is a bug in the harness rather than in the
 * subject, so it is loud.
 */
export class CrashedTransaction extends Error {
  constructor() {
    super('this transaction belonged to a delivery that has already crashed')
    this.name = 'CrashedTransaction'
  }
}

/** Raised when two transactions wait on each other's index reservations. */
export class Deadlock extends Error {
  constructor(value: string) {
    super(`deadlock detected waiting for ${value}`)
    this.name = 'Deadlock'
  }
}

interface Reservation {
  /** The transaction holding it. */
  readonly holder: Transaction
  /** Resolvers for transactions waiting on it, in arrival order. */
  readonly waiters: (() => void)[]
}

type Settlement = 'committed' | 'rolled-back' | 'crashed'

/**
 * A hook the hazards use to take control at a precise point.
 *
 * Every store operation announces itself and awaits whatever this returns,
 * which is how `concurrent-retry` parks one delivery in the window between its
 * effect and its memo while the other runs. A seeded delay would get there
 * eventually; a named pause gets there every time, which is the difference
 * between a matrix and a flake.
 */
export type OperationHook = (event: OperationEvent) => Promise<void> | void

export interface OperationEvent {
  readonly delivery: string
  readonly operation: 'insert' | 'select' | 'update' | 'commit' | 'rollback'
  /** The table a row operation touched; null for `commit` and `rollback`. */
  readonly table: TableName | null
  /**
   * For a `commit`, the tables the transaction wrote.
   *
   * This is what makes "crash once the charge is durable" expressible without
   * the hazard knowing which strategy it is posing the hazard to. The
   * strategies disagree about how many transactions they use and what is in
   * each one — `memo-after` commits the charge in its second, `atomic-outbox`
   * in its only one — so a crash point counted in commits would land somewhere
   * different in each column and the row would not be one hazard.
   */
  readonly tables: readonly TableName[]
  /**
   * Whether the operation has happened yet.
   *
   * Both halves are needed and by different hazards. `concurrent-retry` parks a
   * delivery *before* a commit to hold the window open; the crash hazards kill
   * it *after* one, because a crash that loses the commit it is named for is a
   * different hazard.
   */
  readonly phase: 'before' | 'after'
}

export interface TransactionOptions {
  /** Which delivery this transaction belongs to, for the hook and the log. */
  readonly delivery: string
}

/** One entry in the store's operation log, for explaining a cell. */
export interface LogEntry {
  readonly delivery: string
  readonly operation: OperationEvent['operation']
  readonly table: TableName | null
  readonly detail: string
}

export class Transaction {
  /** Rows written but not yet visible to anybody else. */
  private readonly pending: { table: TableName; row: Row }[] = []

  /** Index values reserved by this transaction, for release at settle time. */
  private readonly reserved: string[] = []

  private settled: Settlement | null = null

  private readonly store: Store

  readonly delivery: string

  constructor(store: Store, delivery: string) {
    this.store = store
    this.delivery = delivery
  }

  get isSettled(): boolean {
    return this.settled !== null
  }

  private assertUsable(): void {
    if (this.settled === 'crashed') throw new CrashedTransaction()
    if (this.settled !== null) throw new Error(`transaction already ${this.settled}`)
  }

  /**
   * Rows visible to this transaction: everything committed, plus its own
   * pending writes. READ COMMITTED with the reader's own writes on top, which
   * is what every database does and what makes `select` after `insert` inside
   * one transaction return the row.
   */
  /** The tables this transaction has written, for the `commit` event. */
  private get written(): readonly TableName[] {
    return [
      ...new Set([
        ...this.pending.map((write) => write.table),
        ...this.pendingUpdates.map((change) => change.table),
      ]),
    ]
  }

  private announce(
    operation: OperationEvent['operation'],
    table: TableName | null,
    phase: OperationEvent['phase'],
  ): Promise<void> {
    return this.store.announce({
      delivery: this.delivery,
      operation,
      table,
      tables: operation === 'commit' ? this.written : [],
      phase,
    })
  }

  async select(table: TableName, match: Readonly<Record<string, unknown>> = {}): Promise<readonly Row[]> {
    this.assertUsable()
    await this.announce('select', table, 'before')
    this.assertUsable()

    const own = this.pending.filter((write) => write.table === table).map((write) => write.row)
    const matches = (row: Row): boolean =>
      Object.entries(match).every(([column, value]) => row[column] === value)
    const rows = [...this.store.committed(table), ...own].filter(matches)

    await this.announce('select', table, 'after')
    this.assertUsable()

    return rows
  }

  /** The first matching row, or null. The read every strategy here does. */
  async selectOne(table: TableName, match: Readonly<Record<string, unknown>>): Promise<Row | null> {
    const rows = await this.select(table, match)

    return rows[0] ?? null
  }

  /**
   * Insert, taking every unique reservation the row needs.
   *
   * The reservation is where the concurrency lives. If another open
   * transaction holds this value we wait for it to settle rather than failing
   * immediately — a committed holder then gives us `UniqueViolation`, a
   * rolled-back or crashed one gives us the value. A strategy that inserts its
   * key first and its effect second is therefore genuinely serialised against
   * a concurrent delivery of the same key, and one that inserts its effect
   * first is genuinely not.
   */
  async insert(table: TableName, row: Row): Promise<void> {
    this.assertUsable()
    await this.announce('insert', table, 'before')
    this.assertUsable()

    for (const columns of UNIQUE_INDEXES[table]) {
      // SQL's rule, and it is load-bearing rather than pedantry: NULL is not
      // equal to NULL, so a unique index does not deduplicate rows that have
      // none of its columns. Without this, `none` — which writes no request
      // key at all — would be deduplicated by the index it never opted into,
      // and the control row of the matrix would report the safety of a
      // strategy that has none.
      if (columns.some((column) => row[column] === null || row[column] === undefined)) continue

      const value = indexValue(table, columns, row)

      await this.store.acquire(this, value)
      this.assertUsable()

      if (this.store.committedHas(table, columns, row)) {
        // Release what we took on the way in; the caller is about to unwind and
        // a reservation held by a transaction that never commits blocks
        // everyone behind it until it rolls back.
        this.store.release(this, value)
        this.reserved.splice(this.reserved.indexOf(value), 1)
        throw new UniqueViolation(table, columns, value)
      }

      this.reserved.push(value)
    }

    this.pending.push({ table, row })
    this.store.log({
      delivery: this.delivery,
      operation: 'insert',
      table,
      detail: JSON.stringify(row),
    })

    await this.announce('insert', table, 'after')
    this.assertUsable()
  }

  /**
   * Update matching rows.
   *
   * Only ever used to move an idempotency key from `in-progress` to `done`, so
   * it updates committed rows in place at commit time rather than modelling
   * row versions. The narrowness is deliberate: a general `UPDATE` invites the
   * lost-update question, which is `dbisolation/`'s and not this one's.
   */
  async update(
    table: TableName,
    match: Readonly<Record<string, unknown>>,
    changes: Row,
  ): Promise<void> {
    this.assertUsable()
    await this.announce('update', table, 'before')
    this.assertUsable()

    this.pendingUpdates.push({ table, match, changes })
    this.store.log({
      delivery: this.delivery,
      operation: 'update',
      table,
      detail: `${JSON.stringify(match)} -> ${JSON.stringify(changes)}`,
    })

    await this.announce('update', table, 'after')
    this.assertUsable()
  }

  private readonly pendingUpdates: {
    table: TableName
    match: Readonly<Record<string, unknown>>
    changes: Row
  }[] = []

  async commit(): Promise<void> {
    this.assertUsable()

    // Captured before `settle` clears the pending writes: the `after` event has
    // to say what this commit made durable, and by then it is committed.
    const tables = this.written

    await this.announce('commit', null, 'before')
    this.assertUsable()

    for (const write of this.pending) this.store.append(write.table, write.row)
    for (const change of this.pendingUpdates) this.store.applyUpdate(change.table, change.match, change.changes)

    this.settle('committed')
    this.store.log({
      delivery: this.delivery,
      operation: 'commit',
      table: null,
      detail: tables.join(', '),
    })

    // No `assertUsable` guard after this one, and that is the whole point of
    // the crash hazards: the hook may kill the delivery here, and what it kills
    // is a delivery whose work is already durable. It throws, so nothing after
    // the `commit()` call in the handler runs.
    await this.store.announce({
      delivery: this.delivery,
      operation: 'commit',
      table: null,
      tables,
      phase: 'after',
    })
  }

  async rollback(): Promise<void> {
    if (this.settled !== null) return
    await this.announce('rollback', null, 'before')

    this.settle('rolled-back')

    await this.announce('rollback', null, 'after')
  }

  /**
   * Abandon this transaction because its process died.
   *
   * Distinct from `rollback` in exactly one way that matters: nothing after
   * this point in the handler gets to run, so `assertUsable` throws
   * `CrashedTransaction` rather than returning. The *data* outcome is the same
   * as a rollback, which is the point — an uncommitted effect is lost either
   * way, and the difference between the two hazards is what the client learns.
   */
  crash(): void {
    if (this.settled !== null) return
    this.settle('crashed')
  }

  private settle(settlement: Settlement): void {
    this.settled = settlement
    for (const value of this.reserved) this.store.release(this, value)
    this.reserved.length = 0
    this.store.forget(this)
  }
}

function indexValue(table: TableName, columns: readonly string[], row: Row): string {
  return [table, ...columns.map((column) => String(row[column] ?? ''))].join(INDEX_SEPARATOR)
}

export class Store {
  private readonly rows: Record<TableName, Row[]> = {
    charges: [],
    idempotency_keys: [],
    gateway_calls: [],
    outbox: [],
  }

  private readonly reservations = new Map<string, Reservation>()

  /** Which value each transaction is currently blocked on, for cycle detection. */
  private readonly waitingOn = new Map<Transaction, string>()

  private readonly entries: LogEntry[] = []

  private hook: OperationHook | null = null

  /** Install the hazard's hook. One at a time; hazards do not compose here. */
  setHook(hook: OperationHook | null): void {
    this.hook = hook
  }

  async announce(event: OperationEvent): Promise<void> {
    await this.hook?.(event)
  }

  log(entry: LogEntry): void {
    this.entries.push(entry)
  }

  get operations(): readonly LogEntry[] {
    return this.entries
  }

  /** Transactions that have not settled, so a dead delivery can be cleaned up. */
  private readonly open = new Set<Transaction>()

  begin(options: TransactionOptions): Transaction {
    const transaction = new Transaction(this, options.delivery)

    this.open.add(transaction)

    return transaction
  }

  /** Called by a transaction as it settles, whichever way it settled. */
  forget(transaction: Transaction): void {
    this.open.delete(transaction)
  }

  /**
   * Abandon every transaction a dead delivery still had open.
   *
   * This is what a database does when a client's connection drops: the backend
   * rolls the transaction back and, crucially, **releases its locks**. Without
   * it the model deadlocks rather than recovers — `crash-after-gateway` against
   * `natural-key` is the case that found it. That delivery dies holding a
   * unique-index reservation on the order id, and the retry, which is supposed
   * to see the charge is absent and redo it, instead waits forever for a
   * transaction belonging to a process that no longer exists.
   *
   * Getting this wrong is not a modelling nicety either. A harness that hung
   * here would look like a flaky test with a timeout, which is precisely how a
   * real lock leak is misdiagnosed.
   */
  killDelivery(delivery: string): void {
    for (const transaction of [...this.open]) {
      if (transaction.delivery === delivery) transaction.crash()
    }
  }

  committed(table: TableName): readonly Row[] {
    return this.rows[table]
  }

  committedHas(table: TableName, columns: readonly string[], row: Row): boolean {
    const value = indexValue(table, columns, row)

    return this.rows[table].some((existing) => indexValue(table, columns, existing) === value)
  }

  append(table: TableName, row: Row): void {
    this.rows[table].push(row)
  }

  applyUpdate(table: TableName, match: Readonly<Record<string, unknown>>, changes: Row): void {
    this.rows[table] = this.rows[table].map((row) => {
      const hit = Object.entries(match).every(([column, value]) => row[column] === value)

      return hit ? { ...row, ...changes } : row
    })
  }

  /**
   * Take a reservation on an index value, waiting for the current holder.
   *
   * The wait is a promise resolved by the holder's settlement, so a scheduled
   * run has no timer in it and no ordering that depends on one. Waiters are
   * woken in arrival order — a real index does not promise that, and making it
   * deterministic here is what lets `concurrent-retry` report the same cell on
   * every run instead of a detection rate.
   */
  async acquire(transaction: Transaction, value: string): Promise<void> {
    for (;;) {
      const held = this.reservations.get(value)

      if (held === undefined) {
        this.reservations.set(value, { holder: transaction, waiters: [] })

        return
      }

      if (held.holder === transaction) return

      this.detectCycle(transaction, held.holder, value)
      this.waitingOn.set(transaction, value)

      await new Promise<void>((resolve) => held.waiters.push(resolve))

      this.waitingOn.delete(transaction)
    }
  }

  /**
   * Refuse a wait that would close a cycle.
   *
   * No strategy here should ever produce one — they all take their
   * reservations in a fixed order — so this exists to make a future one that
   * does fail with the word `deadlock` rather than hang until the suite's
   * timeout and read as an infrastructure problem.
   */
  private detectCycle(waiter: Transaction, holder: Transaction, value: string): void {
    let current: Transaction | undefined = holder

    while (current !== undefined) {
      if (current === waiter) throw new Deadlock(value)

      const blockedOn = this.waitingOn.get(current)

      current = blockedOn === undefined ? undefined : this.reservations.get(blockedOn)?.holder
    }
  }

  /**
   * Whether a delivery is currently blocked on somebody else's reservation.
   *
   * The harness releases a parked delivery when its partner has either finished
   * or got stuck, and this is the second half. Without it the only way to know
   * the partner had gone as far as it could would be to wait a while and
   * assume, which is how a fixture becomes a flake — the suite would pass on a
   * fast machine and interleave differently on a loaded CI runner.
   */
  isWaiting(delivery: string): boolean {
    for (const transaction of this.waitingOn.keys()) {
      if (transaction.delivery === delivery) return true
    }

    return false
  }

  release(transaction: Transaction, value: string): void {
    const held = this.reservations.get(value)

    if (held === undefined || held.holder !== transaction) return

    this.reservations.delete(value)
    for (const wake of held.waiters) wake()
  }

  /** Everything committed, for the harness's effect count. */
  snapshot(): Readonly<Record<TableName, readonly Row[]>> {
    return {
      charges: [...this.rows.charges],
      idempotency_keys: [...this.rows.idempotency_keys],
      gateway_calls: [...this.rows.gateway_calls],
      outbox: [...this.rows.outbox],
    }
  }
}
