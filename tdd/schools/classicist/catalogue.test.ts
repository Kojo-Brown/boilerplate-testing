// @vitest-environment node
/**
 * Catalogue and Promotions, tested as objects rather than through the feature.
 *
 * The expiry edge below is the test that has no counterpart in the London
 * suite: over there, `Promotions` is an interface, and a mock told to return
 * `25` returns `25` no matter what instant it is handed.
 */

import { describe, it, expect } from 'vitest'
import { Catalogue, Promotions } from './catalogue'
import { Money } from './money'

describe('Catalogue', () => {
  const catalogue = new Catalogue({ LATTE: 350, BEAN_BAG: 1299 })

  it('prices a sku it stocks', () => {
    expect(catalogue.priceOf('LATTE')?.equals(Money.fromCents(350))).toBe(true)
  })

  it('has no price for a sku it does not stock', () => {
    expect(catalogue.priceOf('NOT_A_THING')).toBeUndefined()
  })

  it('refuses to be built with a fractional price', () => {
    expect(() => new Catalogue({ LATTE: 3.5 })).toThrow(RangeError)
  })
})

describe('Promotions', () => {
  const expiresAt = new Date('2026-04-01T00:00:00.000Z')
  const promotions = new Promotions({ SPRING: { percentOff: 25, expiresAt } })

  it('gives the discount for a live code', () => {
    expect(promotions.discountFor('SPRING', new Date('2026-03-31T23:59:59.999Z'))).toBe(25)
  })

  it('has no discount for a code it does not know', () => {
    expect(promotions.discountFor('MADE_UP', new Date('2026-03-01T00:00:00.000Z'))).toBeUndefined()
  })

  it('has no discount at the exact instant of expiry', () => {
    // Expiry is exclusive. Stated here because it is the kind of boundary that
    // gets decided by accident when it is only ever exercised end to end.
    expect(promotions.discountFor('SPRING', expiresAt)).toBeUndefined()
  })

  it('has no discount after expiry', () => {
    expect(promotions.discountFor('SPRING', new Date('2026-04-02T00:00:00.000Z'))).toBeUndefined()
  })
})
