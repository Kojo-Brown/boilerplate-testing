/**
 * The fixture: one container per store per run, one namespace per suite.
 *
 * This is the part of the directory a consumer copies, and every decision in
 * it is downstream of a measurement in `README.md` rather than of taste.
 *
 *   - **One container per store per run, not per suite.** "Spun up per suite"
 *     is what the phrase says and it is not what anybody should do: a Kafka
 *     broker costs eleven seconds to reach readiness, so a second suite that
 *     starts its own has paid for the whole comparison this directory is
 *     about. The container is started once, lazily, on the first suite that
 *     asks for it, and shared. What is *per suite* is the namespace.
 *
 *   - **A namespace per suite, not a reset between suites.** The matrix says a
 *     reset is either incomplete (`TRUNCATE` leaves sequences) or slow
 *     (deleting a Kafka topic is asynchronous and costs seconds). A namespace
 *     is neither, and it is the only column that is green for all three stores.
 *
 *   - **The namespace carries a per-run nonce as well as the suite name.** A
 *     namespace derived from the suite name alone is unique within a run and
 *     identical across runs, which is exactly the state a *reused* container
 *     preserves. The nonce is what makes `pnpm test:containers` twice in a row
 *     mean the same thing as running it once.
 *
 *   - **Nothing is torn down on Kafka.** Postgres schemas and Redis keys are
 *     dropped in `afterAll` because both are one immediate statement. A topic
 *     is not: `deleteTopics` returns before the topic is gone. So a reused
 *     broker accumulates one topic per suite per run, and the thing that
 *     collects them is `pnpm containers:prune`, which removes the container.
 */

import { randomUUID } from 'node:crypto'

import type { Redis as RedisClient } from 'ioredis'
import type { Client as PostgresClient } from 'pg'

import type { StoreName } from './images.ts'
import { reuseEnabled } from './daemon.ts'
import type { StartedStore } from './stores.ts'
import { startUsableStore, withPostgres, withRedis } from './stores.ts'
import { REDIS_DATABASES } from './isolation.ts'

/**
 * A short id for this process's run.
 *
 * Registered in `determinism/registry.ts` as `inert`: it is never asserted on,
 * it only has to differ between two runs that share a container.
 */
export const RUN_ID = randomUUID().slice(0, 8)

/**
 * Containers, started at most once each.
 *
 * The map holds the *promise*, not the container, so two suites that call in
 * the same tick share one start rather than racing to create two. With
 * `isolate: false` and `singleFork` in the project config, this module is
 * evaluated once for the whole run.
 */
const running = new Map<StoreName, Promise<StartedStore>>()

/** The shared container for a store, started on first use. */
export function sharedStore(store: StoreName): Promise<StartedStore> {
  const existing = running.get(store)

  if (existing !== undefined) {
    return existing
  }

  const starting = startUsableStore(store, { reuse: reuseEnabled() })

  running.set(store, starting)

  return starting
}

/** Every container this process started, for reporting and for teardown. */
export async function startedStores(): Promise<readonly StartedStore[]> {
  return Promise.all([...running.values()])
}

/** A suite name reduced to something safe in a schema, a key and a topic. */
export function slug(suiteName: string): string {
  const cleaned = suiteName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (cleaned === '') {
    throw new Error(`Suite name ${JSON.stringify(suiteName)} has no usable characters for a namespace`)
  }

  return cleaned.slice(0, 24)
}

/**
 * Redis database allocation.
 *
 * A stock Redis has sixteen numbered databases and a suite gets one, because
 * the matrix says a key prefix does not partition `DBSIZE`, `KEYS` or
 * `FLUSHDB` — the commands a test reaches for when it wants to assert about
 * the keyspace rather than about a key. Sixteen is a real ceiling and the
 * error says so rather than wrapping round, which would hand two suites the
 * same database and reintroduce exactly the collisions this avoids.
 *
 * Redis Cluster has one database, so a consumer running against a cluster
 * takes the prefix and lives with the blind spot. That is a property of the
 * deployment, not a preference.
 */
const allocatedDatabases = new Map<string, number>()

export function allocateDatabase(suiteName: string): number {
  const key = slug(suiteName)
  const existing = allocatedDatabases.get(key)

  if (existing !== undefined) {
    return existing
  }

  if (allocatedDatabases.size >= REDIS_DATABASES) {
    throw new Error(
      `All ${REDIS_DATABASES} Redis databases are allocated; suite ${JSON.stringify(suiteName)} cannot have one. ` +
        'Either share a container across fewer suites or switch this suite to prefix isolation.',
    )
  }

  const allocated = allocatedDatabases.size

  allocatedDatabases.set(key, allocated)

  return allocated
}

// ---------------------------------------------------------------------------
// Per-store fixtures
// ---------------------------------------------------------------------------

export interface PostgresSuite {
  readonly started: StartedStore
  /** The schema this suite owns. `search_path` is set on every connection it opens. */
  readonly schema: string
  /** A connected client with `search_path` already pointing at {@link schema}. */
  connect<T>(use: (client: PostgresClient) => Promise<T>): Promise<T>
}

export interface RedisSuite {
  readonly started: StartedStore
  readonly db: number
  readonly prefix: string
  connect<T>(use: (redis: RedisClient) => Promise<T>): Promise<T>
}

export interface KafkaSuite {
  readonly started: StartedStore
  readonly topic: string
  readonly groupId: string
}

/**
 * Postgres for one suite: its own schema, created before and dropped after.
 *
 * Returns an accessor rather than the fixture, because the container is
 * started in `beforeAll` and there is nothing to hand back at describe time.
 * Calling it from a test body is always safe; calling it at describe time is
 * the mistake the thrown message names.
 */
export function usePostgresSuite(suiteName: string): () => PostgresSuite {
  let suite: PostgresSuite | null = null

  beforeAll(async () => {
    const started = await sharedStore('postgres')
    const schema = `t_${slug(suiteName)}_${RUN_ID}`

    await withPostgres(started, async (client) => {
      await client.query(`create schema if not exists ${schema}`)
    })

    suite = {
      started,
      schema,
      connect: (use) =>
        withPostgres(started, async (client) => {
          await client.query(`set search_path to ${schema}`)

          return use(client)
        }),
    }
  })

  afterAll(async () => {
    if (suite === null) {
      return
    }

    const { started, schema } = suite

    suite = null

    await withPostgres(started, async (client) => {
      await client.query(`drop schema if exists ${schema} cascade`)
    })
  })

  return () => {
    if (suite === null) {
      throw new Error(`The ${suiteName} Postgres fixture is only available inside a test or a hook after beforeAll`)
    }

    return suite
  }
}

/** Redis for one suite: its own numbered database, flushed before and after. */
export function useRedisSuite(suiteName: string): () => RedisSuite {
  let suite: RedisSuite | null = null

  beforeAll(async () => {
    const started = await sharedStore('redis')
    const db = allocateDatabase(suiteName)
    const prefix = `${slug(suiteName)}:`

    // Flushed on the way in as well as on the way out: a reused container
    // still holds whatever the previous *run* left in this database, and the
    // database number is per suite, not per run.
    await withRedis(started, async (redis) => void (await redis.flushdb()), db)

    suite = {
      started,
      db,
      prefix,
      connect: (use) => withRedis(started, use, db),
    }
  })

  afterAll(async () => {
    if (suite === null) {
      return
    }

    const { started, db } = suite

    suite = null

    await withRedis(started, async (redis) => void (await redis.flushdb()), db)
  })

  return () => {
    if (suite === null) {
      throw new Error(`The ${suiteName} Redis fixture is only available inside a test or a hook after beforeAll`)
    }

    return suite
  }
}

/** Kafka for one suite: its own topic and consumer group, named per run. */
export function useKafkaSuite(suiteName: string): () => KafkaSuite {
  let suite: KafkaSuite | null = null

  beforeAll(async () => {
    const started = await sharedStore('kafka')
    const name = `${slug(suiteName).replace(/_/g, '-')}-${RUN_ID}`

    suite = { started, topic: `${name}-events`, groupId: `${name}-consumer` }
  })

  return () => {
    if (suite === null) {
      throw new Error(`The ${suiteName} Kafka fixture is only available inside a test or a hook after beforeAll`)
    }

    return suite
  }
}
