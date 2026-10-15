/** Two hops from `money.ts`. The deepest test in the fixture. */

import { describe, expect, it } from 'vitest'

import { cartLabel, cartTotal } from './cart.ts'
import { line, lines } from './support/factory.ts'

describe('cart totals', () => {
  it('adds up its lines', () => {
    expect(cartTotal(lines(3))).toBeExactInteger(2_250)
  })

  it('discounts only the lines over the threshold', () => {
    expect(cartTotal([line({ quantity: 3 }), line({ quantity: 12 })])).toBeExactInteger(3_600)
  })

  it('renders the total as a label', () => {
    expect(cartLabel(lines(2))).toBe('$15.00')
  })
})
