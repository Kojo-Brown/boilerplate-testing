/**
 * The other half: run the same test twice and see what the first one left for
 * the second.
 *
 * ---------------------------------------------------------------------------
 * Why this is a separate matrix
 * ---------------------------------------------------------------------------
 * Detection and leakage are the two questions people ask about an isolation
 * strategy and they are usually answered together, which is how "transaction
 * rollback is the fast one" survives as advice. They are different questions
 * about different things: leakage asks what the strategy *removes*, detection
 * asks what it *prevents the suite from seeing*, and a strategy can be perfect
 * at the first and expensive at the second. `rollback-savepoint` is.
 *
 * So this matrix is deliberately free of the detection matrix's machinery.
 * There are no faults here; the subject is correct everywhere. Each probe runs
 * twice against one strategy run, the first run is asserted green — a strategy
 * whose first run already fails is broken, not leaky, and its second column
 * would mean nothing — and the cell is what the second run did.
 *
 * ---------------------------------------------------------------------------
 * Two probes that differ in one thing
 * ---------------------------------------------------------------------------
 * `rows` and `plain-insert` both count rows in `orders` and both are written to
 * collide. The only difference is that `rows` goes through the subject, which
 * opens a transaction and commits it, and `plain-insert` writes directly. Under
 * every strategy but one they agree. Under `rollback` they do not, and that
 * disagreement is the whole finding: the naive wrapper is not weak, it is
 * *conditional*, and the condition is whether the code under test manages a
 * transaction. A suite that only ever tests single-statement repositories will
 * never see it fail.
 */

import type { Queryable } from './orders.ts'
import { placeOrder } from './orders.ts'
import type { Server, Strategy, TestEnv } from './strategies.ts'
import { connect, STRATEGIES } from './strategies.ts'

export const OUTCOMES = ['pass', 'fail'] as const

export type Outcome = (typeof OUTCOMES)[number]

export interface Probe {
  readonly key: string
  readonly summary: string
  /** What has to leak for the second run to fail. */
  readonly residue: string
  /** Throws when the probe does not hold. `run` is 1-based. */
  check(env: TestEnv, run: number): Promise<void>
}

const count = async (db: Queryable, text: string, values: readonly unknown[] = []): Promise<number> => {
  const result = await db.query<Record<string, string>>(text, values)

  return Number(Object.values(result.rows[0] ?? {})[0] ?? Number.NaN)
}

const expect = (condition: boolean, detail: string): void => {
  if (!condition) {
    throw new Error(detail)
  }
}

export const PROBES: readonly Probe[] = [
  {
    key: 'rows',
    summary: 'Place one order through the subject, then count the orders table.',
    residue: 'Rows the subject committed.',
    async check(env, run) {
      await placeOrder(env.db, {
        ref: `LEAK-ROWS-${run}`,
        customer: 'ada@example.test',
        lines: [{ sku: 'WIDGET', cents: 100 }],
      })

      const orders = await count(env.db, 'select count(*) from orders')

      expect(orders === 1, `the orders table holds ${orders} row(s) after placing one order`)
    },
  },
  {
    key: 'plain-insert',
    summary: 'Insert one order row directly, with no transaction of the subject’s own, then count.',
    residue: 'Rows written outside any transaction the subject opened.',
    async check(env, run) {
      await env.db.query('insert into orders (ref, customer) values ($1, $2)', [`LEAK-PLAIN-${run}`, 'ada@example.test'])

      const orders = await count(env.db, 'select count(*) from orders')

      expect(orders === 1, `the orders table holds ${orders} row(s) after inserting one`)
    },
  },
  {
    key: 'ids',
    summary: 'Place one order and assert it is order number one.',
    residue: 'A sequence that has been advanced. Neither TRUNCATE nor ROLLBACK gives the number back.',
    async check(env, run) {
      const placed = await placeOrder(env.db, {
        ref: `LEAK-IDS-${run}`,
        customer: 'ada@example.test',
        lines: [{ sku: 'WIDGET', cents: 100 }],
      })

      expect(placed.id === 1, `the first order of the test got id ${placed.id}`)
    },
  },
  {
    key: 'audit',
    summary: 'Place one order and count the whole audit_log table.',
    residue: 'Rows in the one table the hand-written TRUNCATE list does not name.',
    async check(env, run) {
      await placeOrder(env.db, {
        ref: `LEAK-AUDIT-${run}`,
        customer: 'ada@example.test',
        lines: [{ sku: 'WIDGET', cents: 100 }],
      })

      const rows = await count(env.db, 'select count(*) from audit_log')

      expect(rows === 1, `audit_log holds ${rows} row(s) after placing one order`)
    },
  },
  {
    key: 'ddl',
    summary: 'Add a column to orders, having first checked it is not there.',
    residue: 'A schema change. Emptying tables does not undo one.',
    async check(env) {
      const existing = await count(
        env.db,
        `select count(*) from information_schema.columns
          where table_schema = current_schema() and table_name = 'orders' and column_name = 'scratch'`,
      )

      expect(existing === 0, 'the scratch column was already on orders before this test added it')

      await env.db.query('alter table orders add column scratch integer')
    },
  },
]

export const PROBE_KEYS: readonly string[] = PROBES.map((probe) => probe.key)

/** One (strategy, probe) pair, run twice. */
export interface Cell {
  readonly strategy: string
  readonly probe: string
  readonly firstRun: Outcome
  readonly secondRun: Outcome
  /** The failure from the second run, when there was one. */
  readonly detail: string | null
}

const databaseName = (strategy: Strategy, probe: Probe, nonce: string): string =>
  `leak_${strategy.key}_${probe.key}_${nonce}`.toLowerCase().replace(/[^a-z0-9_]/g, '_')

async function attempt(env: TestEnv, probe: Probe, run: number): Promise<{ outcome: Outcome; detail: string | null }> {
  try {
    await probe.check(env, run)

    return { outcome: 'pass', detail: null }
  } catch (error) {
    return { outcome: 'fail', detail: error instanceof Error ? error.message : String(error) }
  }
}

/** Run one probe twice under one strategy. */
export async function runPair(server: Server, strategy: Strategy, probe: Probe, nonce: string): Promise<Cell> {
  const database = databaseName(strategy, probe, nonce)
  const admin = await connect(server.adminUri)

  await admin.client.query(`create database ${database}`)

  try {
    const strategyRun = await strategy.open(server, database)
    const outcomes: { outcome: Outcome; detail: string | null }[] = []

    try {
      for (const run of [1, 2]) {
        const env = await strategyRun.beginTest()

        try {
          outcomes.push(await attempt(env, probe, run))
        } finally {
          await strategyRun.endTest()
        }
      }
    } finally {
      await strategyRun.close()
    }

    const [first, second] = outcomes

    return {
      strategy: strategy.key,
      probe: probe.key,
      firstRun: first?.outcome ?? 'fail',
      secondRun: second?.outcome ?? 'fail',
      detail: second?.detail ?? null,
    }
  } finally {
    await admin.client.query(`drop database if exists ${database} with (force)`)
    await admin.end()
  }
}

/** Every pair. Independent by construction — one database each — so they overlap. */
export async function runLeakage(server: Server, nonce: string, concurrency = 4): Promise<readonly Cell[]> {
  const pending = STRATEGIES.flatMap((strategy) => PROBES.map((probe) => ({ strategy, probe })))
  const cells: Cell[] = []
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next

      next += 1

      const job = pending[index]

      if (job === undefined) {
        return
      }

      cells.push(await runPair(server, job.strategy, job.probe, nonce))
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()))

  return cells
}

export const cellFor = (cells: readonly Cell[], strategy: string, probe: string): Cell => {
  const cell = cells.find((candidate) => candidate.strategy === strategy && candidate.probe === probe)

  if (cell === undefined) {
    throw new Error(`No leakage cell for ${strategy}/${probe}`)
  }

  return cell
}
