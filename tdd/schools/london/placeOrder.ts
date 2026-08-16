/**
 * The feature, driven outside-in (London school).
 *
 * This module was written from its test inwards. The first test asked for an
 * order to be placed and had nothing to place it with, so a collaborator was
 * invented — a `Catalogue` that knows a price — and immediately mocked. The
 * next question invented the next collaborator, and so on until the story was
 * finished. Every interface below is a hole the test needed, discovered in the
 * order the test needed it; none of them has an implementation here, because
 * the outside-in cycle never had a reason to write one. The implementations
 * belong to whoever wires this up at the composition root.
 *
 * What that buys, and what it costs, is argued in `../README.md`. The short
 * version: this file contains no state, no domain objects, and no arithmetic
 * anyone would call a model. It is a protocol — an order of operations over
 * six ports — and a protocol is exactly what mockist tests are good at
 * pinning down.
 */

import type {
  Cents,
  Percent,
  PlaceOrderCommand,
  PlaceOrderResult,
  Sku,
} from '../orderContract'

// ---------------------------------------------------------------------------
// The ports, in the order the tests invented them
// ---------------------------------------------------------------------------

export interface Catalogue {
  /** `null` — not a thrown error — is how "no such sku" arrives. */
  priceOf(sku: Sku): Promise<Cents | null>
}

export interface Inventory {
  /** `false` means the reservation did not happen; nothing is held. */
  reserve(sku: Sku, quantity: number): Promise<boolean>
  release(sku: Sku, quantity: number): Promise<void>
}

export interface Promotions {
  /** `null` for a code that does not exist or has expired at `now`. */
  discountFor(code: string, now: Date): Promise<Percent | null>
}

export type PaymentOutcome = { readonly accepted: boolean }

export interface Payments {
  charge(customerId: string, amountCents: Cents): Promise<PaymentOutcome>
}

export interface OrderIds {
  next(): string
}

export interface Clock {
  now(): Date
}

export type PlaceOrderDeps = {
  readonly catalogue: Catalogue
  readonly inventory: Inventory
  readonly promotions: Promotions
  readonly payments: Payments
  readonly orderIds: OrderIds
  readonly clock: Clock
}

/**
 * The collaborators this design puts behind a test double, sorted.
 *
 * It is every one of them, which is the honest summary of the trade: the unit
 * under test is the protocol, so everything the protocol talks to is a double.
 * `../design.test.ts` checks this list against the wiring that actually runs
 * the contract, so the README's headline number cannot drift away from the code.
 */
export const LONDON_SEAMS = [
  'catalogue',
  'clock',
  'inventory',
  'orderIds',
  'payments',
  'promotions',
] as const

// ---------------------------------------------------------------------------
// The orchestrator
// ---------------------------------------------------------------------------

type PricedLine = { readonly sku: Sku; readonly quantity: number; readonly unitPrice: Cents }

/**
 * Half-up rounding in integer arithmetic.
 *
 * `subtotal * (100 - percent)` is an exact integer for whole-percent promos,
 * so adding 50 before the floor divide rounds half up without ever creating a
 * float. `Math.round(subtotal * (1 - percent / 100))` looks equivalent and is
 * not: the intermediate is a binary fraction, and a total that should land
 * exactly on .5 can arrive as .4999999999 and round the customer's way by
 * accident. The classicist side does the same arithmetic in `Money`.
 */
function applyDiscount(subtotal: Cents, percentOff: Percent): Cents {
  return Math.floor((subtotal * (100 - percentOff) + 50) / 100)
}

export function createPlaceOrder(
  deps: PlaceOrderDeps,
): (command: PlaceOrderCommand) => Promise<PlaceOrderResult> {
  const { catalogue, inventory, promotions, payments, orderIds, clock } = deps

  return async function placeOrder(command: PlaceOrderCommand): Promise<PlaceOrderResult> {
    if (command.lines.length === 0) {
      return { status: 'rejected', reason: 'EMPTY_ORDER' }
    }
    if (command.lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) {
      return { status: 'rejected', reason: 'INVALID_QUANTITY' }
    }

    // Price first, so an unknown sku costs nothing to discover: no reservation
    // has been taken yet and there is nothing to unwind.
    const priced: PricedLine[] = []
    for (const line of command.lines) {
      const unitPrice = await catalogue.priceOf(line.sku)
      if (unitPrice === null) {
        return { status: 'rejected', reason: 'UNKNOWN_ITEM' }
      }
      priced.push({ sku: line.sku, quantity: line.quantity, unitPrice })
    }

    const subtotal = priced.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)

    let total = subtotal
    if (command.promoCode !== undefined) {
      const percentOff = await promotions.discountFor(command.promoCode, clock.now())
      if (percentOff === null) {
        return { status: 'rejected', reason: 'INVALID_PROMO' }
      }
      total = applyDiscount(subtotal, percentOff)
    }

    // Reserve line by line, remembering what was taken. The inventory port is
    // deliberately per-sku: an all-or-nothing `reserve(lines)` would push the
    // atomicity into a collaborator, and this design's tests would then be
    // asserting that someone else got it right.
    const reserved: PricedLine[] = []
    for (const line of priced) {
      const held = await inventory.reserve(line.sku, line.quantity)
      if (!held) {
        await releaseAll(inventory, reserved)
        return { status: 'rejected', reason: 'OUT_OF_STOCK' }
      }
      reserved.push(line)
    }

    const outcome = await payments.charge(command.customerId, total)
    if (!outcome.accepted) {
      await releaseAll(inventory, reserved)
      return { status: 'rejected', reason: 'PAYMENT_DECLINED' }
    }

    return { status: 'placed', orderId: orderIds.next(), totalCents: total }
  }
}

async function releaseAll(inventory: Inventory, lines: readonly PricedLine[]): Promise<void> {
  for (const line of lines) {
    await inventory.release(line.sku, line.quantity)
  }
}
