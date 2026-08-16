/**
 * The behavioural contract that both schools are held to.
 *
 * A comparison of two TDD schools is only worth reading if both sides built
 * the *same* feature — otherwise the "London design" and the "classicist
 * design" are just two different programs, and every difference between them
 * could be explained by the difference in scope rather than the difference in
 * method. So the feature is specified once, here, as a suite that is run
 * against each implementation in `orderContract.test.ts`.
 *
 * Nothing in this file names a collaborator, a class, or an injection point.
 * It knows only what a caller can observe: the result of placing an order,
 * the stock left afterwards, and the charges that reached the payment
 * provider. That is deliberate — the whole disagreement between the schools is
 * about what happens *between* those observations, so a contract that
 * mentioned any of it would be scoring the match for one side.
 *
 * Each school supplies a `WorldFactory`: a function that builds its own
 * wiring from a plain `Scenario` and exposes it through the `World` port
 * below. The factories live next to the implementations they wire
 * (`london/world.ts`, `classicist/world.ts`) because how you stand a feature
 * up for a test is itself one of the things the two schools disagree about.
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// The feature's vocabulary
// ---------------------------------------------------------------------------

export type Sku = string

/** Money is integer minor units throughout. No floats, no rounding surprises. */
export type Cents = number

/** A whole-number percentage, 1–100. Fractional promos are out of scope. */
export type Percent = number

export type OrderLine = {
  readonly sku: Sku
  readonly quantity: number
}

export type PlaceOrderCommand = {
  readonly customerId: string
  readonly lines: readonly OrderLine[]
  readonly promoCode?: string
}

export type RejectionReason =
  | 'EMPTY_ORDER'
  | 'INVALID_QUANTITY'
  | 'UNKNOWN_ITEM'
  | 'OUT_OF_STOCK'
  | 'INVALID_PROMO'
  | 'PAYMENT_DECLINED'

export type PlaceOrderResult =
  | { readonly status: 'placed'; readonly orderId: string; readonly totalCents: Cents }
  | { readonly status: 'rejected'; readonly reason: RejectionReason }

// ---------------------------------------------------------------------------
// The world a school has to stand up to be tested
// ---------------------------------------------------------------------------

export type PromoDefinition = {
  readonly percentOff: Percent
  /** ISO 8601. The promo is valid strictly before this instant. */
  readonly expiresAt: string
}

export type Scenario = {
  readonly prices: Readonly<Record<Sku, Cents>>
  readonly stock: Readonly<Record<Sku, number>>
  readonly promos?: Readonly<Record<string, PromoDefinition>>
  /** ISO 8601 "now". Defaults to `DEFAULT_NOW` so promo expiry is deterministic. */
  readonly now?: string
  readonly payment?: 'accepts' | 'declines'
}

export type Charge = {
  readonly customerId: string
  readonly amountCents: Cents
}

export type World = {
  placeOrder(command: PlaceOrderCommand): Promise<PlaceOrderResult>
  /** Stock still available to a future order — reservations are subtracted. */
  stockOf(sku: Sku): number
  /**
   * Every charge the payment provider *accepted*, in order. A declined attempt
   * is not a charge, so `charges()` staying empty is the assertion that the
   * customer's card was never successfully billed.
   */
  charges(): readonly Charge[]
}

export type WorldFactory = (scenario: Scenario) => World

/** Fixed clock for every scenario that does not override it. */
export const DEFAULT_NOW = '2026-03-01T12:00:00.000Z'

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * Registers the shared suite for one school.
 *
 * Rounding rule, since it is the one piece of arithmetic both sides have to
 * agree on to the cent: a discount applies to the order total, not per line,
 * and the discounted total is rounded half up to whole cents.
 */
export function describeOrderContract(school: string, createWorld: WorldFactory): void {
  describe(`${school} — place order contract`, () => {
    it('charges the catalogue total and confirms the order', async () => {
      const world = createWorld({ prices: { LATTE: 350 }, stock: { LATTE: 5 } })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [{ sku: 'LATTE', quantity: 1 }],
      })

      expect(result).toEqual({
        status: 'placed',
        orderId: expect.any(String),
        totalCents: 350,
      })
      expect(world.charges()).toEqual([{ customerId: 'cust-1', amountCents: 350 }])
    })

    it('multiplies unit price by quantity across every line', async () => {
      const world = createWorld({
        prices: { LATTE: 350, BEAN_BAG: 1299 },
        stock: { LATTE: 10, BEAN_BAG: 10 },
      })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [
          { sku: 'LATTE', quantity: 3 },
          { sku: 'BEAN_BAG', quantity: 2 },
        ],
      })

      // 3 × 350 + 2 × 1299 = 3648
      expect(result).toEqual({ status: 'placed', orderId: expect.any(String), totalCents: 3648 })
      expect(world.charges()).toEqual([{ customerId: 'cust-1', amountCents: 3648 }])
    })

    it('takes the ordered quantity out of available stock', async () => {
      const world = createWorld({ prices: { LATTE: 350 }, stock: { LATTE: 5 } })

      await world.placeOrder({ customerId: 'cust-1', lines: [{ sku: 'LATTE', quantity: 2 }] })

      expect(world.stockOf('LATTE')).toBe(3)
    })

    it('gives each placed order a distinct id', async () => {
      const world = createWorld({ prices: { LATTE: 350 }, stock: { LATTE: 5 } })
      const line = [{ sku: 'LATTE', quantity: 1 }]

      const first = await world.placeOrder({ customerId: 'cust-1', lines: line })
      const second = await world.placeOrder({ customerId: 'cust-1', lines: line })

      expect(first.status).toBe('placed')
      expect(second.status).toBe('placed')
      const firstId = first.status === 'placed' ? first.orderId : ''
      const secondId = second.status === 'placed' ? second.orderId : ''
      expect(firstId).not.toBe('')
      expect(secondId).not.toBe(firstId)
    })

    it('rejects an order with no lines, without charging', async () => {
      const world = createWorld({ prices: { LATTE: 350 }, stock: { LATTE: 5 } })

      const result = await world.placeOrder({ customerId: 'cust-1', lines: [] })

      expect(result).toEqual({ status: 'rejected', reason: 'EMPTY_ORDER' })
      expect(world.charges()).toEqual([])
    })

    it('rejects a line whose quantity is not a positive whole number', async () => {
      const world = createWorld({ prices: { LATTE: 350 }, stock: { LATTE: 5 } })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [{ sku: 'LATTE', quantity: 0 }],
      })

      expect(result).toEqual({ status: 'rejected', reason: 'INVALID_QUANTITY' })
      expect(world.charges()).toEqual([])
      expect(world.stockOf('LATTE')).toBe(5)
    })

    it('rejects an unknown sku, reserving nothing and charging nothing', async () => {
      const world = createWorld({ prices: { LATTE: 350 }, stock: { LATTE: 5 } })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [
          { sku: 'LATTE', quantity: 1 },
          { sku: 'NOT_A_THING', quantity: 1 },
        ],
      })

      expect(result).toEqual({ status: 'rejected', reason: 'UNKNOWN_ITEM' })
      expect(world.stockOf('LATTE')).toBe(5)
      expect(world.charges()).toEqual([])
    })

    it('rejects an order that exceeds available stock, without charging', async () => {
      const world = createWorld({ prices: { LATTE: 350 }, stock: { LATTE: 1 } })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [{ sku: 'LATTE', quantity: 2 }],
      })

      expect(result).toEqual({ status: 'rejected', reason: 'OUT_OF_STOCK' })
      expect(world.stockOf('LATTE')).toBe(1)
      expect(world.charges()).toEqual([])
    })

    it('reserves nothing at all when a later line is out of stock', async () => {
      const world = createWorld({
        prices: { LATTE: 350, BEAN_BAG: 1299 },
        stock: { LATTE: 5, BEAN_BAG: 0 },
      })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [
          { sku: 'LATTE', quantity: 1 },
          { sku: 'BEAN_BAG', quantity: 1 },
        ],
      })

      expect(result).toEqual({ status: 'rejected', reason: 'OUT_OF_STOCK' })
      // The partial reservation for the first line must not survive.
      expect(world.stockOf('LATTE')).toBe(5)
      expect(world.charges()).toEqual([])
    })

    it('applies a percentage discount for a valid promo code', async () => {
      const world = createWorld({
        prices: { BEAN_BAG: 2000 },
        stock: { BEAN_BAG: 5 },
        promos: { SPRING: { percentOff: 25, expiresAt: '2026-04-01T00:00:00.000Z' } },
      })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [{ sku: 'BEAN_BAG', quantity: 1 }],
        promoCode: 'SPRING',
      })

      expect(result).toEqual({ status: 'placed', orderId: expect.any(String), totalCents: 1500 })
      expect(world.charges()).toEqual([{ customerId: 'cust-1', amountCents: 1500 }])
    })

    it('rounds a discounted total half up to whole cents', async () => {
      const world = createWorld({
        prices: { LATTE: 999 },
        stock: { LATTE: 5 },
        promos: { HALF: { percentOff: 50, expiresAt: '2026-04-01T00:00:00.000Z' } },
      })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [{ sku: 'LATTE', quantity: 1 }],
        promoCode: 'HALF',
      })

      // 999 × 50% = 499.5, which rounds up to 500 rather than truncating to 499.
      expect(result).toEqual({ status: 'placed', orderId: expect.any(String), totalCents: 500 })
    })

    it('rejects an unknown promo code, without charging', async () => {
      const world = createWorld({
        prices: { LATTE: 350 },
        stock: { LATTE: 5 },
        promos: { SPRING: { percentOff: 25, expiresAt: '2026-04-01T00:00:00.000Z' } },
      })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [{ sku: 'LATTE', quantity: 1 }],
        promoCode: 'MADE_UP',
      })

      expect(result).toEqual({ status: 'rejected', reason: 'INVALID_PROMO' })
      expect(world.charges()).toEqual([])
      expect(world.stockOf('LATTE')).toBe(5)
    })

    it('rejects a promo code that expired before now', async () => {
      const world = createWorld({
        prices: { LATTE: 350 },
        stock: { LATTE: 5 },
        promos: { WINTER: { percentOff: 25, expiresAt: '2026-02-01T00:00:00.000Z' } },
        now: '2026-03-01T12:00:00.000Z',
      })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [{ sku: 'LATTE', quantity: 1 }],
        promoCode: 'WINTER',
      })

      expect(result).toEqual({ status: 'rejected', reason: 'INVALID_PROMO' })
      expect(world.charges()).toEqual([])
    })

    it('releases the reservation when the payment is declined', async () => {
      const world = createWorld({
        prices: { LATTE: 350 },
        stock: { LATTE: 5 },
        payment: 'declines',
      })

      const result = await world.placeOrder({
        customerId: 'cust-1',
        lines: [{ sku: 'LATTE', quantity: 2 }],
      })

      expect(result).toEqual({ status: 'rejected', reason: 'PAYMENT_DECLINED' })
      // The customer keeps nothing and the shop keeps its stock.
      expect(world.stockOf('LATTE')).toBe(5)
    })
  })
}
