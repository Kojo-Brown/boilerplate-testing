// @vitest-environment node
/**
 * The London-school suite: one unit, six doubles, assertions about messages.
 *
 * Read these next to `../classicist/placeOrder.test.ts`, which covers the same
 * feature by asserting on state. Almost nothing here says what the order cost.
 * These tests say what was *said to whom, in what order* — that pricing
 * finishes before stock is touched, that money is only taken once the goods
 * are held, that a failed charge hands the stock back. Those are the claims
 * that are cheap to state here and awkward to state anywhere else, because a
 * final snapshot of stock and charges cannot tell you what order things
 * happened in.
 *
 * The doubles are `vi.fn()` rather than hand-written stubs on purpose: the
 * assertions need call order and call counts, and a hand-rolled spy that
 * recorded those would just be a worse `vi.fn()`.
 */

import { describe, it, expect, vi } from 'vitest'
import { createPlaceOrder, type PaymentOutcome, type PlaceOrderDeps } from './placeOrder'
import { DEFAULT_NOW, type Cents, type Percent, type Sku } from '../orderContract'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

type DoubleOptions = {
  readonly prices?: Readonly<Record<Sku, Cents>>
  readonly stockedOut?: readonly Sku[]
  readonly discounts?: Readonly<Record<string, Percent>>
  readonly payment?: 'accepts' | 'declines'
}

function makeSubject(options: DoubleOptions = {}) {
  const prices = options.prices ?? { LATTE: 350, BEAN_BAG: 1299 }
  const stockedOut = new Set(options.stockedOut ?? [])
  const discounts = options.discounts ?? {}

  const priceOf = vi.fn(
    async (sku: Sku): Promise<Cents | null> => prices[sku] ?? null,
  )
  const reserve = vi.fn(async (sku: Sku, _quantity: number): Promise<boolean> => !stockedOut.has(sku))
  const release = vi.fn(async (_sku: Sku, _quantity: number): Promise<void> => undefined)
  const discountFor = vi.fn(
    async (code: string, _now: Date): Promise<Percent | null> => discounts[code] ?? null,
  )
  const charge = vi.fn(
    async (_customerId: string, _amountCents: Cents): Promise<PaymentOutcome> => ({
      accepted: options.payment !== 'declines',
    }),
  )
  const next = vi.fn((): string => 'order-1')
  const now = vi.fn((): Date => new Date(DEFAULT_NOW))

  const deps: PlaceOrderDeps = {
    catalogue: { priceOf },
    inventory: { reserve, release },
    promotions: { discountFor },
    payments: { charge },
    orderIds: { next },
    clock: { now },
  }

  return { placeOrder: createPlaceOrder(deps), priceOf, reserve, release, discountFor, charge, next, now }
}

/** Vitest stamps every call with a global sequence number; these read it. */
function firstCallOrder(double: { mock: { invocationCallOrder: number[] } }): number {
  const [first] = double.mock.invocationCallOrder
  if (first === undefined) throw new Error('expected the double to have been called at least once')
  return first
}

function lastCallOrder(double: { mock: { invocationCallOrder: number[] } }): number {
  const last = double.mock.invocationCallOrder.at(-1)
  if (last === undefined) throw new Error('expected the double to have been called at least once')
  return last
}

// ---------------------------------------------------------------------------

describe('placeOrder (London school)', () => {
  const oneLatte = [{ sku: 'LATTE', quantity: 1 }]

  it('finishes pricing every line before it touches inventory', async () => {
    const { placeOrder, priceOf, reserve } = makeSubject()

    await placeOrder({
      customerId: 'cust-1',
      lines: [
        { sku: 'LATTE', quantity: 1 },
        { sku: 'BEAN_BAG', quantity: 1 },
      ],
    })

    expect(priceOf).toHaveBeenCalledTimes(2)
    expect(lastCallOrder(priceOf)).toBeLessThan(firstCallOrder(reserve))
  })

  it('holds the stock before it takes any money', async () => {
    const { placeOrder, reserve, charge } = makeSubject()

    await placeOrder({ customerId: 'cust-1', lines: oneLatte })

    expect(firstCallOrder(reserve)).toBeLessThan(firstCallOrder(charge))
  })

  it('charges the customer exactly once for a multi-line order', async () => {
    const { placeOrder, charge } = makeSubject()

    await placeOrder({
      customerId: 'cust-1',
      lines: [
        { sku: 'LATTE', quantity: 3 },
        { sku: 'BEAN_BAG', quantity: 2 },
      ],
    })

    expect(charge).toHaveBeenCalledExactlyOnceWith('cust-1', 3648)
  })

  it('neither reserves nor charges when the catalogue does not know a sku', async () => {
    const { placeOrder, reserve, charge } = makeSubject()

    const result = await placeOrder({
      customerId: 'cust-1',
      lines: [{ sku: 'NOT_A_THING', quantity: 1 }],
    })

    expect(result).toEqual({ status: 'rejected', reason: 'UNKNOWN_ITEM' })
    expect(reserve).not.toHaveBeenCalled()
    expect(charge).not.toHaveBeenCalled()
  })

  it('releases exactly the lines it had already reserved when a later one is unavailable', async () => {
    const { placeOrder, release, charge } = makeSubject({ stockedOut: ['BEAN_BAG'] })

    const result = await placeOrder({
      customerId: 'cust-1',
      lines: [
        { sku: 'LATTE', quantity: 2 },
        { sku: 'BEAN_BAG', quantity: 1 },
      ],
    })

    expect(result).toEqual({ status: 'rejected', reason: 'OUT_OF_STOCK' })
    // Not the bean bag: that reservation was refused, so releasing it would be
    // handing back stock the shop never held.
    expect(release).toHaveBeenCalledExactlyOnceWith('LATTE', 2)
    expect(charge).not.toHaveBeenCalled()
  })

  it('releases every reservation when the charge is declined', async () => {
    const { placeOrder, release } = makeSubject({ payment: 'declines' })

    const result = await placeOrder({
      customerId: 'cust-1',
      lines: [
        { sku: 'LATTE', quantity: 2 },
        { sku: 'BEAN_BAG', quantity: 1 },
      ],
    })

    expect(result).toEqual({ status: 'rejected', reason: 'PAYMENT_DECLINED' })
    expect(release.mock.calls).toEqual([
      ['LATTE', 2],
      ['BEAN_BAG', 1],
    ])
  })

  it('releases nothing when the charge is accepted', async () => {
    const { placeOrder, release } = makeSubject()

    await placeOrder({ customerId: 'cust-1', lines: oneLatte })

    expect(release).not.toHaveBeenCalled()
  })

  it('asks promotions about the code using the instant the clock reports', async () => {
    const { placeOrder, discountFor, now } = makeSubject({ discounts: { SPRING: 25 } })

    await placeOrder({ customerId: 'cust-1', lines: oneLatte, promoCode: 'SPRING' })

    expect(now).toHaveBeenCalled()
    expect(discountFor).toHaveBeenCalledExactlyOnceWith('SPRING', new Date(DEFAULT_NOW))
  })

  it('does not consult promotions when the command carries no code', async () => {
    const { placeOrder, discountFor, charge } = makeSubject()

    await placeOrder({ customerId: 'cust-1', lines: oneLatte })

    expect(discountFor).not.toHaveBeenCalled()
    expect(charge).toHaveBeenCalledExactlyOnceWith('cust-1', 350)
  })

  it('stops at the promotions check, before any stock is held, for a bad code', async () => {
    const { placeOrder, reserve, charge } = makeSubject()

    const result = await placeOrder({
      customerId: 'cust-1',
      lines: oneLatte,
      promoCode: 'MADE_UP',
    })

    expect(result).toEqual({ status: 'rejected', reason: 'INVALID_PROMO' })
    expect(reserve).not.toHaveBeenCalled()
    expect(charge).not.toHaveBeenCalled()
  })

  it('labels the placed order with the id the generator hands it', async () => {
    const { placeOrder, next } = makeSubject()
    next.mockReturnValueOnce('order-abc')

    const result = await placeOrder({ customerId: 'cust-1', lines: oneLatte })

    expect(result).toEqual({ status: 'placed', orderId: 'order-abc', totalCents: 350 })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('does not mint an order id for an order it rejects', async () => {
    const { placeOrder, next } = makeSubject({ payment: 'declines' })

    await placeOrder({ customerId: 'cust-1', lines: oneLatte })

    expect(next).not.toHaveBeenCalled()
  })
})
