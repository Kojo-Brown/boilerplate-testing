/**
 * The seven things the suite asserts about an order, and where each of them has
 * to stand to see it.
 *
 * ---------------------------------------------------------------------------
 * Why `observes` is a field rather than a comment
 * ---------------------------------------------------------------------------
 * The detection matrix is not really about faults. It is about *vantage points*:
 * a strategy can only miss a fault the suite was never in a position to see,
 * and where the suite is standing is decided by the behaviour, not by the bug.
 * Four of these behaviours read back through the same session that wrote, which
 * no strategy interferes with. Two need a different session. One needs to be
 * outside a transaction altogether.
 *
 * Declaring that on the behaviour makes the matrix explainable rather than
 * merely true — every miss and every false alarm in `README.md` lands on a row
 * whose `observes` says in advance why it could. `catalogue.test.ts` checks the
 * declaration against what the behaviour actually does, so the field cannot
 * drift into decoration.
 *
 * ---------------------------------------------------------------------------
 * Every behaviour owns its own order reference
 * ---------------------------------------------------------------------------
 * Derived from the behaviour key, so two behaviours in the same run cannot
 * collide even under `none`. That is deliberate and it is what keeps the two
 * measurements apart: leakage between tests is what `leakage.ts` measures, with
 * a probe written to collide on purpose, and it has no business appearing in
 * the detection matrix as a column of noise attached to whichever behaviour
 * happened to run second.
 */

import type { Fault } from './faults.ts'
import type { OrderInput } from './orders.ts'
import { ensureRefIndex, ORDER_PLACED_CHANNEL, placeOrder, refIndexExists } from './orders.ts'
import type { TestEnv } from './strategies.ts'

/** Where the assertion has to stand. */
export const VANTAGES = ['same-session', 'another-session', 'outside-a-transaction'] as const

export type Vantage = (typeof VANTAGES)[number]

export const VANTAGE_NOTES: Readonly<Record<Vantage, string>> = {
  'same-session': 'Reads back through the connection that wrote. No strategy can interfere.',
  'another-session': 'Reads through a second connection, which only ever sees committed data.',
  'outside-a-transaction': 'Runs a statement Postgres refuses inside a transaction block.',
}

export interface Behaviour {
  readonly key: string
  readonly summary: string
  readonly observes: Vantage
  /** Throws when the behaviour does not hold. */
  run(env: TestEnv, faults: ReadonlySet<Fault>): Promise<void>
}

/** How long a notification is waited for. */
export const NOTIFY_BUDGET_MS = 3_000

/** The order each behaviour places. One `ref` per behaviour, by construction. */
export const orderFor = (behaviourKey: string): OrderInput => ({
  ref: `ORD-${behaviourKey.toUpperCase()}`,
  customer: 'ada@example.test',
  lines: [
    { sku: 'WIDGET', cents: 1_200 },
    { sku: 'GASKET', cents: 300 },
  ],
})

const TOTAL_CENTS = 1_500

const expect = (condition: boolean, detail: string): void => {
  if (!condition) {
    throw new Error(detail)
  }
}

const scalar = async (
  run: (text: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>,
  text: string,
  values: readonly unknown[],
): Promise<number> => {
  const result = await run(text, values)

  return Number(Object.values(result.rows[0] ?? {})[0] ?? Number.NaN)
}

export const BEHAVIOURS: readonly Behaviour[] = [
  {
    key: 'total',
    summary: 'The order total is the sum of its lines.',
    observes: 'same-session',
    async run(env, faults) {
      const order = orderFor('total')
      const placed = await placeOrder(env.db, order, faults)
      const total = await scalar(
        (text, values) => env.db.query(text, values),
        'select total_cents from orders where id = $1',
        [placed.id],
      )

      expect(total === TOTAL_CENTS, `total_cents was ${total}, expected ${TOTAL_CENTS}`)
    },
  },
  {
    key: 'lines',
    summary: 'Every line on the order was written.',
    observes: 'same-session',
    async run(env, faults) {
      const order = orderFor('lines')
      const placed = await placeOrder(env.db, order, faults)
      const lines = await scalar(
        (text, values) => env.db.query(text, values),
        'select count(*) from order_lines where order_id = $1',
        [placed.id],
      )

      expect(lines === order.lines.length, `the order has ${lines} line(s), expected ${order.lines.length}`)
    },
  },
  {
    key: 'stock',
    summary: 'Placing the order takes one of each sku out of stock.',
    observes: 'same-session',
    async run(env, faults) {
      const order = orderFor('stock')

      await placeOrder(env.db, order, faults)

      const onHand = await scalar(
        (text, values) => env.db.query(text, values),
        'select on_hand from stock where sku = $1',
        ['WIDGET'],
      )

      expect(onHand === 9, `WIDGET stock is ${onHand}, expected 9`)
    },
  },
  {
    key: 'audit',
    summary: 'Placing the order writes exactly one audit row for it.',
    observes: 'same-session',
    async run(env, faults) {
      const order = orderFor('audit')

      await placeOrder(env.db, order, faults)

      // Scoped to this order's reference rather than counting the table, so
      // that residue from another behaviour in the same run cannot reach it.
      // The unscoped count is `leakage.ts`'s job.
      const rows = await scalar(
        (text, values) => env.db.query(text, values),
        'select count(*) from audit_log where ref = $1',
        [order.ref],
      )

      expect(rows === 1, `there are ${rows} audit rows for ${order.ref}, expected 1`)
    },
  },
  {
    key: 'durability',
    summary: 'Another session can see the order once it has been placed.',
    observes: 'another-session',
    async run(env, faults) {
      const order = orderFor('durability')
      const placed = await placeOrder(env.db, order, faults)
      const seen = await env.observe(async (client) => {
        const result = await client.query<{ count: string }>('select count(*) as count from orders where id = $1', [
          placed.id,
        ])

        return Number(result.rows[0]?.count ?? 0)
      })

      expect(seen === 1, `a second session sees ${seen} row(s) for order ${placed.id}, expected 1`)
    },
  },
  {
    key: 'notification',
    summary: 'A listener on another session is told the order was placed.',
    observes: 'another-session',
    async run(env, faults) {
      const order = orderFor('notification')

      await env.observe(async (listener) => {
        const received: string[] = []

        listener.on('notification', (message) => {
          if (message.channel === ORDER_PLACED_CHANNEL && message.payload !== undefined) {
            received.push(message.payload)
          }
        })

        await listener.query(`listen ${ORDER_PLACED_CHANNEL}`)
        await placeOrder(env.db, order, faults)

        // node-postgres surfaces a notification when the connection next hears
        // from the server, so the wait is a round trip rather than a sleep.
        // Real time, because what is being waited for is a commit in another
        // session reaching this one.
        const deadline = performance.now() + NOTIFY_BUDGET_MS

        while (!received.includes(order.ref) && performance.now() < deadline) {
          await listener.query('select 1')
          await new Promise((resolve) => setTimeout(resolve, 25))
        }

        expect(
          received.includes(order.ref),
          `no ${ORDER_PLACED_CHANNEL} notification for ${order.ref} within ${NOTIFY_BUDGET_MS}ms` +
            (received.length === 0 ? '' : ` (heard ${received.join(', ')})`),
        )
      })
    },
  },
  {
    key: 'migration',
    summary: 'The lookup index can be built without locking the table.',
    observes: 'outside-a-transaction',
    async run(env, faults) {
      await ensureRefIndex(env.db, faults)

      expect(await refIndexExists(env.db), 'the ref index does not exist after the migration ran')
    },
  },
]

export const BEHAVIOUR_KEYS: readonly string[] = BEHAVIOURS.map((behaviour) => behaviour.key)

export const behaviourFor = (key: string): Behaviour => {
  const behaviour = BEHAVIOURS.find((candidate) => candidate.key === key)

  if (behaviour === undefined) {
    throw new Error(`No behaviour named ${key}`)
  }

  return behaviour
}
