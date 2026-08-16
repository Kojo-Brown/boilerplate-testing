// @vitest-environment node
/**
 * The first suite the classicist cycle wrote. Nothing here knows what an order
 * is; these are the arithmetic rules the feature is later assembled out of.
 */

import { describe, it, expect } from 'vitest'
import { Money } from './money'

describe('Money', () => {
  it('adds two amounts', () => {
    expect(Money.fromCents(350).plus(Money.fromCents(1299)).cents).toBe(1649)
  })

  it('multiplies by a quantity', () => {
    expect(Money.fromCents(350).times(3).cents).toBe(1050)
  })

  it('multiplies to nothing by zero', () => {
    expect(Money.fromCents(350).times(0).equals(Money.zero())).toBe(true)
  })

  it('takes a whole-percent discount', () => {
    expect(Money.fromCents(2000).discountedBy(25).cents).toBe(1500)
  })

  it('rounds a half-cent discount up rather than truncating it', () => {
    // 999 × 50% = 499.5. Truncation would quietly favour the customer on every
    // odd-cent price in the shop.
    expect(Money.fromCents(999).discountedBy(50).cents).toBe(500)
  })

  it('rounds a discount that lands just below a half-cent down', () => {
    // 1999 × 15% off = 1699.15
    expect(Money.fromCents(1999).discountedBy(15).cents).toBe(1699)
  })

  it('leaves the amount alone at 0% and empties it at 100%', () => {
    expect(Money.fromCents(1234).discountedBy(0).cents).toBe(1234)
    expect(Money.fromCents(1234).discountedBy(100).cents).toBe(0)
  })

  it('refuses fractional cents', () => {
    expect(() => Money.fromCents(12.5)).toThrow(RangeError)
  })

  it('refuses a negative amount', () => {
    expect(() => Money.fromCents(-1)).toThrow(RangeError)
  })

  it('refuses a fractional or negative quantity', () => {
    expect(() => Money.fromCents(350).times(1.5)).toThrow(RangeError)
    expect(() => Money.fromCents(350).times(-1)).toThrow(RangeError)
  })

  it('refuses a percentage outside 0–100', () => {
    expect(() => Money.fromCents(350).discountedBy(101)).toThrow(RangeError)
    expect(() => Money.fromCents(350).discountedBy(-5)).toThrow(RangeError)
    expect(() => Money.fromCents(350).discountedBy(12.5)).toThrow(RangeError)
  })

  it('formats itself in major units', () => {
    expect(Money.fromCents(1699).toString()).toBe('16.99')
    expect(Money.fromCents(5).toString()).toBe('0.05')
  })
})
