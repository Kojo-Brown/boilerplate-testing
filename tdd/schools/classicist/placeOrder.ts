/**
 * The feature, assembled last (classicist / Detroit school).
 *
 * Inside-out builds the pieces that can be judged on their own — `Money`,
 * `Catalogue`, `Promotions`, `Inventory`, `priceLines` — and only then writes
 * the thing that puts them in a row. By the time this file appeared, every
 * decision it makes had already been settled and tested somewhere else, which
 * is why it is so thin: no arithmetic, no expiry rule, no unwind protocol.
 *
 * The one interface in the module is `PaymentGateway`, and it exists for the
 * reason a classicist tolerates any double: on the other side of it is a
 * third party over a network that will not take a test card for free. It is a
 * boundary of the system, not a seam invented to make a test easier.
 */

import type { Catalogue, Promotions } from './catalogue'
import type { Inventory } from './inventory'
import type { Money } from './money'
import type { SequentialOrderIds } from './orderIds'
import { priceLines, validateLines } from './order'
import type { PlaceOrderCommand, PlaceOrderResult } from '../orderContract'

export type PaymentOutcome = { readonly accepted: boolean }

/** The system's edge: somebody else's server, reached over somebody else's network. */
export interface PaymentGateway {
  charge(customerId: string, amount: Money): Promise<PaymentOutcome>
}

export type Collaborators = {
  readonly catalogue: Catalogue
  readonly promotions: Promotions
  readonly inventory: Inventory
  readonly orderIds: SequentialOrderIds
  readonly payments: PaymentGateway
}

/**
 * The collaborators this design puts behind a test double, sorted.
 *
 * One of five. The other four are the production classes, constructed with
 * test data — a `Catalogue` with two prices in it is still a `Catalogue`.
 * `../design.test.ts` proves that claim against the wiring that actually runs
 * the contract, by checking what the world hands over is an instance of the
 * real class rather than a stand-in.
 */
export const CLASSICIST_DOUBLES = ['payments'] as const

/**
 * `now` is a parameter rather than an injected clock.
 *
 * Time is data here, pushed to the edge and passed in by whoever is calling.
 * The London design has a `Clock` port instead — the difference is not depth
 * of thought, it is the method: outside-in invents a collaborator for anything
 * the unit cannot supply itself, and "what time is it" is one of those things.
 */
export function createPlaceOrder(collaborators: Collaborators) {
  const { catalogue, promotions, inventory, orderIds, payments } = collaborators

  return async function placeOrder(
    command: PlaceOrderCommand,
    now: Date,
  ): Promise<PlaceOrderResult> {
    const problem = validateLines(command.lines)
    if (problem !== undefined) {
      return { status: 'rejected', reason: problem }
    }

    const pricing = priceLines(command.lines, catalogue)
    if (!pricing.ok) {
      return { status: 'rejected', reason: 'UNKNOWN_ITEM' }
    }

    let total = pricing.total
    if (command.promoCode !== undefined) {
      const percentOff = promotions.discountFor(command.promoCode, now)
      if (percentOff === undefined) {
        return { status: 'rejected', reason: 'INVALID_PROMO' }
      }
      total = total.discountedBy(percentOff)
    }

    // All-or-nothing, so there is no partial reservation to unwind.
    if (!inventory.reserve(command.lines)) {
      return { status: 'rejected', reason: 'OUT_OF_STOCK' }
    }

    const outcome = await payments.charge(command.customerId, total)
    if (!outcome.accepted) {
      inventory.release(command.lines)
      return { status: 'rejected', reason: 'PAYMENT_DECLINED' }
    }

    return { status: 'placed', orderId: orderIds.next(), totalCents: total.cents }
  }
}
