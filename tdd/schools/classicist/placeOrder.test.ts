// @vitest-environment node
/**
 * The classicist suite for the feature itself: real collaborators, one fake,
 * assertions about state.
 *
 * Read these next to `../london/placeOrder.test.ts`. Nothing here mentions a
 * call, an order of calls, or a number of calls. The questions are what the
 * order cost, what stock is left, and what the gateway is holding — and every
 * one of them is answered by looking at objects afterwards.
 *
 * Because the collaborators are real, these tests are also, unavoidably, tests
 * of `Money`, `Catalogue`, `Promotions` and `Inventory`. That is the trade: a
 * bug in the discount arithmetic fails here as well as in `money.test.ts`,
 * which is redundant when everything works and confusing at 2am when it does
 * not. What it buys is that these tests are still true after any refactor that
 * leaves the behaviour alone.
 */

import { describe, it, expect } from 'vitest'
import { Catalogue, Promotions } from './catalogue'
import { FakePaymentGateway } from './fakePaymentGateway'
import { Inventory } from './inventory'
import { SequentialOrderIds } from './orderIds'
import { createPlaceOrder } from './placeOrder'
import { DEFAULT_NOW } from '../orderContract'

const NOW = new Date(DEFAULT_NOW)
const EXPIRES = new Date('2026-04-01T00:00:00.000Z')

function makeSubject(options: { payment?: 'accepts' | 'declines' } = {}) {
  const inventory = new Inventory({ LATTE: 5, BEAN_BAG: 2 })
  const gateway = new FakePaymentGateway(options.payment ?? 'accepts')

  const placeOrder = createPlaceOrder({
    catalogue: new Catalogue({ LATTE: 350, BEAN_BAG: 1299 }),
    promotions: new Promotions({ SPRING: { percentOff: 25, expiresAt: EXPIRES } }),
    inventory,
    orderIds: new SequentialOrderIds('ORD'),
    payments: gateway,
  })

  return { placeOrder, inventory, gateway }
}

describe('placeOrder (classicist)', () => {
  it('confirms the order and leaves the gateway holding the total', async () => {
    const { placeOrder, gateway } = makeSubject()

    const result = await placeOrder(
      { customerId: 'cust-1', lines: [{ sku: 'LATTE', quantity: 2 }] },
      NOW,
    )

    expect(result).toEqual({ status: 'placed', orderId: 'ORD-1', totalCents: 700 })
    expect(gateway.charges()).toEqual([{ customerId: 'cust-1', amountCents: 700 }])
  })

  it('leaves the shop with less stock than it started with', async () => {
    const { placeOrder, inventory } = makeSubject()

    await placeOrder({ customerId: 'cust-1', lines: [{ sku: 'LATTE', quantity: 2 }] }, NOW)

    expect(inventory.availableOf('LATTE')).toBe(3)
  })

  it('numbers consecutive orders in sequence', async () => {
    const { placeOrder } = makeSubject()
    const command = { customerId: 'cust-1', lines: [{ sku: 'LATTE', quantity: 1 }] }

    const first = await placeOrder(command, NOW)
    const second = await placeOrder(command, NOW)

    expect(first).toMatchObject({ orderId: 'ORD-1' })
    expect(second).toMatchObject({ orderId: 'ORD-2' })
  })

  it('discounts the whole order for a live promo code', async () => {
    const { placeOrder, gateway } = makeSubject()

    const result = await placeOrder(
      {
        customerId: 'cust-1',
        lines: [{ sku: 'BEAN_BAG', quantity: 1 }],
        promoCode: 'SPRING',
      },
      NOW,
    )

    // 1299 × 25% off = 974.25, rounded half up to 974.
    expect(result).toMatchObject({ status: 'placed', totalCents: 974 })
    expect(gateway.charges()).toEqual([{ customerId: 'cust-1', amountCents: 974 }])
  })

  it('rejects an order priced with a promo that has expired by the time it is placed', async () => {
    const { placeOrder, gateway, inventory } = makeSubject()

    const result = await placeOrder(
      {
        customerId: 'cust-1',
        lines: [{ sku: 'BEAN_BAG', quantity: 1 }],
        promoCode: 'SPRING',
      },
      new Date('2026-04-02T00:00:00.000Z'),
    )

    expect(result).toEqual({ status: 'rejected', reason: 'INVALID_PROMO' })
    expect(gateway.charges()).toEqual([])
    expect(inventory.availableOf('BEAN_BAG')).toBe(2)
  })

  it('rejects an unknown sku with the shop untouched', async () => {
    const { placeOrder, gateway, inventory } = makeSubject()

    const result = await placeOrder(
      {
        customerId: 'cust-1',
        lines: [
          { sku: 'LATTE', quantity: 1 },
          { sku: 'NOT_A_THING', quantity: 1 },
        ],
      },
      NOW,
    )

    expect(result).toEqual({ status: 'rejected', reason: 'UNKNOWN_ITEM' })
    expect(inventory.availableOf('LATTE')).toBe(5)
    expect(gateway.charges()).toEqual([])
  })

  it('rejects an order for more than the shop has, keeping every unit', async () => {
    const { placeOrder, gateway, inventory } = makeSubject()

    const result = await placeOrder(
      {
        customerId: 'cust-1',
        lines: [
          { sku: 'LATTE', quantity: 1 },
          { sku: 'BEAN_BAG', quantity: 3 },
        ],
      },
      NOW,
    )

    expect(result).toEqual({ status: 'rejected', reason: 'OUT_OF_STOCK' })
    expect(inventory.availableOf('LATTE')).toBe(5)
    expect(inventory.availableOf('BEAN_BAG')).toBe(2)
    expect(gateway.charges()).toEqual([])
  })

  it('puts the stock back when the card is declined', async () => {
    const { placeOrder, inventory, gateway } = makeSubject({ payment: 'declines' })

    const result = await placeOrder(
      { customerId: 'cust-1', lines: [{ sku: 'LATTE', quantity: 2 }] },
      NOW,
    )

    expect(result).toEqual({ status: 'rejected', reason: 'PAYMENT_DECLINED' })
    expect(inventory.availableOf('LATTE')).toBe(5)
    expect(gateway.charges()).toEqual([])
  })

  it('lets the stock a declined order released be sold to somebody else', async () => {
    // The state assertion the London suite replaces with "release was called":
    // this one would still fail if `release` ran and put the stock back wrong.
    const { placeOrder, inventory } = makeSubject({ payment: 'declines' })

    await placeOrder({ customerId: 'cust-1', lines: [{ sku: 'BEAN_BAG', quantity: 2 }] }, NOW)

    expect(inventory.reserve([{ sku: 'BEAN_BAG', quantity: 2 }])).toBe(true)
  })

  it('rejects an empty order and a nonsense quantity before anything else happens', async () => {
    const { placeOrder, gateway } = makeSubject()

    expect(await placeOrder({ customerId: 'cust-1', lines: [] }, NOW)).toEqual({
      status: 'rejected',
      reason: 'EMPTY_ORDER',
    })
    expect(
      await placeOrder(
        { customerId: 'cust-1', lines: [{ sku: 'LATTE', quantity: 0 }] },
        NOW,
      ),
    ).toEqual({ status: 'rejected', reason: 'INVALID_QUANTITY' })
    expect(gateway.charges()).toEqual([])
  })
})
