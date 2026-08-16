/**
 * Wiring for the London design, used by the shared contract suite.
 *
 * Every one of these is written here, in test-support code, because the
 * outside-in cycle never produced a production implementation of any port —
 * it produced six interfaces and an orchestrator that talks to them. That is
 * not an oversight in the exercise: it is the honest end state of driving a
 * feature purely from the outside. Somebody still has to write a real
 * catalogue and a real inventory, and when they do, nothing in
 * `placeOrder.test.ts` will have said a word about whether they are right.
 * The contract in `../orderContract.ts` is what covers that gap here.
 *
 * These are stubs with just enough behaviour to be a believable world — an
 * in-memory price list, a stock ledger that can actually run out, a promo
 * table with expiry. Deliberately not `vi.fn()`: the contract asserts on
 * outcomes, and a double that records calls nobody inspects is noise.
 */

import { createPlaceOrder, type PaymentOutcome, type PlaceOrderDeps } from './placeOrder'
import {
  DEFAULT_NOW,
  type Cents,
  type Charge,
  type Percent,
  type Scenario,
  type Sku,
  type World,
  type WorldFactory,
} from '../orderContract'

export type LondonWiring = {
  readonly deps: PlaceOrderDeps
  readonly stock: Map<Sku, number>
  readonly charges: Charge[]
}

export function buildLondonWiring(scenario: Scenario): LondonWiring {
  const prices = new Map<Sku, Cents>(Object.entries(scenario.prices))
  const stock = new Map<Sku, number>(Object.entries(scenario.stock))
  const promos = new Map(Object.entries(scenario.promos ?? {}))
  const now = new Date(scenario.now ?? DEFAULT_NOW)
  const charges: Charge[] = []
  let issued = 0

  const deps: PlaceOrderDeps = {
    catalogue: {
      priceOf: async (sku: Sku): Promise<Cents | null> => prices.get(sku) ?? null,
    },

    inventory: {
      reserve: async (sku: Sku, quantity: number): Promise<boolean> => {
        const available = stock.get(sku) ?? 0
        if (available < quantity) return false
        stock.set(sku, available - quantity)
        return true
      },
      release: async (sku: Sku, quantity: number): Promise<void> => {
        stock.set(sku, (stock.get(sku) ?? 0) + quantity)
      },
    },

    promotions: {
      discountFor: async (code: string, at: Date): Promise<Percent | null> => {
        const promo = promos.get(code)
        if (promo === undefined) return null
        return at < new Date(promo.expiresAt) ? promo.percentOff : null
      },
    },

    payments: {
      charge: async (customerId: string, amountCents: Cents): Promise<PaymentOutcome> => {
        if (scenario.payment === 'declines') return { accepted: false }
        charges.push({ customerId, amountCents })
        return { accepted: true }
      },
    },

    orderIds: {
      next: (): string => `london-order-${++issued}`,
    },

    clock: {
      now: (): Date => now,
    },
  }

  return { deps, stock, charges }
}

export const createLondonWorld: WorldFactory = (scenario: Scenario): World => {
  const { deps, stock, charges } = buildLondonWiring(scenario)
  const placeOrder = createPlaceOrder(deps)

  return {
    placeOrder,
    stockOf: (sku: Sku): number => stock.get(sku) ?? 0,
    charges: (): readonly Charge[] => charges,
  }
}
