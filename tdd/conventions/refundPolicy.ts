/**
 * The one feature both suites in this folder are written against.
 *
 * Arrange-Act-Assert and Given-When-Then are conventions for *shaping* a test,
 * not for deciding what to test. Comparing them on two different features
 * would compare the features. So there is one policy here, and `aaa.test.ts`
 * and `gwt.test.ts` state exactly the same eight behaviours about it — the
 * list lives in `behaviours.ts` and `conventions.test.ts` checks both suites
 * against it, so the comparison stays a comparison of shape.
 *
 * The feature: decide whether an order can be refunded, and for how much.
 * It was picked for the shape of its branching rather than its subject —
 * three outcomes, two windows, and a fee that has to round — because that is
 * what makes the difference between the two conventions visible:
 *
 *   - **Two independent inputs decide the window** (category and delivery
 *     state), which is where nested Given/When describes start to pay for
 *     themselves: the outer context is genuinely shared.
 *   - **One behaviour is pure arithmetic** (the restocking fee rounds), which
 *     is where they stop paying: a nested describe around a one-line
 *     calculation is three lines of ceremony for one line of test.
 *
 * Time is a parameter, never a read of the clock: every function here takes
 * the instant it should reason about. That is this repo's rule for
 * determinism, and it also keeps both suites free of the setup noise that
 * would otherwise dominate the comparison.
 */

/**
 * What kind of thing was bought. The category decides how long the customer
 * has, and whether they have any window at all.
 */
export type Category = 'standard' | 'perishable' | 'final-sale'

export type Order = {
  readonly priceCents: number
  readonly category: Category
  /**
   * When the order reached the customer. `null` means it has not shipped or
   * has not arrived yet — an order nobody has received is a cancellation, not
   * a return, and cancellations are always refundable in full.
   */
  readonly deliveredAt: Date | null
  /** Whether the packaging has been opened. Irrelevant to perishables. */
  readonly opened: boolean
}

export type Outcome = 'full' | 'partial' | 'denied'

export type RefundDecision = {
  readonly outcome: Outcome
  readonly amountCents: number
  /** Why, in the policy's own words. Stable enough to assert on. */
  readonly reason: string
}

/** How long each category's return window runs, from delivery. */
export const RETURN_WINDOW_HOURS: Readonly<Record<Category, number>> = {
  standard: 30 * 24,
  perishable: 48,
  // Never opens; the value is here so the table is total rather than a lookup
  // with a hole in it.
  'final-sale': 0,
}

/**
 * Withheld when an opened item comes back, because it cannot go straight back
 * on the shelf. Expressed in basis points so the fee can be changed without
 * anybody having to think about floating point at the call site.
 */
export const RESTOCKING_FEE_BASIS_POINTS = 1_500

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000

/**
 * The refunded share of an opened item, rounded to whole cents.
 *
 * Ties round away from zero. `Math.round` alone rounds half *up*, which on a
 * negative amount — a credit note, the day one exists — would round toward
 * zero and quietly favour the house. Every price here is non-negative, so the
 * two agree today; writing the tie rule out is what stops that from being an
 * accident later.
 *
 * At a 15% fee the tie is reachable: 85% of 1010 cents is exactly 858.5.
 */
export function refundAfterRestockingFee(priceCents: number): number {
  const refundedBasisPoints = 10_000 - RESTOCKING_FEE_BASIS_POINTS
  const exact = (priceCents * refundedBasisPoints) / 10_000

  return Math.sign(exact) * Math.round(Math.abs(exact))
}

/** Hours between two instants, as a real number. */
export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MILLISECONDS_PER_HOUR
}

/**
 * Assess a refund request.
 *
 * The order of the branches is the policy: final sale beats everything,
 * delivery state is asked about before any window, and the fee is the last
 * thing to happen, so it only ever applies to a request that was already
 * going to be granted.
 */
export function assessRefund(order: Order, requestedAt: Date): RefundDecision {
  if (order.category === 'final-sale') {
    return { outcome: 'denied', amountCents: 0, reason: 'final sale' }
  }

  if (order.deliveredAt === null) {
    return {
      outcome: 'full',
      amountCents: order.priceCents,
      reason: 'not delivered yet',
    }
  }

  const elapsedHours = hoursBetween(order.deliveredAt, requestedAt)
  const windowHours = RETURN_WINDOW_HOURS[order.category]

  if (elapsedHours > windowHours) {
    return {
      outcome: 'denied',
      amountCents: 0,
      reason: `return window of ${windowHours}h has closed`,
    }
  }

  // Perishables have no unopened price: the window is short precisely because
  // the goods spoil either way, so opening one changes nothing.
  if (!order.opened || order.category === 'perishable') {
    return {
      outcome: 'full',
      amountCents: order.priceCents,
      reason: 'within the return window',
    }
  }

  return {
    outcome: 'partial',
    amountCents: refundAfterRestockingFee(order.priceCents),
    reason: 'opened: restocking fee withheld',
  }
}
