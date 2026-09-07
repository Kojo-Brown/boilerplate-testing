/**
 * The pattern, in use. This is the file to copy.
 *
 * Three suites against three real servers, sharing one container each with
 * every other suite in the run, and isolated from them by a namespace rather
 * than by a reset. Nothing here waits for a container to start: the first
 * suite that asks pays for it, and by the time a `beforeAll` returns the store
 * has already answered a real query.
 *
 * Read it against `residue.container.test.ts`, which is the same three stores
 * being deliberately misused. Every choice below is a column in that matrix.
 */

import { describe, expect, it } from 'vitest'

import { useKafkaSuite, usePostgresSuite, useRedisSuite } from './suite.ts'
import { withKafkaAdmin, withKafkaConsumer, withKafkaProducer } from './stores.ts'

describe('an orders table', () => {
  const postgres = usePostgresSuite('orders api')

  it('stores an order and reads it back', async () => {
    await postgres().connect(async (client) => {
      await client.query('create table if not exists orders (id bigserial primary key, ref text not null unique)')
      await client.query('insert into orders (ref) values ($1)', ['ord-1'])

      const { rows } = await client.query<{ ref: string }>('select ref from orders')

      expect(rows.map((row) => row.ref)).toEqual(['ord-1'])
    })
  })

  it('rejects a second order with the same reference', async () => {
    await postgres().connect(async (client) => {
      await client.query('create table if not exists orders (id bigserial primary key, ref text not null unique)')
      await client.query('insert into orders (ref) values ($1)', ['ord-2'])

      await expect(client.query('insert into orders (ref) values ($1)', ['ord-2'])).rejects.toThrow(
        /duplicate key value/,
      )
    })
  })

  it('owns a schema of its own, which is what makes the two tests above independent', () => {
    expect(postgres().schema).toMatch(/^t_orders_api_[0-9a-f]{8}$/)
  })
})

describe('a cache and a lock', () => {
  const redis = useRedisSuite('orders cache')

  it('misses, fills, and then hits', async () => {
    await redis().connect(async (client) => {
      const key = `${redis().prefix}user:1`

      expect(await client.get(key)).toBeNull()

      await client.set(key, 'Ada')

      expect(await client.get(key)).toBe('Ada')
    })
  })

  it('acquires a lock once and refuses the second attempt', async () => {
    await redis().connect(async (client) => {
      const key = `${redis().prefix}lock:orders`

      expect(await client.set(key, 'held', 'EX', 30, 'NX')).toBe('OK')
      expect(await client.set(key, 'held', 'EX', 30, 'NX')).toBeNull()
    })
  })

  it('sees only its own keys in DBSIZE, which a key prefix alone would not give it', async () => {
    await redis().connect(async (client) => {
      // Two keys from the two tests above, and nothing from any other suite:
      // this assertion is the one that needs a database rather than a prefix.
      expect(await client.dbsize()).toBe(2)
    })
  })
})

describe('an outbox topic', () => {
  const kafka = useKafkaSuite('orders outbox')

  it('publishes an event and consumes it back', async () => {
    const { started, topic, groupId } = kafka()

    await withKafkaAdmin(started, (admin) =>
      admin.createTopics({ topics: [{ topic, numPartitions: 1 }], waitForLeaders: true }),
    )
    await withKafkaProducer(started, (producer) =>
      producer.send({ topic, messages: [{ key: 'order-created', value: 'ord-1' }] }),
    )

    const received: string[] = []

    await withKafkaConsumer(started, groupId, async (consumer) => {
      await consumer.subscribe({ topic, fromBeginning: true })
      await consumer.run({
        eachMessage: async ({ message }) => {
          received.push(message.value?.toString() ?? '')
        },
      })

      const deadline = performance.now() + 15_000

      while (received.length === 0 && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    })

    expect(received).toEqual(['ord-1'])
  })

  it('names its topic and group per run, so a reused broker cannot feed it yesterday’s events', () => {
    const { topic, groupId } = kafka()

    expect(topic).toMatch(/^orders-outbox-[0-9a-f]{8}-events$/)
    expect(groupId).toMatch(/^orders-outbox-[0-9a-f]{8}-consumer$/)
  })
})
