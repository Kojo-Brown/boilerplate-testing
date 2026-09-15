import { describe, expect, it } from 'vitest'

import { runDeliveries, type DeliverySpec, type Subject } from './harness.ts'
import { HANDLERS } from './service.ts'
import { aCharge } from './fixture.ts'
import { reconcileOutbox } from './harness.ts'

const subject = (key: keyof typeof HANDLERS): Subject =>
  key === 'atomic-outbox'
    ? { handle: HANDLERS[key], reconcile: reconcileOutbox }
    : { handle: HANDLERS[key] }

const twice: readonly DeliverySpec[] = [
  { label: 'first', request: aCharge() },
  { label: 'retry', request: aCharge() },
]

describe('sequential delivery', () => {
  it('runs deliveries in order and reports each answer', async () => {
    const observation = await runDeliveries(subject('none'), twice)

    expect(observation.deliveries.map((delivery) => delivery.label)).toEqual(['first', 'retry'])
    expect(observation.deliveries.every((delivery) => delivery.response !== null)).toBe(true)
    expect(observation.charges).toBe(2)
  })
})

describe('crash points', () => {
  it('leaves a crashed delivery with no response at all', async () => {
    const observation = await runDeliveries(subject('none'), [
      { label: 'first', request: aCharge(), crashAt: 'after-effect' },
    ])

    expect(observation.deliveries[0]?.crashed).toBe(true)
    expect(observation.deliveries[0]?.response).toBeNull()
  })

  /**
   * The property that makes `crash-after-effect` a hazard rather than a
   * rollback: whatever was committed before the crash stays committed.
   */
  it('keeps work the crashed delivery had already committed', async () => {
    const observation = await runDeliveries(subject('none'), [
      { label: 'first', request: aCharge(), crashAt: 'after-effect' },
    ])

    expect(observation.charges).toBe(1)
  })

  it('discards work the crashed delivery had not committed', async () => {
    const observation = await runDeliveries(subject('memo-before'), [
      { label: 'first', request: aCharge(), crashAt: 'after-claim' },
    ])

    // The key was committed first; the charge never was.
    expect(observation.store.committed('idempotency_keys')).toHaveLength(1)
    expect(observation.charges).toBe(0)
  })

  /**
   * `after-claim` and `after-effect` are the same point for a strategy with no
   * bookkeeping and different points for one with some. That is the whole
   * reason the crash point is expressed in terms of what a commit *wrote*
   * rather than as an index into a sequence of commits.
   */
  it('lands `after-claim` on the first commit whatever that commit was', async () => {
    const withoutBookkeeping = await runDeliveries(subject('none'), [
      { label: 'first', request: aCharge(), crashAt: 'after-claim' },
    ])
    const withBookkeeping = await runDeliveries(subject('lease'), [
      { label: 'first', request: aCharge(), crashAt: 'after-claim' },
    ])

    expect(withoutBookkeeping.charges).toBe(1)
    expect(withBookkeeping.charges).toBe(0)
  })

  it('kills a delivery after the gateway has answered', async () => {
    const observation = await runDeliveries(subject('none'), [
      { label: 'first', request: aCharge(), crashAt: 'after-gateway' },
    ])

    expect(observation.gatewayEffects).toBe(1)
    expect(observation.charges).toBe(0)
  })
})

describe('overlap', () => {
  /**
   * The bug `memo-after` has and a sequential test cannot see. Both deliveries
   * read an absent key, both charge.
   */
  it('lets a retry arrive inside the window after the effect', async () => {
    const observation = await runDeliveries(subject('memo-after'), [
      { label: 'first', request: aCharge(), parkAt: 'after-effect' },
      { label: 'retry', request: aCharge() },
    ])

    expect(observation.charges).toBe(2)
  })

  it('finds nothing wrong with the same strategy delivered sequentially', async () => {
    const observation = await runDeliveries(subject('memo-after'), twice)

    expect(observation.charges).toBe(1)
  })

  /** A parked delivery that its partner never reaches must still be released. */
  it('finishes even when the partner settles before the park point is reached', async () => {
    const observation = await runDeliveries(subject('atomic-outbox'), [
      { label: 'first', request: aCharge(), parkAt: 'after-effect' },
      { label: 'retry', request: aCharge() },
    ])

    expect(observation.deliveries).toHaveLength(2)
    expect(observation.deliveries.every((delivery) => delivery.response !== null)).toBe(true)
  })
})

describe('the error middleware', () => {
  /**
   * `memo-after` under overlap raises a unique violation on its memo insert,
   * because it decided the key was absent and then somebody else wrote it. A
   * real service answers 500; the harness must too, or the cell becomes a stack
   * trace instead of a finding.
   */
  it('turns an unhandled error into a 500 rather than failing the run', async () => {
    const observation = await runDeliveries(subject('memo-after'), [
      { label: 'first', request: aCharge(), parkAt: 'after-effect' },
      { label: 'retry', request: aCharge() },
    ])
    const statuses = observation.deliveries.map((delivery) => delivery.response?.status)

    expect(statuses).toContain(500)
    expect(observation.deliveries.every((delivery) => delivery.crashed === false)).toBe(true)
  })
})

describe('reconciliation', () => {
  it('runs a declared background process once, after every delivery', async () => {
    const observation = await runDeliveries(subject('atomic-outbox'), [
      { label: 'first', request: aCharge() },
    ])

    expect(observation.gatewayEffects).toBe(1)
    expect(observation.store.committed('outbox')[0]?.['state']).toBe('sent')
  })

  it('does nothing for a subject that declares none', async () => {
    const observation = await runDeliveries(subject('none'), [{ label: 'first', request: aCharge() }])

    expect(observation.store.committed('outbox')).toHaveLength(0)
  })
})

describe('the clock', () => {
  it('advances by a delivery\'s declared delay and records when each was sent', async () => {
    const observation = await runDeliveries(subject('none'), [
      { label: 'first', request: aCharge() },
      { label: 'retry', request: aCharge(), delayBefore: 30_000 },
    ])
    const [first, retry] = observation.deliveries

    expect(retry!.sentAt - first!.sentAt).toBe(30_000)
  })
})

describe('determinism', () => {
  /**
   * The claim `concurrency/README.md` deliberately does not make about its own
   * matrix, and the reason this directory reports outcomes rather than
   * detection rates. If the overlap were decided by the event loop rather than
   * by a named park point, this would be the test that failed intermittently —
   * which is exactly the signal worth having.
   */
  it('gives the same answer on repeated runs of an overlapping hazard', async () => {
    const results: string[] = []

    for (let run = 0; run < 25; run += 1) {
      const observation = await runDeliveries(subject('memo-after'), [
        { label: 'first', request: aCharge(), parkAt: 'after-effect' },
        { label: 'retry', request: aCharge() },
      ])

      results.push(`${String(observation.charges)}/${String(observation.gatewayEffects)}`)
    }

    expect(new Set(results).size).toBe(1)
  })

  it('assigns the same charge ids on every run', async () => {
    const first = await runDeliveries(subject('none'), twice)
    const second = await runDeliveries(subject('none'), twice)

    expect(first.store.committed('charges').map((row) => row['id'])).toEqual(
      second.store.committed('charges').map((row) => row['id']),
    )
  })
})
