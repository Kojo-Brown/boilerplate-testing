/**
 * The isolation strategies a suite can put between itself and a container it
 * did not start fresh.
 *
 * ---------------------------------------------------------------------------
 * What is actually being compared
 * ---------------------------------------------------------------------------
 * Reuse does not break tests. Unnamespaced state breaks tests, and reuse is
 * simply the thing that stops hiding it: a container per suite hides it behind
 * a fresh filesystem, and a container per *run* — or a reused one across runs —
 * does not. So the question worth measuring is not "is reuse safe" but "which
 * of the things a suite already does about state is enough", which is what the
 * strategies below are.
 *
 * Each store gets the same three shapes, and the point of the exercise is that
 * they do not behave the same way:
 *
 *   - **nothing** — the suite writes where it writes and hopes.
 *   - **a reset** — the thing people reach for first: `TRUNCATE`, `FLUSHDB`,
 *     delete the topic. Cheap to write, and this is where the differences are.
 *   - **a namespace** — a schema, a key prefix or a numbered database, a topic
 *     name: state the suite cannot collide with because it is somewhere else.
 *
 * ---------------------------------------------------------------------------
 * Every strategy gets its own address space
 * ---------------------------------------------------------------------------
 * The matrix runs every strategy against one long-lived container, which is
 * the situation being studied — but it means the strategies would otherwise
 * pollute each other, and a cell would be reporting the previous row rather
 * than its own two suites. So each strategy is given a slot (its index) and
 * derives its schema name, key prefix, database number and topic name from it.
 * The only state shared inside a cell is what that strategy's own first suite
 * left for its second, which is exactly the thing under test.
 */

import type { StartedStore } from './stores.ts'
import { withKafkaAdmin, withPostgres, withRedis } from './stores.ts'
import type { StoreName } from './images.ts'

/** Where a Postgres suite writes. */
export interface PostgresContext {
  readonly schema: string
}

/** Where a Redis suite writes. */
export interface RedisContext {
  readonly db: number
  readonly prefix: string
}

/**
 * Where a Kafka suite writes.
 *
 * Two topics, because the suite does two different things and mixing them
 * would make one fault mask another: `topic` is seeded once and only read,
 * `outbox` is only appended to. A single topic that is both seeded and
 * appended to leaves the returning consumer group with something new to read
 * every run, which hides the offset residue behind the log residue.
 */
export interface KafkaContext {
  /** Seeded when it is created, then read. */
  readonly topic: string
  /** Appended to by every suite that runs. */
  readonly outbox: string
  readonly groupId: string
}

export interface StoreContexts {
  readonly postgres: PostgresContext
  readonly redis: RedisContext
  readonly kafka: KafkaContext
}

/** The context type for a store. */
export type ContextFor<S extends StoreName> = StoreContexts[S]

/**
 * One isolation strategy, as a suite's `beforeAll` would apply it.
 *
 * `enter` is called once per suite with a 1-based run number, and returns
 * where that suite writes. A reset strategy returns the same place every time
 * and clears it; a namespace strategy returns a different place. That single
 * signature covers both, which is what makes them comparable at all.
 */
export interface Strategy<S extends StoreName> {
  readonly key: string
  readonly store: S
  /** One line for the README table. */
  readonly summary: string
  enter(started: StartedStore, run: number, slot: number): Promise<ContextFor<S>>
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

/**
 * The three tables the Postgres workload uses.
 *
 * Three rather than one because the residues they expose are different, and a
 * single table would let one behaviour's setup destroy another's evidence.
 * `orders` carries rows, `receipts` carries a sequence, `customers` carries a
 * uniqueness constraint.
 */
export const POSTGRES_TABLES = ['orders', 'receipts', 'customers'] as const

const CREATE_TABLES = [
  'create table if not exists orders (id bigserial primary key, ref text not null unique, total_cents integer not null)',
  'create table if not exists receipts (id bigserial primary key, note text not null)',
  'create table if not exists customers (email text primary key)',
] as const

async function ensureSchema(started: StartedStore, schema: string): Promise<void> {
  await withPostgres(started, async (client) => {
    await client.query(`create schema if not exists ${schema}`)
    await client.query(`set search_path to ${schema}`)

    for (const statement of CREATE_TABLES) {
      await client.query(statement)
    }
  })
}

async function truncateTables(started: StartedStore, schema: string, restartIdentity: boolean): Promise<void> {
  await withPostgres(started, async (client) => {
    await client.query(`set search_path to ${schema}`)
    await client.query(
      `truncate ${POSTGRES_TABLES.join(', ')}${restartIdentity ? ' restart identity' : ''} cascade`,
    )
  })
}

const postgresSchema = (slot: number, suffix = ''): string => `suite_${slot}${suffix}`

export const POSTGRES_STRATEGIES: readonly Strategy<'postgres'>[] = [
  {
    key: 'none',
    store: 'postgres',
    summary: 'Write to the same schema every time and clean up nothing.',
    async enter(started, _run, slot) {
      const schema = postgresSchema(slot)

      await ensureSchema(started, schema)

      return { schema }
    },
  },
  {
    key: 'truncate',
    store: 'postgres',
    summary: '`TRUNCATE` every table between suites — the reset almost everybody writes first.',
    async enter(started, _run, slot) {
      const schema = postgresSchema(slot)

      await ensureSchema(started, schema)
      await truncateTables(started, schema, false)

      return { schema }
    },
  },
  {
    key: 'truncate-restart',
    store: 'postgres',
    summary: '`TRUNCATE … RESTART IDENTITY`, which is the same statement plus the sequences.',
    async enter(started, _run, slot) {
      const schema = postgresSchema(slot)

      await ensureSchema(started, schema)
      await truncateTables(started, schema, true)

      return { schema }
    },
  },
  {
    key: 'schema-per-suite',
    store: 'postgres',
    summary: 'Create a schema per suite and set `search_path` to it. Nothing is shared, so nothing is reset.',
    async enter(started, run, slot) {
      const schema = postgresSchema(slot, `_run${run}`)

      await ensureSchema(started, schema)

      return { schema }
    },
  },
]

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

/**
 * Redis numbered databases.
 *
 * A stock Redis serves 16 of them (`databases 16` in the default config), and
 * they are the cheapest namespace in this file: `SELECT n` and everything a
 * suite does is invisible to every other one, `DBSIZE` and `KEYS` included.
 * They are also the one namespace here that a cluster does not have, which is
 * why the recommendation in `README.md` is not simply "use a database per
 * suite".
 */
export const REDIS_DATABASES = 16

/** Databases 8..15 are handed out per suite; 0..7 belong to a strategy slot. */
const PER_SUITE_DB_BASE = 8

export const REDIS_STRATEGIES: readonly Strategy<'redis'>[] = [
  {
    key: 'none',
    store: 'redis',
    summary: 'One database, one key prefix, nothing cleared.',
    async enter(_started, _run, slot) {
      return { db: slot, prefix: 'cache:' }
    },
  },
  {
    key: 'flushdb',
    store: 'redis',
    summary: '`FLUSHDB` between suites. The reset, and for Redis it is one command and it is total.',
    async enter(started, _run, slot) {
      await withRedis(started, async (redis) => void (await redis.flushdb()), slot)

      return { db: slot, prefix: 'cache:' }
    },
  },
  {
    key: 'prefix-per-suite',
    store: 'redis',
    summary: 'A key prefix per suite. The namespace that works in a cluster, and the one with a blind spot.',
    async enter(_started, run, slot) {
      return { db: slot, prefix: `suite${run}:` }
    },
  },
  {
    key: 'db-per-suite',
    store: 'redis',
    summary: 'A numbered database per suite. A namespace that `DBSIZE` and `KEYS` also respect.',
    async enter(_started, run, _slot) {
      return { db: PER_SUITE_DB_BASE + (run % (REDIS_DATABASES - PER_SUITE_DB_BASE)), prefix: 'cache:' }
    },
  },
]

// ---------------------------------------------------------------------------
// Kafka
// ---------------------------------------------------------------------------

/**
 * Wait for a topic to disappear from cluster metadata.
 *
 * `deleteTopics` returns as soon as the controller has accepted the request,
 * not when the topic is gone: deletion is asynchronous, and a `createTopics`
 * issued too soon fails with `TOPIC_ALREADY_EXISTS` against a topic that is
 * being deleted. Nothing in the Postgres or Redis column of this comparison
 * has an equivalent — `TRUNCATE` and `FLUSHDB` have both happened by the time
 * they return — and it is the single largest cost in the whole reset column.
 */
export async function awaitTopicGone(started: StartedStore, topic: string, budgetMs = 30_000): Promise<number> {
  const startedAt = performance.now()

  for (;;) {
    const topics = await withKafkaAdmin(started, (admin) => admin.listTopics())

    if (!topics.includes(topic)) {
      return Math.round(performance.now() - startedAt)
    }

    if (performance.now() - startedAt > budgetMs) {
      throw new Error(`Topic ${topic} was still in cluster metadata ${budgetMs}ms after deleteTopics returned`)
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const kafkaTopic = (slot: number, suffix = ''): string => `orders-s${slot}${suffix}`

const kafkaOutbox = (slot: number, suffix = ''): string => `outbox-s${slot}${suffix}`

const kafkaGroup = (slot: number, suffix = ''): string => `orders-consumer-s${slot}${suffix}`

export const KAFKA_STRATEGIES: readonly Strategy<'kafka'>[] = [
  {
    key: 'none',
    store: 'kafka',
    summary: 'One pair of topics, one consumer group, for every suite that ever runs.',
    async enter(_started, _run, slot) {
      return { topic: kafkaTopic(slot), outbox: kafkaOutbox(slot), groupId: kafkaGroup(slot) }
    },
  },
  {
    key: 'delete-topic',
    store: 'kafka',
    summary: 'Delete the topics between suites, and wait for the deletion to reach cluster metadata.',
    async enter(started, _run, slot) {
      const topic = kafkaTopic(slot)
      const outbox = kafkaOutbox(slot)
      const existing = await withKafkaAdmin(started, (admin) => admin.listTopics())
      const doomed = [topic, outbox].filter((name) => existing.includes(name))

      if (doomed.length > 0) {
        await withKafkaAdmin(started, (admin) => admin.deleteTopics({ topics: doomed }))

        for (const name of doomed) {
          await awaitTopicGone(started, name)
        }
      }

      return { topic, outbox, groupId: kafkaGroup(slot) }
    },
  },
  {
    key: 'group-per-suite',
    store: 'kafka',
    summary: 'A consumer group per suite, sharing the topics. Fixes the offsets and nothing else.',
    async enter(_started, run, slot) {
      return { topic: kafkaTopic(slot), outbox: kafkaOutbox(slot), groupId: kafkaGroup(slot, `-run${run}`) }
    },
  },
  {
    key: 'topic-and-group-per-suite',
    store: 'kafka',
    summary: 'A topic and a consumer group per suite. Nothing is shared, and nothing has to be deleted.',
    async enter(_started, run, slot) {
      return {
        topic: kafkaTopic(slot, `-run${run}`),
        outbox: kafkaOutbox(slot, `-run${run}`),
        groupId: kafkaGroup(slot, `-run${run}`),
      }
    },
  },
]

/** Every strategy, keyed by store, in the order the README reports them. */
export const STRATEGIES = {
  postgres: POSTGRES_STRATEGIES,
  redis: REDIS_STRATEGIES,
  kafka: KAFKA_STRATEGIES,
} as const satisfies { readonly [S in StoreName]: readonly Strategy<S>[] }
