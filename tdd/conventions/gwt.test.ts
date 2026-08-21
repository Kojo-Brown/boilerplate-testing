// @vitest-environment node
/**
 * The refund policy, in Given-When-Then.
 *
 * Same eight behaviours as `aaa.test.ts`, same assertions, same fixtures — the
 * structure has just moved out of the bodies and into the titles. There are no
 * phase markers here, because the nesting *is* the phase marker: the `Given`
 * describe arranges, the `When` describe names the act, and the case states
 * the outcome.
 *
 * That is what makes this the shape a linter can check hardest.
 * `test-conventions/title-scheme` in `given-when-then` mode knows the whole
 * sentence — it can tell that a case is missing its when-clause, or that a
 * third level of describe has appeared, neither of which is visible to any
 * rule reading an Arrange-Act-Assert file. It still cannot tell you whether
 * the sentence is *true*.
 *
 * The cost is visible in the same place: five `Given` blocks and eight `When`
 * blocks wrap eight cases, and three of those `When` blocks exist to hold one
 * case each. `conventions.test.ts` counts them, and the README argues about
 * whether that trade is worth taking.
 */

import { describe, expect, it } from 'vitest'

import { assessRefund } from './refundPolicy'
import type { Order } from './refundPolicy'

const DELIVERED_AT = new Date('2026-03-01T09:00:00Z')

function hoursAfterDelivery(hours: number): Date {
  return new Date(DELIVERED_AT.getTime() + hours * 60 * 60 * 1000)
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    priceCents: 4_999,
    category: 'standard',
    deliveredAt: DELIVERED_AT,
    opened: false,
    ...overrides,
  }
}

describe('Given a final-sale order', () => {
  const clearanceMug = order({ category: 'final-sale' })

  describe('When a refund is requested the day after delivery', () => {
    it('then it is denied', () => {
      expect(assessRefund(clearanceMug, hoursAfterDelivery(24))).toEqual({
        outcome: 'denied',
        amountCents: 0,
        reason: 'final sale',
      })
    })
  })
})

describe('Given a standard order that has not been delivered', () => {
  const inTransit = order({ deliveredAt: null })

  describe('When a refund is requested', () => {
    it('then the full price comes back', () => {
      const decision = assessRefund(inTransit, hoursAfterDelivery(-12))

      expect(decision.outcome).toBe('full')
      expect(decision.amountCents).toBe(4_999)
      expect(decision.reason).toBe('not delivered yet')
    })
  })
})

describe('Given a delivered, unopened standard order', () => {
  const sealed = order({ opened: false })

  describe('When a refund is requested inside the 30-day window', () => {
    it('then the full price comes back', () => {
      const decision = assessRefund(sealed, hoursAfterDelivery(29 * 24))

      expect(decision.outcome).toBe('full')
      expect(decision.amountCents).toBe(4_999)
    })
  })

  describe('When a refund is requested after the 30-day window', () => {
    it('then it is denied', () => {
      const decision = assessRefund(sealed, hoursAfterDelivery(30 * 24 + 1))

      expect(decision.outcome).toBe('denied')
      expect(decision.amountCents).toBe(0)
      expect(decision.reason).toBe('return window of 720h has closed')
    })
  })
})

describe('Given a delivered, opened standard order', () => {
  describe('When a refund is requested inside the 30-day window', () => {
    it('then a restocking fee is withheld', () => {
      const decision = assessRefund(order({ opened: true }), hoursAfterDelivery(24))

      expect(decision.outcome).toBe('partial')
      expect(decision.amountCents).toBe(4_249)
      expect(decision.reason).toBe('opened: restocking fee withheld')
    })
  })

  describe('When the price makes the fee land on half a cent', () => {
    it('then the refund is a whole number of cents', () => {
      const oddlyPriced = order({ priceCents: 1_010, opened: true })

      const decision = assessRefund(oddlyPriced, hoursAfterDelivery(24))

      expect(decision.amountCents).toBe(859)
      expect(Number.isInteger(decision.amountCents)).toBe(true)
    })
  })
})

describe('Given a delivered perishable order', () => {
  describe('When a refund is requested 72 hours after delivery', () => {
    it('then it is denied', () => {
      const decision = assessRefund(order({ category: 'perishable' }), hoursAfterDelivery(72))

      expect(decision.outcome).toBe('denied')
      expect(decision.reason).toBe('return window of 48h has closed')
    })
  })

  describe('When it was opened and a refund is requested inside the 48-hour window', () => {
    it('then the full price comes back', () => {
      const cheese = order({ category: 'perishable', opened: true })

      const decision = assessRefund(cheese, hoursAfterDelivery(47))

      expect(decision.outcome).toBe('full')
      expect(decision.amountCents).toBe(4_999)
    })
  })
})
