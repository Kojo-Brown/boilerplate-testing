/**
 * The suite whose state is the subject: nine behaviours, three per store,
 * written the way somebody would write them against a container they believed
 * was fresh.
 *
 * ---------------------------------------------------------------------------
 * Why these nine
 * ---------------------------------------------------------------------------
 * Each one is chosen to depend on a *different* kind of leftover, because the
 * interesting result in `matrix.ts` is not "does reuse leak" (it does) but
 * "which reset misses what". A suite of nine variations on "the table has rows
 * in it" would make every reset look complete.
 *
 * | Store | Behaviour | The leftover it trips on |
 * | --- | --- | --- |
 * | Postgres | `counts-rows` | rows |
 * | Postgres | `first-receipt-id` | a sequence, which `TRUNCATE` does not touch |
 * | Postgres | `rejects-duplicate-email` | a unique index, which fails in *setup* |
 * | Redis | `misses-cold-cache` | a key |
 * | Redis | `acquires-lock` | a key with a TTL still running |
 * | Redis | `counts-its-own-keys` | the keyspace, which a prefix does not partition |
 * | Kafka | `creates-topics` | topic metadata, which fails in *setup* |
 * | Kafka | `replays-seeded-events` | committed consumer-group offsets |
 * | Kafka | `counts-its-own-outbox` | the log, which cannot be truncated in place |
 *
 * ---------------------------------------------------------------------------
 * Failure is thrown, not asserted
 * ---------------------------------------------------------------------------
 * These run inside a matrix rather than inside `it()`, so they signal failure
 * by throwing {@link BehaviourFailure} — one exception type the runner can tell
 * apart from a bug in the harness. {@link BehaviourTimeout} is the second, and
 * it exists because one of the nine does not fail: it *hangs*. A consumer group
 * that has already read everything receives nothing, forever, and the test that
 * waits for a message is red only once the runner's own timeout fires. That
 * distinction is a finding rather than an implementation detail, so it has a
 * type.
 */

import type { EachMessagePayload } from 'kafkajs'

import type { KafkaContext, PostgresContext, RedisContext } from './isolation.ts'
import type { StoreName } from './images.ts'
import type { StartedStore } from './stores.ts'
import { withKafkaAdmin, withKafkaConsumer, withKafkaProducer, withPostgres, withRedis } from './stores.ts'

/** A behaviour's assertion did not hold. */
export class BehaviourFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BehaviourFailure'
  }
}

/** A behaviour never got an answer at all. */
export class BehaviourTimeout extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BehaviourTimeout'
  }
}

function require_(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new BehaviourFailure(message)
  }
}

export interface Behaviour<Ctx> {
  readonly key: string
  readonly store: StoreName
  /** The title the equivalent `it()` would carry. */
  readonly title: string
  /** The leftover this behaviour trips on, for the README table. */
  readonly leftover: string
  run(started: StartedStore, context: Ctx, suiteRun: number): Promise<void>
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

const POSTGRES_UNIQUE_VIOLATION = '23505'

export const POSTGRES_BEHAVIOURS: readonly Behaviour<PostgresContext>[] = [
  {
    key: 'counts-rows',
    store: 'postgres',
    title: 'counts the orders it inserted',
    leftover: 'rows',
    async run(started, context, suiteRun) {
      await withPostgres(started, async (client) => {
        await client.query(`set search_path to ${context.schema}`)

        for (const index of [1, 2, 3]) {
          await client.query('insert into orders (ref, total_cents) values ($1, $2)', [
            `run${suiteRun}-order-${index}`,
            index * 100,
          ])
        }

        const { rows } = await client.query<{ total: string }>('select count(*) as total from orders')
        const total = Number(rows[0]?.total ?? -1)

        require_(total === 3, `expected 3 orders, found ${total}`)
      })
    },
  },
  {
    key: 'first-receipt-id',
    store: 'postgres',
    title: 'assigns the first receipt id 1',
    leftover: 'a sequence',
    async run(started, context, suiteRun) {
      await withPostgres(started, async (client) => {
        await client.query(`set search_path to ${context.schema}`)

        const { rows } = await client.query<{ id: string }>(
          'insert into receipts (note) values ($1) returning id',
          [`run${suiteRun}`],
        )
        const id = Number(rows[0]?.id ?? -1)

        require_(id === 1, `expected the first receipt to be id 1, got ${id}`)
      })
    },
  },
  {
    key: 'rejects-duplicate-email',
    store: 'postgres',
    title: 'rejects a customer whose email is already registered',
    leftover: 'a unique index',
    async run(started, context) {
      await withPostgres(started, async (client) => {
        await client.query(`set search_path to ${context.schema}`)

        // Arrange. Under residue this is where the behaviour dies: the row it
        // is about to rely on is already there, so the test fails before it
        // has asserted anything.
        try {
          await client.query('insert into customers (email) values ($1)', ['ada@example.test'])
        } catch (error) {
          const code = (error as { code?: string }).code

          throw new BehaviourFailure(
            code === POSTGRES_UNIQUE_VIOLATION
              ? 'the customer this test registers was already registered before it started'
              : `registering the customer failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }

        let rejected = false

        try {
          await client.query('insert into customers (email) values ($1)', ['ada@example.test'])
        } catch (error) {
          rejected = (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
        }

        require_(rejected, 'expected the duplicate registration to be rejected')
      })
    },
  },
]

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

export const REDIS_BEHAVIOURS: readonly Behaviour<RedisContext>[] = [
  {
    key: 'misses-cold-cache',
    store: 'redis',
    title: 'misses the cache before anything has filled it',
    leftover: 'a key',
    async run(started, context) {
      await withRedis(
        started,
        async (redis) => {
          const before = await redis.get(`${context.prefix}user:1`)

          require_(before === null, `expected a cache miss, found ${JSON.stringify(before)}`)

          await redis.set(`${context.prefix}user:1`, 'Ada')
        },
        context.db,
      )
    },
  },
  {
    key: 'acquires-lock',
    store: 'redis',
    title: 'acquires the orders lock',
    leftover: 'a key with a TTL still running',
    async run(started, context) {
      await withRedis(
        started,
        async (redis) => {
          const acquired = await redis.set(`${context.prefix}lock:orders`, 'held', 'EX', 30, 'NX')

          if (acquired !== 'OK') {
            const ttl = await redis.ttl(`${context.prefix}lock:orders`)

            throw new BehaviourFailure(`the lock was already held, with ${ttl}s left on its TTL`)
          }
        },
        context.db,
      )
    },
  },
  {
    key: 'counts-its-own-keys',
    store: 'redis',
    title: 'leaves exactly the two keys it wrote',
    leftover: 'the keyspace',
    async run(started, context) {
      await withRedis(
        started,
        async (redis) => {
          const size = await redis.dbsize()

          require_(size === 2, `expected 2 keys in the database, found ${size}`)
        },
        context.db,
      )
    },
  },
]

// ---------------------------------------------------------------------------
// Kafka
// ---------------------------------------------------------------------------

/** The events a newly created topic is seeded with. */
export const KAFKA_SEED_COUNT = 3

/** Key carried by every seeded event, so a drain can tell them apart. */
export const KAFKA_SEED_KEY = 'seed'

interface DrainOptions {
  readonly budgetMs: number
  /** Stop once this long has passed with no new message. */
  readonly quietMs: number
}

interface DrainedMessage {
  readonly key: string
  readonly value: string
}

/**
 * Read a topic from the beginning and stop when it goes quiet.
 *
 * A count assertion needs to know the log has been read to its end, and there
 * is no "end" event to wait for — so the stopping rule is silence. `quietMs`
 * has to be long enough to cover a fetch round trip and short enough that
 * twenty-odd drains do not dominate the suite; 1s is both here, and the budget
 * is what bounds the case where nothing arrives at all.
 */
async function drain(
  started: StartedStore,
  groupId: string,
  topic: string,
  options: DrainOptions,
): Promise<readonly DrainedMessage[]> {
  const collected: DrainedMessage[] = []
  const startedAt = performance.now()
  let lastMessageAt: number | null = null

  await withKafkaConsumer(started, groupId, async (consumer) => {
    await consumer.subscribe({ topic, fromBeginning: true })
    await consumer.run({
      eachMessage: async ({ message }: EachMessagePayload) => {
        collected.push({
          key: message.key?.toString() ?? '',
          value: message.value?.toString() ?? '',
        })
        lastMessageAt = performance.now()
      },
    })

    for (;;) {
      const now = performance.now()

      if (lastMessageAt !== null && now - lastMessageAt > options.quietMs) {
        return
      }

      if (now - startedAt > options.budgetMs) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })

  return collected
}

export const KAFKA_BEHAVIOURS: readonly Behaviour<KafkaContext>[] = [
  {
    key: 'creates-topics',
    store: 'kafka',
    title: 'creates the topics it reads from and writes to',
    leftover: 'topic metadata',
    async run(started, context) {
      const created = await withKafkaAdmin(started, (admin) =>
        admin.createTopics({
          topics: [
            { topic: context.topic, numPartitions: 1 },
            { topic: context.outbox, numPartitions: 1 },
          ],
          waitForLeaders: true,
        }),
      )

      if (!created) {
        throw new BehaviourFailure(
          `${context.topic} and ${context.outbox} already existed, so this suite did not create them`,
        )
      }

      // Seeding belongs to whoever created the topic. Making it conditional on
      // creation is the shape a fixture takes once a container is reused —
      // seeding is expensive, so it is done when the topic is new — and it is
      // exactly what leaves the next suite with a consumer group that has
      // already read everything there is.
      await withKafkaProducer(started, (producer) =>
        producer.send({
          topic: context.topic,
          messages: Array.from({ length: KAFKA_SEED_COUNT }, (_unused, index) => ({
            key: KAFKA_SEED_KEY,
            value: `seeded-${index}`,
          })),
        }),
      )
    },
  },
  {
    key: 'replays-seeded-events',
    store: 'kafka',
    title: 'replays the seeded events to the orders consumer',
    leftover: 'committed consumer-group offsets',
    async run(started, context) {
      const messages = await drain(started, context.groupId, context.topic, { budgetMs: 8_000, quietMs: 1_000 })

      if (messages.length === 0) {
        throw new BehaviourTimeout(
          `the consumer group ${context.groupId} received nothing in 8s: its committed offsets are already at the end of ${context.topic}`,
        )
      }

      const seeded = messages.filter((message) => message.key === KAFKA_SEED_KEY)

      require_(seeded.length === KAFKA_SEED_COUNT, `expected ${KAFKA_SEED_COUNT} seeded events, saw ${seeded.length}`)
    },
  },
  {
    key: 'counts-its-own-outbox',
    store: 'kafka',
    title: 'publishes one event and finds one event in the outbox',
    leftover: 'the log',
    async run(started, context, suiteRun) {
      await withKafkaProducer(started, (producer) =>
        producer.send({
          topic: context.outbox,
          messages: [{ key: `append-run${suiteRun}`, value: `appended-${suiteRun}` }],
        }),
      )

      const messages = await drain(started, `${context.groupId}-census-run${suiteRun}`, context.outbox, {
        budgetMs: 8_000,
        quietMs: 1_000,
      })

      require_(messages.length === 1, `expected 1 event in ${context.outbox}, read ${messages.length}`)
    },
  },
]

/** Every behaviour, keyed by store, in the order the README reports them. */
export const BEHAVIOURS = {
  postgres: POSTGRES_BEHAVIOURS,
  redis: REDIS_BEHAVIOURS,
  kafka: KAFKA_BEHAVIOURS,
} as const
