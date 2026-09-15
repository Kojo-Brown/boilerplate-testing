/**
 * A context for tests that call a handler directly.
 *
 * `runDeliveries` builds one of these too, and the duplication is deliberate: a
 * unit test of `memo-after` should be able to call it twice and look at the
 * store without a hazard, a park point or a scoring vocabulary in the way. The
 * harness is for the comparison; this is for "does this handler do what its
 * comment says".
 */

import { createClock, createIdentitySource, type Clock } from './clock.ts'
import { createGateway, type RecordingGateway } from './gateway.ts'
import type { ChargeRequest, Context } from './service.ts'
import { Store } from './store.ts'

export interface Fixture {
  readonly store: Store
  readonly clock: Clock
  readonly gateway: RecordingGateway
  /** A fresh context per call, so each one names its own delivery. */
  context(delivery?: string): Context
  /** Committed charge rows. */
  charges(): number
  /** Gateway calls that moved money. */
  effects(): number
}

export function createFixture(options: { readonly gatewayOutcomes?: readonly boolean[] } = {}): Fixture {
  const store = new Store()
  const clock = createClock()
  const ids = createIdentitySource()
  const gateway = createGateway(
    store,
    options.gatewayOutcomes === undefined ? {} : { outcomes: options.gatewayOutcomes },
  )
  let delivered = 0

  return {
    store,
    clock,
    gateway,
    context(delivery?: string) {
      delivered += 1

      return { store, clock, ids, gateway, delivery: delivery ?? `d${String(delivered)}` }
    },
    charges: () => store.committed('charges').length,
    effects: () => store.committed('gateway_calls').filter((row) => row['ok'] === true).length,
  }
}

/** The request every direct test sends unless it is testing a variation of it. */
export const aCharge = (overrides: Partial<ChargeRequest> = {}): ChargeRequest => ({
  principal: 'cus_alpha',
  key: 'idem_7f3a',
  orderId: 'ord_001',
  amount: 2500,
  ...overrides,
})
