// @vitest-environment node
/**
 * Five sentences in `requirements.md` that are not true of the code.
 *
 * Each one is asserted from both sides: the code produces the figure recorded
 * against it, and that figure is not the one the documentation implies. A
 * divergence that quietly got fixed fails the second assertion; a divergence
 * that got worse fails the first.
 *
 * The last test is the one that matters when somebody asks whether these can
 * simply be fixed. Three of the five bill more than the documentation
 * promises and two bill less, so there is no single direction in which
 * "correcting" the code is safe: three of the fixes are refunds and two are
 * price rises, and both kinds reach a customer.
 */

import { describe, expect, it } from 'vitest'

import { DIVERGENCES } from './divergences'

describe('documented against actual', () => {
  for (const divergence of DIVERGENCES) {
    describe(divergence.id, () => {
      it(`bills ${divergence.observedValue} where the documentation says ${divergence.documentedValue}`, () => {
        expect(divergence.probe()).toBe(divergence.observedValue)
      })

      it('has not quietly been made to agree with the documentation', () => {
        expect(divergence.observedValue).not.toBe(divergence.documentedValue)
      })
    })
  }

  it('records a disagreement for each of the five known areas', () => {
    expect(DIVERGENCES.map((divergence) => divergence.id)).toEqual([
      'VOLUME_TIER_BOUNDARY',
      'DISCOUNTS_COMPOUND',
      'CREDIT_BEFORE_COUPON',
      'TOTAL_MAY_BE_NEGATIVE',
      'GRANDFATHERING_BY_STRING',
    ])
  })

  it('charges the customer more than the documentation promises in three of the five', () => {
    const overcharges = DIVERGENCES.filter(
      (divergence) => divergence.observedValue > divergence.documentedValue,
    )

    expect(overcharges.map((divergence) => divergence.id)).toEqual([
      'VOLUME_TIER_BOUNDARY',
      'DISCOUNTS_COMPOUND',
      'CREDIT_BEFORE_COUPON',
    ])
    expect(DIVERGENCES.length - overcharges.length).toBe(2)
  })
})
