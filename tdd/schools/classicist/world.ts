/**
 * Wiring for the classicist design, used by the shared contract suite.
 *
 * Compare the size of this file with `../london/world.ts`. Standing the
 * feature up here means constructing the same four classes production would
 * construct, seeded with the scenario's data, plus one fake at the payment
 * boundary. The London wiring has to *write* six collaborators, because
 * driving from the outside produced six interfaces and no implementations.
 *
 * That gap is the trade in one picture: the London suite got its feedback
 * earlier and its unit stayed isolated, but somebody still owes six
 * implementations that no test has seen. Here the implementations came first
 * and the feature landed last.
 */

import { Catalogue, Promotions, type Promotion } from './catalogue'
import { FakePaymentGateway } from './fakePaymentGateway'
import { Inventory } from './inventory'
import { SequentialOrderIds } from './orderIds'
import { createPlaceOrder, type Collaborators } from './placeOrder'
import {
  DEFAULT_NOW,
  type Charge,
  type Scenario,
  type Sku,
  type World,
  type WorldFactory,
} from '../orderContract'

export type ClassicistWiring = {
  readonly collaborators: Collaborators
  readonly inventory: Inventory
  readonly gateway: FakePaymentGateway
}

export function buildClassicistWiring(scenario: Scenario): ClassicistWiring {
  const promotions: Record<string, Promotion> = {}
  for (const [code, promo] of Object.entries(scenario.promos ?? {})) {
    promotions[code] = { percentOff: promo.percentOff, expiresAt: new Date(promo.expiresAt) }
  }

  const inventory = new Inventory(scenario.stock)
  const gateway = new FakePaymentGateway(scenario.payment ?? 'accepts')

  return {
    collaborators: {
      catalogue: new Catalogue(scenario.prices),
      promotions: new Promotions(promotions),
      inventory,
      orderIds: new SequentialOrderIds('ORD'),
      payments: gateway,
    },
    inventory,
    gateway,
  }
}

export const createClassicistWorld: WorldFactory = (scenario: Scenario): World => {
  const { collaborators, inventory, gateway } = buildClassicistWiring(scenario)
  const placeOrder = createPlaceOrder(collaborators)
  // Time is a parameter of the call in this design, so the composition root is
  // where it gets fixed — here, to the scenario's instant.
  const now = new Date(scenario.now ?? DEFAULT_NOW)

  return {
    placeOrder: (command) => placeOrder(command, now),
    stockOf: (sku: Sku): number => inventory.availableOf(sku),
    charges: (): readonly Charge[] => gateway.charges(),
  }
}
