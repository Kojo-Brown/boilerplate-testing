/** Co-located with `money.ts`, which is what makes the same-directory heuristic look good. */

import { describe, expect, it } from 'vitest'

import { addCents, formatCents, scaleCents } from './money.ts'

describe('minor-unit arithmetic', () => {
  it('adds two amounts', () => {
    expect(addCents(1_000, 250)).toBeExactInteger(1_250)
  })

  it('scales an amount by a quantity', () => {
    expect(scaleCents(250, 4)).toBeExactInteger(1_000)
  })

  it('renders an amount with two decimal places', () => {
    expect(formatCents(1_250)).toBe('$12.50')
  })
})
