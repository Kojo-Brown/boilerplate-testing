/**
 * Catalogue and Promotions — real objects, not ports.
 *
 * The London design has an interface for each of these and no implementation.
 * Here they are the implementation, they hold their own data, and their tests
 * poke them directly. The difference matters most for `Promotions`: expiry is
 * a rule with an edge (is a promo valid *at* the instant it expires?), and a
 * rule with an edge wants a test that names the edge. Behind a mock, that edge
 * has nowhere to live — the double returns whatever the orchestrator's test
 * needed, and the real rule stays unwritten until somebody implements the port
 * with no test in sight.
 */

import { Money } from './money'
import type { Cents, Percent, Sku } from '../orderContract'

export class Catalogue {
  private readonly prices: Map<Sku, Money>

  constructor(prices: Readonly<Record<Sku, Cents>>) {
    this.prices = new Map(
      Object.entries(prices).map(([sku, cents]) => [sku, Money.fromCents(cents)]),
    )
  }

  priceOf(sku: Sku): Money | undefined {
    return this.prices.get(sku)
  }
}

export type Promotion = {
  readonly percentOff: Percent
  /** The promo is valid strictly before this instant. */
  readonly expiresAt: Date
}

export class Promotions {
  private readonly promos: Map<string, Promotion>

  constructor(promos: Readonly<Record<string, Promotion>>) {
    this.promos = new Map(Object.entries(promos))
  }

  /** `undefined` for a code that does not exist, or has reached its expiry. */
  discountFor(code: string, now: Date): Percent | undefined {
    const promo = this.promos.get(code)
    if (promo === undefined) return undefined
    // Expiry is exclusive: a promo that expires at midnight is dead at
    // midnight, not one millisecond later.
    return now.getTime() < promo.expiresAt.getTime() ? promo.percentOff : undefined
  }
}
