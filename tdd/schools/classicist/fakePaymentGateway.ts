/**
 * A fake payment gateway — the one double the classicist design uses.
 *
 * A fake, in the taxonomy sense: a working implementation with a shortcut,
 * not a recording of expectations. It really keeps a ledger, it really answers
 * consistently, and a test asks it what it holds afterwards rather than
 * asserting that it was called. Swap it for the Stripe adapter and the same
 * assertions would still describe the same thing.
 *
 * This is the shape the repo prefers everywhere else too (see the root
 * conventions: real dependencies over mocks). It is worth noticing that the
 * London module could not use a fake even if it wanted one — its tests assert
 * on call order, and a fake does not record call order.
 */

import type { Money } from './money'
import type { PaymentGateway, PaymentOutcome } from './placeOrder'
import type { Charge } from '../orderContract'

export class FakePaymentGateway implements PaymentGateway {
  private readonly accepted: Charge[] = []

  constructor(private readonly behaviour: 'accepts' | 'declines' = 'accepts') {}

  async charge(customerId: string, amount: Money): Promise<PaymentOutcome> {
    if (this.behaviour === 'declines') {
      return { accepted: false }
    }
    this.accepted.push({ customerId, amountCents: amount.cents })
    return { accepted: true }
  }

  /** Charges the gateway accepted, oldest first. */
  charges(): readonly Charge[] {
    return this.accepted
  }
}
