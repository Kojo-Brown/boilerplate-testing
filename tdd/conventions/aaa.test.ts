// @vitest-environment node
/**
 * The refund policy, in Arrange-Act-Assert.
 *
 * The structure is in the bodies. Every case is a flat `it` under one
 * `describe`, and the three phases are marker comments — which is what
 * `test-conventions/aaa-structure` checks: markers present, in order, each
 * with something under it, and no `expect(…)` before `// Assert`.
 *
 * That last check is the reason the markers are worth typing. The phases are
 * only a comment convention until something reads them; once something does,
 * "assert at the end" stops being advice and becomes a build failure. Move the
 * `expect` in the last case up above the act and `pnpm lint` fails — that is a
 * claim `conventions.test.ts` verifies by running ESLint over a body shaped
 * exactly that way, rather than by asserting it here in prose.
 *
 * Everything the rule *cannot* see is on display too. Nothing stops a body
 * from putting three unrelated calls under one `// Act`, and no lint rule is
 * going to know whether they are one action or three. The markers make the
 * intent legible; keeping to it is still a person's job.
 */

import { describe, expect, it } from 'vitest'

import { assessRefund, refundAfterRestockingFee } from './refundPolicy'
import type { Order } from './refundPolicy'

const DELIVERED_AT = new Date('2026-03-01T09:00:00Z')

/** An hour offset from delivery, so each case says how late it is in words. */
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

describe('assessRefund', () => {
  it('denies a refund on a final-sale order', () => {
    // Arrange
    const clearanceMug = order({ category: 'final-sale' })

    // Act
    const decision = assessRefund(clearanceMug, hoursAfterDelivery(24))

    // Assert
    expect(decision).toEqual({ outcome: 'denied', amountCents: 0, reason: 'final sale' })
  })

  it('refunds an undelivered order in full', () => {
    // Arrange
    const inTransit = order({ deliveredAt: null })

    // Act
    const decision = assessRefund(inTransit, hoursAfterDelivery(-12))

    // Assert
    expect(decision.outcome).toBe('full')
    expect(decision.amountCents).toBe(4_999)
    expect(decision.reason).toBe('not delivered yet')
  })

  it('refunds an unopened order in full inside the return window', () => {
    // Arrange
    const sealed = order({ opened: false })

    // Act
    const decision = assessRefund(sealed, hoursAfterDelivery(29 * 24))

    // Assert
    expect(decision.outcome).toBe('full')
    expect(decision.amountCents).toBe(4_999)
  })

  it('denies a refund once the return window has closed', () => {
    // Arrange
    const sealed = order({ opened: false })

    // Act
    const decision = assessRefund(sealed, hoursAfterDelivery(30 * 24 + 1))

    // Assert
    expect(decision.outcome).toBe('denied')
    expect(decision.amountCents).toBe(0)
    expect(decision.reason).toBe('return window of 720h has closed')
  })

  it('withholds a restocking fee on an opened order', () => {
    // Arrange: 15% of 4,999 is 749.85, so the fee is not a round number either
    const unwrapped = order({ opened: true })

    // Act
    const decision = assessRefund(unwrapped, hoursAfterDelivery(24))

    // Assert
    expect(decision.outcome).toBe('partial')
    expect(decision.amountCents).toBe(4_249)
    expect(decision.reason).toBe('opened: restocking fee withheld')
  })

  it('rounds the restocking fee to whole cents', () => {
    // Arrange: 85% of 1,010 is exactly 858.5 — the tie the policy has to break
    const oddlyPriced = order({ priceCents: 1_010, opened: true })

    // Act
    const decision = assessRefund(oddlyPriced, hoursAfterDelivery(24))

    // Assert
    expect(decision.amountCents).toBe(859)
    expect(Number.isInteger(decision.amountCents)).toBe(true)
    expect(refundAfterRestockingFee(1_010)).toBe(859)
  })

  it('denies a perishable refund once its 48-hour window has closed', () => {
    // Arrange
    const cheese = order({ category: 'perishable' })

    // Act
    const decision = assessRefund(cheese, hoursAfterDelivery(72))

    // Assert
    expect(decision.outcome).toBe('denied')
    expect(decision.reason).toBe('return window of 48h has closed')
  })

  it('refunds an opened perishable in full inside its window', () => {
    // Arrange
    const cheese = order({ category: 'perishable', opened: true })

    // Act
    const decision = assessRefund(cheese, hoursAfterDelivery(47))

    // Assert
    expect(decision.outcome).toBe('full')
    expect(decision.amountCents).toBe(4_999)
  })
})
