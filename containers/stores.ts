/**
 * Starting Postgres, Redis and Kafka, and the one thing every guide to
 * Testcontainers leaves out: knowing when they are actually usable.
 *
 * ---------------------------------------------------------------------------
 * `start()` resolving is not readiness
 * ---------------------------------------------------------------------------
 * Every container module ships a wait strategy, and the pitch for using the
 * module rather than a raw `GenericContainer` is that somebody has already
 * worked out what readiness means for that server. That is true for two of the
 * three here and false for the third, and the difference is not visible from
 * the outside — all three `start()` calls resolve, and only one of them is
 * lying.
 *
 *   - **Postgres** injects its own `HEALTHCHECK` (`pg_isready` every 250ms) and
 *     waits for it. The official image ships no `HEALTHCHECK` of its own, so
 *     without that injection there would be nothing to wait for.
 *   - **Redis** waits for the log line `Ready to accept connections`, which the
 *     server prints once, after it is listening.
 *   - **Kafka** waits for a log line it printed itself, *before* the broker
 *     starts. See `readiness.ts` for the mechanism; the effect is that
 *     `start()` resolves several seconds before the first client can connect.
 *
 * So nothing in this directory treats a resolved `start()` as readiness.
 * {@link awaitUsable} performs one real operation of the protocol — a query, a
 * `PING`, a metadata fetch — and retries it until it succeeds. It is the only
 * definition of "up" that a test can rely on, because it is the same operation
 * the test is about to do.
 *
 * ---------------------------------------------------------------------------
 * Why the drivers are a table and not three fixtures
 * ---------------------------------------------------------------------------
 * The interesting comparisons in this directory are *across* stores: what
 * reuse leaks, what a reset costs, how long readiness takes. Every one of them
 * is a table with the store on one axis, and a table is only honest if each
 * row was produced by the same code path. Three hand-written fixtures would
 * differ in a dozen small ways and each difference would end up quietly
 * attributed to the store.
 */

import { KafkaContainer } from '@testcontainers/kafka'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import Redis from 'ioredis'
import { Kafka } from 'kafkajs'
import type { Admin, Consumer, Producer } from 'kafkajs'
import pg from 'pg'
import type { StartedTestContainer } from 'testcontainers'

import { PROJECT_LABEL, PROJECT_LABEL_VALUE } from './daemon.ts'
import { imageFor, type StoreName } from './images.ts'

/** The Kafka client port the Confluent image publishes for external clients. */
const KAFKA_CLIENT_PORT = 9093

/**
 * Retries for clients doing real work, as opposed to probing.
 *
 * kafkajs defaults to 5 with exponential backoff. A newly created topic's
 * metadata reaches a client a moment after `createTopics` returns, and a
 * producer or consumer that gives up on the first `LEADER_NOT_AVAILABLE` is
 * not a strict test, it is a flaky one. This was measured rather than assumed:
 * with retries off, one of the four first-run consumers in the residue matrix
 * read nothing at all inside its eight-second budget, from a topic created and
 * seeded moments earlier. The other three were fine.
 */
const WORKLOAD_RETRIES = 5

export interface StartOptions {
  /** Start with `withReuse()`, so a matching container is adopted if one runs. */
  readonly reuse: boolean
  /**
   * An arbitrary string mixed into the container's labels.
   *
   * Labels are part of the object Testcontainers hashes to decide whether a
   * running container matches, so two variants never reuse each other. That is
   * what `reuse.test.ts` uses to show how narrow the match is.
   */
  readonly variant?: string
}

/** A started store, addressed the way its own client expects. */
export interface StartedStore {
  readonly store: StoreName
  readonly containerId: string
  /**
   * Postgres: a `postgres://` URI. Redis: a `redis://` URL. Kafka: a
   * `host:port` bootstrap broker, which is what `kafkajs` takes.
   */
  readonly address: string
  readonly container: StartedTestContainer
  stop(): Promise<void>
}

/**
 * Start one store.
 *
 * `withLabels` is applied to every container so `prune.ts` can find what this
 * directory left behind — which matters precisely because reused containers
 * are not registered with the reaper.
 */
export async function startStore(store: StoreName, options: StartOptions): Promise<StartedStore> {
  const labels: Record<string, string> = {
    [PROJECT_LABEL]: PROJECT_LABEL_VALUE,
    ...(options.variant === undefined ? {} : { [`${PROJECT_LABEL}.variant`]: options.variant }),
  }

  const image = imageFor(store)

  if (store === 'postgres') {
    let container = new PostgreSqlContainer(image).withLabels(labels)

    if (options.reuse) {
      container = container.withReuse()
    }

    const started = await container.start()

    return {
      store,
      containerId: started.getId(),
      address: started.getConnectionUri(),
      container: started,
      stop: async () => void (await started.stop()),
    }
  }

  if (store === 'redis') {
    let container = new RedisContainer(image).withLabels(labels)

    if (options.reuse) {
      container = container.withReuse()
    }

    const started = await container.start()

    return {
      store,
      containerId: started.getId(),
      address: started.getConnectionUrl(),
      container: started,
      stop: async () => void (await started.stop()),
    }
  }

  let container = new KafkaContainer(image).withLabels(labels)

  if (options.reuse) {
    container = container.withReuse()
  }

  const started = await container.start()

  return {
    store,
    containerId: started.getId(),
    address: `${started.getHost()}:${started.getMappedPort(KAFKA_CLIENT_PORT)}`,
    container: started,
    stop: async () => void (await started.stop()),
  }
}

/**
 * One real operation of the store's own protocol.
 *
 * Deliberately not a port check. A port check answers "is something listening",
 * and every failure this function exists to catch — Postgres still running
 * `initdb`, a Kafka broker whose socket is open but whose metadata is not
 * published — is a state in which something is listening and the answer is
 * still no.
 *
 * Each client is configured not to retry, so a failure is reported to
 * {@link awaitUsable} in milliseconds rather than being smoothed over inside
 * the client. `kafkajs` in particular will spend nine seconds retrying a
 * connection by default, which turns "the broker is not up" into "the test is
 * slow" — the exact confusion this directory is about.
 */
export async function probeStore(started: StartedStore): Promise<void> {
  if (started.store === 'postgres') {
    const client = new pg.Client({ connectionString: started.address, connectionTimeoutMillis: 2_000 })

    try {
      await client.connect()
      await client.query('select 1')
    } finally {
      await client.end()
    }

    return
  }

  if (started.store === 'redis') {
    const redis = newRedis(started)

    try {
      await redis.connect()
      await redis.ping()
    } finally {
      redis.disconnect()
    }

    return
  }

  const admin = newKafka(started, 0).admin()

  try {
    await admin.connect()
    await admin.listTopics()
  } finally {
    await admin.disconnect()
  }
}

/** What it cost to get from "start() resolved" to "a client succeeded". */
export interface Readiness {
  readonly store: StoreName
  /** Probe attempts, including the one that succeeded. 1 means it was ready. */
  readonly attempts: number
  /** Milliseconds spent probing. */
  readonly elapsedMs: number
}

/**
 * Probe until the store answers, or give up.
 *
 * The interval is 50ms and the first attempt is immediate, so a store that is
 * genuinely ready reports one attempt and a single-digit millisecond figure —
 * which is what makes the Kafka row in `README.md` readable as a gap rather
 * than as this function's own overhead.
 */
export async function awaitUsable(started: StartedStore, budgetMs = 120_000): Promise<Readiness> {
  const startedAt = performance.now()
  let attempts = 0
  let lastError: unknown

  while (performance.now() - startedAt < budgetMs) {
    attempts += 1

    try {
      await probeStore(started)

      return { store: started.store, attempts, elapsedMs: Math.round(performance.now() - startedAt) }
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  throw new Error(
    `${started.store} was still not usable ${budgetMs}ms after start() resolved, ` +
      `after ${attempts} probes. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError },
  )
}

/** Start a store and wait for it to answer its own protocol. */
export async function startUsableStore(store: StoreName, options: StartOptions): Promise<StartedStore> {
  const started = await startStore(store, options)

  await awaitUsable(started)

  return started
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/** A Postgres client, connected. The caller ends it. */
export async function newPostgres(started: StartedStore): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: started.address, connectionTimeoutMillis: 5_000 })

  await client.connect()

  return client
}

/** Run one function against a connected Postgres client, then close it. */
export async function withPostgres<T>(started: StartedStore, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await newPostgres(started)

  try {
    return await use(client)
  } finally {
    await client.end()
  }
}

/**
 * A Redis client that fails fast.
 *
 * `lazyConnect` so the caller decides when connection errors happen, and both
 * retry knobs disabled so a refused connection is an error rather than a
 * background reconnect loop that keeps the process alive after the suite ends.
 */
export function newRedis(started: StartedStore, db = 0): Redis {
  return new Redis(started.address, {
    db,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  })
}

/** Run one function against a connected Redis client, then disconnect it. */
export async function withRedis<T>(started: StartedStore, use: (redis: Redis) => Promise<T>, db = 0): Promise<T> {
  const redis = newRedis(started, db)

  await redis.connect()

  try {
    return await use(redis)
  } finally {
    redis.disconnect()
  }
}

/**
 * A Kafka client, retries off by default.
 *
 * Off by default because the first caller is {@link probeStore}, and a client
 * that retries turns "the broker is not up" into "this took nine seconds" —
 * the exact confusion this directory measures. Everything that talks to a
 * broker already known to be up passes `retries`, because a fresh topic's
 * metadata genuinely does take a moment to reach every client and a producer
 * that gives up on the first `LEADER_NOT_AVAILABLE` is not a realistic
 * workload, it is a flaky one.
 *
 * `logLevel: 0` is `NOTHING`: kafkajs logs connection failures at ERROR while
 * it retries them, and a probe against a broker that is not up yet would
 * otherwise print a screenful of stack traces per attempt.
 */
export function newKafka(started: StartedStore, retries = 0): Kafka {
  return new Kafka({
    brokers: [started.address],
    clientId: 'boilerplate-testing-containers',
    logLevel: 0,
    connectionTimeout: 2_000,
    requestTimeout: 5_000,
    retry: { retries },
  })
}

/** Run one function against a connected Kafka admin client, then disconnect. */
export async function withKafkaAdmin<T>(
  started: StartedStore,
  use: (admin: Admin) => Promise<T>,
  retries = WORKLOAD_RETRIES,
): Promise<T> {
  const admin = newKafka(started, retries).admin()

  await admin.connect()

  try {
    return await use(admin)
  } finally {
    await admin.disconnect()
  }
}

/** Run one function against a connected Kafka producer, then disconnect. */
export async function withKafkaProducer<T>(
  started: StartedStore,
  use: (producer: Producer) => Promise<T>,
): Promise<T> {
  const producer = newKafka(started, WORKLOAD_RETRIES).producer()

  await producer.connect()

  try {
    return await use(producer)
  } finally {
    await producer.disconnect()
  }
}

/** Run one function against a connected Kafka consumer, then disconnect. */
export async function withKafkaConsumer<T>(
  started: StartedStore,
  groupId: string,
  use: (consumer: Consumer) => Promise<T>,
): Promise<T> {
  const consumer = newKafka(started, WORKLOAD_RETRIES).consumer({
    groupId,
    sessionTimeout: 6_000,
    heartbeatInterval: 2_000,
  })

  await consumer.connect()

  try {
    return await use(consumer)
  } finally {
    await consumer.disconnect()
  }
}
