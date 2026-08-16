// @vitest-environment node
/**
 * Pricing and validation, exercised against a real Catalogue.
 *
 * No double appears in this file. `priceLines` needs a catalogue, and the
 * cheapest honest way to give it one is to build one — a two-item catalogue is
 * less code than a stub of it would be, and it cannot disagree with the real
 * class about what "unknown sku" means.
 */

import { describe, it, expect } from 'vitest'
import { Catalogue } from './catalogue'
import { Money } from './money'
import { priceLines, validateLines } from './order'

const catalogue = new Catalogue({ LATTE: 350, BEAN_BAG: 1299 })

describe('validateLines', () => {
  it('accepts well-formed lines', () => {
    expect(validateLines([{ sku: 'LATTE', quantity: 1 }])).toBeUndefined()
  })

  it('rejects an order with no lines', () => {
    expect(validateLines([])).toBe('EMPTY_ORDER')
  })

  it('rejects a zero, negative, or fractional quantity', () => {
    expect(validateLines([{ sku: 'LATTE', quantity: 0 }])).toBe('INVALID_QUANTITY')
    expect(validateLines([{ sku: 'LATTE', quantity: -1 }])).toBe('INVALID_QUANTITY')
    expect(validateLines([{ sku: 'LATTE', quantity: 1.5 }])).toBe('INVALID_QUANTITY')
  })

  it('rejects when any line is bad, not just the first', () => {
    expect(
      validateLines([
        { sku: 'LATTE', quantity: 1 },
        { sku: 'BEAN_BAG', quantity: 0 },
      ]),
    ).toBe('INVALID_QUANTITY')
  })
})

describe('priceLines', () => {
  it('totals one line at its unit price', () => {
    const result = priceLines([{ sku: 'LATTE', quantity: 1 }], catalogue)

    expect(result).toEqual({ ok: true, total: Money.fromCents(350) })
  })

  it('totals quantities across lines', () => {
    const result = priceLines(
      [
        { sku: 'LATTE', quantity: 3 },
        { sku: 'BEAN_BAG', quantity: 2 },
      ],
      catalogue,
    )

    expect(result).toEqual({ ok: true, total: Money.fromCents(3648) })
  })

  it('names the sku it could not price', () => {
    const result = priceLines(
      [
        { sku: 'LATTE', quantity: 1 },
        { sku: 'NOT_A_THING', quantity: 1 },
      ],
      catalogue,
    )

    expect(result).toEqual({ ok: false, unknownSku: 'NOT_A_THING' })
  })

  it('throws if it is handed no lines at all', () => {
    // Unreachable through `placeOrder`, which validates first. Stated so the
    // precondition is a checked one rather than an assumption.
    expect(() => priceLines([], catalogue)).toThrow(/validate the command first/)
  })
})
