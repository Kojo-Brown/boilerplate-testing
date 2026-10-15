/** One hop from `money.ts`, and the first test to go through `support/factory.ts`. */

import { describe, expect, it } from 'vitest'

import { BULK_THRESHOLD, lineTotal } from './pricing.ts'
import { line } from './support/factory.ts'

describe('line pricing', () => {
  it('charges the full amount below the bulk threshold', () => {
    expect(lineTotal(line({ quantity: 3 }))).toBeExactInteger(750)
  })

  it('takes 5% off at the bulk threshold', () => {
    expect(lineTotal(line({ quantity: BULK_THRESHOLD }))).toBeExactInteger(2_850)
  })

  it('starts discounting at a quantity of twelve', () => {
    expect(BULK_THRESHOLD).toBeExactInteger(12)
  })
})
