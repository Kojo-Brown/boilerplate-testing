import { describe, expect, it } from 'vitest'

import { aCharge, createFixture } from './fixture.ts'
import {
  drainOutbox,
  fingerprint,
  GLOBAL_SCOPE,
  HANDLERS,
  KEY_TTL_MS,
  LEASE_TTL_MS,
  type StrategyKey,
} from './service.ts'

const KEYS = Object.keys(HANDLERS) as StrategyKey[]

/**
 * The properties every column has to have before the matrix means anything.
 *
 * If a strategy could not charge once, or answered the wrong status, its whole
 * column would be a report about a broken handler rather than about a design —
 * so the `clean` row of the matrix is checked here as eight separate
 * assertions rather than as one cell whose failure could be anything.
 */
describe.each(KEYS)('%s, on the happy path', (key) => {
  const handler = HANDLERS[key]

  it('charges once and answers 201', async () => {
    const fixture = createFixture()
    const response = await handler(fixture.context(), aCharge())

    if (key === 'atomic-outbox') await drainOutbox(fixture.context())

    expect(response.status).toBe(201)
    expect(response.replayed).toBe(false)
    expect(response.body['status']).toBe('charged')
    expect(fixture.charges()).toBe(1)
    expect(fixture.effects()).toBe(1)
  })

  it('refuses a non-positive amount before touching anything', async () => {
    const fixture = createFixture()
    const response = await handler(fixture.context(), aCharge({ amount: 0 }))

    expect(response.status).toBe(400)
    expect(fixture.charges()).toBe(0)
    expect(fixture.effects()).toBe(0)
    expect(fixture.store.operations).toHaveLength(0)
  })

  it('does not charge when the gateway declines, and does not keep the row', async () => {
    const fixture = createFixture({ gatewayOutcomes: [false] })
    const response = await handler(fixture.context(), aCharge())

    if (key === 'atomic-outbox') await drainOutbox(fixture.context())

    // The outbox is the one design that cannot refuse: it answers 201 from the
    // commit, before the gateway has been asked anything at all. That is the
    // trade it makes, it is the `retry-after-decline` cell, and it is checked
    // here so the difference is stated rather than discovered in the matrix.
    if (key === 'atomic-outbox') {
      expect(response.status).toBe(201)
      expect(fixture.charges()).toBe(1)
    } else {
      expect(response.status).toBe(502)
      expect(fixture.charges()).toBe(0)
    }

    expect(fixture.effects()).toBe(0)
  })
})

describe('none', () => {
  it('charges again for an identical request, which is the point of the control', async () => {
    const fixture = createFixture()

    await HANDLERS.none(fixture.context(), aCharge())
    await HANDLERS.none(fixture.context(), aCharge())

    expect(fixture.charges()).toBe(2)
  })
})

describe('natural-key', () => {
  it('replays the first charge when the order id repeats', async () => {
    const fixture = createFixture()
    const first = await HANDLERS['natural-key'](fixture.context(), aCharge())
    const second = await HANDLERS['natural-key'](fixture.context(), aCharge())

    expect(second.replayed).toBe(true)
    expect(second.body['chargeId']).toBe(first.body['chargeId'])
    expect(fixture.charges()).toBe(1)
  })

  it('treats a different order id as a different operation, key or no key', async () => {
    const fixture = createFixture()

    await HANDLERS['natural-key'](fixture.context(), aCharge())
    await HANDLERS['natural-key'](fixture.context(), aCharge({ orderId: 'ord_002' }))

    expect(fixture.charges()).toBe(2)
  })

  /** Its blindness is exactly as wide as the key. */
  it('cannot see a changed amount, because the amount is not in the key', async () => {
    const fixture = createFixture()

    await HANDLERS['natural-key'](fixture.context(), aCharge())

    const second = await HANDLERS['natural-key'](fixture.context(), aCharge({ amount: 9900 }))

    expect(second.status).toBe(200)
    expect(second.body['amount']).toBe(2500)
  })
})

describe('memo-after', () => {
  it('replays a recorded response', async () => {
    const fixture = createFixture()

    await HANDLERS['memo-after'](fixture.context(), aCharge())

    const second = await HANDLERS['memo-after'](fixture.context(), aCharge())

    expect(second.replayed).toBe(true)
    expect(fixture.charges()).toBe(1)
  })

  it('falls back to no idempotency when there is no key', async () => {
    const fixture = createFixture()

    await HANDLERS['memo-after'](fixture.context(), aCharge({ key: null }))
    await HANDLERS['memo-after'](fixture.context(), aCharge({ key: null }))

    expect(fixture.charges()).toBe(2)
  })

  /**
   * The unscoped lookup, asserted directly rather than left to the
   * `cross-principal-key` cell — a matrix cell says a strategy failed, and this
   * says why.
   */
  it('records the key against the global scope, so another principal collides with it', async () => {
    const fixture = createFixture()

    await HANDLERS['memo-after'](fixture.context(), aCharge())

    expect(fixture.store.committed('idempotency_keys')[0]?.['scope']).toBe(GLOBAL_SCOPE)

    const other = await HANDLERS['memo-after'](
      fixture.context(),
      aCharge({ principal: 'cus_beta', orderId: 'ord_002' }),
    )

    expect(other.replayed).toBe(true)
    expect(fixture.charges()).toBe(1)
  })

  it('records a failure against the key, which makes the key dead', async () => {
    const fixture = createFixture({ gatewayOutcomes: [false] })

    await HANDLERS['memo-after'](fixture.context(), aCharge())

    const second = await HANDLERS['memo-after'](fixture.context(), aCharge())

    expect(second.status).toBe(502)
    expect(second.replayed).toBe(true)
    expect(fixture.charges()).toBe(0)
  })
})

describe('memo-before', () => {
  it('commits the key before the charge exists', async () => {
    const fixture = createFixture()
    const seen: string[] = []

    fixture.store.setHook((event) => {
      if (event.operation === 'commit' && event.phase === 'after') seen.push(event.tables.join('+'))
    })

    await HANDLERS['memo-before'](fixture.context(), aCharge())

    expect(seen[0]).toBe('idempotency_keys')
    expect(seen[1]).toBe('charges')
  })

  it('scopes the key to the principal', async () => {
    const fixture = createFixture()

    await HANDLERS['memo-before'](fixture.context(), aCharge())
    await HANDLERS['memo-before'](fixture.context(), aCharge({ principal: 'cus_beta', orderId: 'ord_002' }))

    expect(fixture.charges()).toBe(2)
  })
})

describe('lease', () => {
  it('answers 409 while a lease is held', async () => {
    const fixture = createFixture()
    const context = fixture.context('held')
    const claim = context.store.begin({ delivery: 'held' })

    await claim.insert('idempotency_keys', {
      scope: 'cus_alpha',
      principal: 'cus_alpha',
      key: 'idem_7f3a',
      fingerprint: null,
      state: 'in-progress',
      status: null,
      body: null,
      created_at: context.clock.now(),
    })
    await claim.commit()

    const response = await HANDLERS.lease(fixture.context(), aCharge())

    expect(response.status).toBe(409)
    expect(fixture.charges()).toBe(0)
  })

  /**
   * The difference between `lease` and `lease-recovering`, in one pair of
   * assertions: the same stale lease, the same elapsed time, two answers.
   */
  it('still answers 409 long after the lease should have expired', async () => {
    const fixture = createFixture()
    const context = fixture.context('held')
    const claim = context.store.begin({ delivery: 'held' })

    await claim.insert('idempotency_keys', {
      scope: 'cus_alpha',
      principal: 'cus_alpha',
      key: 'idem_7f3a',
      fingerprint: null,
      state: 'in-progress',
      status: null,
      body: null,
      created_at: context.clock.now(),
    })
    await claim.commit()
    fixture.clock.advance(LEASE_TTL_MS * 100)

    expect((await HANDLERS.lease(fixture.context(), aCharge())).status).toBe(409)
    expect(fixture.charges()).toBe(0)
  })
})

describe('lease-recovering', () => {
  it('takes over a lease older than its TTL', async () => {
    const fixture = createFixture()
    const context = fixture.context('held')
    const claim = context.store.begin({ delivery: 'held' })

    await claim.insert('idempotency_keys', {
      scope: 'cus_alpha',
      principal: 'cus_alpha',
      key: 'idem_7f3a',
      fingerprint: fingerprint(aCharge()),
      state: 'in-progress',
      status: null,
      body: null,
      created_at: context.clock.now(),
    })
    await claim.commit()
    fixture.clock.advance(LEASE_TTL_MS + 1)

    const response = await HANDLERS['lease-recovering'](fixture.context(), aCharge())

    expect(response.status).toBe(201)
    expect(fixture.charges()).toBe(1)
  })

  it('rejects a key reused with a different body', async () => {
    const fixture = createFixture()

    await HANDLERS['lease-recovering'](fixture.context(), aCharge())

    const second = await HANDLERS['lease-recovering'](fixture.context(), aCharge({ amount: 9900 }))

    expect(second.status).toBe(422)
    expect(second.body['error']).toBe('key_reused')
    expect(fixture.charges()).toBe(1)
  })

  it('passes the idempotency key to the gateway', async () => {
    const fixture = createFixture()

    await HANDLERS['lease-recovering'](fixture.context(), aCharge())

    expect(fixture.gateway.requests).toEqual(['cus_alpha:idem_7f3a'])
  })

  it('stops replaying once the record has expired', async () => {
    const fixture = createFixture()

    await HANDLERS['lease-recovering'](fixture.context(), aCharge())
    fixture.clock.advance(KEY_TTL_MS + 1)

    const second = await HANDLERS['lease-recovering'](fixture.context(), aCharge())

    expect(second.replayed).toBe(false)
    // Two charge rows, and still only one gateway effect: the downstream key is
    // doing the work the expired local record no longer can.
    expect(fixture.charges()).toBe(2)
    expect(fixture.effects()).toBe(1)
  })
})

describe('atomic-outbox', () => {
  it('commits the key, the charge and the outbox row together', async () => {
    const fixture = createFixture()
    const commits: string[] = []

    fixture.store.setHook((event) => {
      if (event.operation === 'commit' && event.phase === 'after' && event.tables.length > 1) {
        commits.push(event.tables.join('+'))
      }
    })

    await HANDLERS['atomic-outbox'](fixture.context(), aCharge())

    expect(commits).toEqual(['idempotency_keys+charges+outbox'])
  })

  it('calls the gateway only after the commit, from the outbox', async () => {
    const fixture = createFixture()
    let committed = false

    fixture.store.setHook((event) => {
      if (event.operation === 'commit' && event.phase === 'after') committed = true
    })

    await HANDLERS['atomic-outbox'](fixture.context(), aCharge())

    expect(committed).toBe(true)
    expect(fixture.gateway.requests).toEqual(['cus_alpha:idem_7f3a'])
  })

  it('leaves a declined outbox row failed rather than sent', async () => {
    const fixture = createFixture({ gatewayOutcomes: [false] })

    await HANDLERS['atomic-outbox'](fixture.context(), aCharge())

    expect(fixture.store.committed('outbox')[0]?.['state']).toBe('failed')
  })

  it('works without an idempotency key by falling back to the order id', async () => {
    const fixture = createFixture()

    await HANDLERS['atomic-outbox'](fixture.context(), aCharge({ key: null }))
    await HANDLERS['atomic-outbox'](fixture.context(), aCharge({ key: null }))

    expect(fixture.charges()).toBe(1)
  })
})

describe('the outbox consumer', () => {
  it('is idempotent itself: draining twice moves the money once', async () => {
    const fixture = createFixture()

    await HANDLERS['atomic-outbox'](fixture.context(), aCharge())
    await drainOutbox(fixture.context())
    await drainOutbox(fixture.context())

    expect(fixture.effects()).toBe(1)
  })
})
