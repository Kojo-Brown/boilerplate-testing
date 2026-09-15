// @vitest-environment node
/**
 * The same findings, over a real socket.
 *
 * The matrix runs against handler functions, which is the right place to
 * measure eighty-eight cells: it is fast, it is deterministic, and the crash
 * and overlap points are reachable. The obvious objection is that it therefore
 * measures functions rather than HTTP handlers — that header parsing, status
 * codes and body serialisation are assumed rather than exercised.
 *
 * This file answers the objection instead of arguing with it. It takes the rows
 * where the stakes are highest, drives them over loopback with a real
 * `Idempotency-Key` header, and checks the same answers come out. Four requests
 * per case rather than eighty-eight, because the point is that the transport
 * does not change the result — not to re-derive the table through a socket.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { createClock, createIdentitySource } from './clock.ts'
import { createGateway } from './gateway.ts'
import { CHARGES_PATH, createChargesServer } from './server.ts'
import { HANDLERS, type ChargeRequest, type Context, type StrategyKey } from './service.ts'
import { Store } from './store.ts'
import type { Server } from 'node:http'

interface Running {
  readonly origin: string
  readonly store: Store
  readonly server: Server
  charges(): number
  effects(): number
}

const running: Server[] = []

afterEach(async () => {
  await Promise.all(
    running.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
})

/**
 * Bind on an ephemeral port and report the origin.
 *
 * Port 0 rather than a fixed one so the suite can run in parallel with anything
 * else, and bound up front rather than per request for the reason
 * `supertest/createTestApp.ts` documents: a lazily bound server is closed again
 * when the request that bound it ends.
 */
async function start(key: StrategyKey): Promise<Running> {
  const store = new Store()
  const clock = createClock()
  const ids = createIdentitySource()
  const gateway = createGateway(store)
  const contextFor = (delivery: string): Context => ({ store, clock, ids, gateway, delivery })
  const server = createChargesServer({ handler: HANDLERS[key], contextFor })

  running.push(server)

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()

  if (address === null || typeof address === 'string') throw new Error('server did not bind to a port')

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    store,
    server,
    charges: () => store.committed('charges').length,
    effects: () => store.committed('gateway_calls').filter((row) => row['ok'] === true).length,
  }
}

interface Answer {
  readonly status: number
  readonly replayed: boolean
  readonly body: Record<string, unknown>
}

async function post(
  origin: string,
  request: Pick<ChargeRequest, 'principal' | 'key' | 'orderId' | 'amount'>,
): Promise<Answer> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-principal': request.principal,
  }

  if (request.key !== null) headers['idempotency-key'] = request.key

  const response = await fetch(`${origin}${CHARGES_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ orderId: request.orderId, amount: request.amount }),
  })

  return {
    status: response.status,
    replayed: response.headers.get('idempotent-replayed') === 'true',
    body: (await response.json()) as Record<string, unknown>,
  }
}

const charge = (overrides: Partial<ChargeRequest> = {}) => ({
  principal: 'cus_alpha',
  key: 'idem_7f3a',
  orderId: 'ord_001',
  amount: 2500,
  ...overrides,
})

describe('the transport', () => {
  it('charges once and answers 201 with a JSON body', async () => {
    const app = await start('lease-recovering')
    const answer = await post(app.origin, charge())

    expect(answer.status).toBe(201)
    expect(answer.replayed).toBe(false)
    expect(answer.body['status']).toBe('charged')
    expect(app.charges()).toBe(1)
  })

  it('reads the Idempotency-Key header, not the body', async () => {
    const app = await start('lease-recovering')

    await post(app.origin, charge())

    expect(app.store.committed('idempotency_keys')[0]?.['key']).toBe('idem_7f3a')
  })

  it('treats a missing key as no key at all rather than an error', async () => {
    const app = await start('memo-after')

    const first = await post(app.origin, charge({ key: null }))
    const second = await post(app.origin, charge({ key: null }))

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(app.charges()).toBe(2)
  })

  it('rejects a request with no principal', async () => {
    const app = await start('lease-recovering')
    const response = await fetch(`${app.origin}${CHARGES_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'ord_001', amount: 2500 }),
    })

    expect(response.status).toBe(400)
    expect(app.charges()).toBe(0)
  })

  it('404s anything that is not the charges endpoint', async () => {
    const app = await start('none')
    const response = await fetch(`${app.origin}/v1/nope`, { method: 'POST' })

    expect(response.status).toBe(404)
  })
})

describe('the findings hold over HTTP', () => {
  /**
   * A replay returns the status the original answer had — 201, not 200 — which
   * is what Stripe does and what "replay the response" has to mean if the
   * record is to be worth keeping. The status is therefore *not* how a client
   * tells a replay from fresh work; the `Idempotent-Replayed` header is, which
   * is the whole reason the header exists.
   */
  it('replays a sequential retry with the original status, and says so in a header', async () => {
    const app = await start('lease-recovering')

    const first = await post(app.origin, charge())
    const second = await post(app.origin, charge())

    expect(first.replayed).toBe(false)
    expect(second.status).toBe(201)
    expect(second.replayed).toBe(true)
    expect(second.body['chargeId']).toBe(first.body['chargeId'])
    expect(app.charges()).toBe(1)
  })

  /**
   * And the one design that answers differently, because it genuinely has no
   * recorded response to replay: `natural-key` reconstructs an answer from the
   * charge row, so it says 200 — "here is the resource that already exists" —
   * rather than repeating a 201 it never stored.
   */
  it('answers a natural-key replay 200, having no recorded response to repeat', async () => {
    const app = await start('natural-key')

    await post(app.origin, charge())

    const second = await post(app.origin, charge())

    expect(second.status).toBe(200)
    expect(second.replayed).toBe(true)
    expect(app.charges()).toBe(1)
  })

  it('charges twice without idempotency, as the control must', async () => {
    const app = await start('none')

    await post(app.origin, charge())
    await post(app.origin, charge())

    expect(app.charges()).toBe(2)
  })

  /**
   * The `concurrent-retry` row, posed the way a proxy poses it: two real
   * requests in flight at once. There is no park point here — the point is that
   * the bug is reachable over a socket at all, not that it is reachable every
   * time — so the assertion is on what the *strategy* guarantees rather than on
   * an interleaving this test does not control.
   */
  it('never charges twice under two simultaneous requests with a lease', async () => {
    const app = await start('lease-recovering')
    const answers = await Promise.all([post(app.origin, charge()), post(app.origin, charge())])

    expect(app.charges()).toBe(1)
    expect(app.effects()).toBe(1)

    // Exactly one delivery did the work. The other is allowed to be either a
    // replay or a 409 — which of the two it gets depends on whether it reached
    // the key before or after the first finished, and that is genuinely up to
    // the runtime here. Asserting on which one arrives would be asserting on
    // an interleaving this test does not control, which is the difference
    // between a test and a flake; what the strategy actually promises is that
    // only one of them charges.
    const fresh = answers.filter((answer) => !answer.replayed && answer.status === 201)
    const deferred = answers.filter((answer) => answer.replayed || answer.status === 409)

    expect(fresh).toHaveLength(1)
    expect(deferred).toHaveLength(1)
  })

  it('rejects a key reused with a different amount, over the wire', async () => {
    const app = await start('lease-recovering')

    await post(app.origin, charge())

    const second = await post(app.origin, charge({ amount: 9900 }))

    expect(second.status).toBe(422)
    expect(second.body['error']).toBe('key_reused')
    expect(app.charges()).toBe(1)
  })

  /** The cross-tenant leak, delivered by two real clients rather than two calls. */
  it('hands one customer another customer\'s charge when the key is unscoped', async () => {
    const app = await start('memo-after')

    const first = await post(app.origin, charge())
    const second = await post(app.origin, charge({ principal: 'cus_beta', orderId: 'ord_002' }))

    expect(second.replayed).toBe(true)
    expect(second.body['chargeId']).toBe(first.body['chargeId'])
    expect(app.charges()).toBe(1)
  })

  it('keeps a scoped key from colliding across customers', async () => {
    const app = await start('lease-recovering')

    await post(app.origin, charge())
    await post(app.origin, charge({ principal: 'cus_beta', orderId: 'ord_002' }))

    expect(app.charges()).toBe(2)
  })
})
