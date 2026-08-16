/**
 * Money — the first thing the classicist cycle produced.
 *
 * Inside-out means the first test had to be about something that could be
 * tested on its own, and "what does an order cost" bottoms out in arithmetic
 * over amounts. So this exists before anything knows what an order is, and it
 * is tested directly rather than through the feature that uses it.
 *
 * Integer minor units only. A `Money` never holds a float, which is what makes
 * the half-up rule below exact rather than approximately exact.
 */

import type { Cents, Percent } from '../orderContract'

export class Money {
  private constructor(readonly cents: Cents) {}

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) {
      throw new RangeError(`Money must be whole cents, got ${cents}`)
    }
    if (cents < 0) {
      throw new RangeError(`Money must not be negative, got ${cents}`)
    }
    return new Money(cents)
  }

  static zero(): Money {
    return new Money(0)
  }

  plus(other: Money): Money {
    return new Money(this.cents + other.cents)
  }

  times(quantity: number): Money {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new RangeError(`Quantity must be a non-negative whole number, got ${quantity}`)
    }
    return new Money(this.cents * quantity)
  }

  /**
   * Take a whole-percent discount, rounding half up.
   *
   * `(cents * (100 - percentOff) + 50) / 100` floors to the same answer as
   * rounding half up, and every intermediate is an integer. The obvious
   * alternative — `Math.round(cents * (1 - percentOff / 100))` — routes
   * through a binary fraction, where a total that should land exactly on .5
   * can arrive as .49999999999999994 and quietly round the other way.
   */
  discountedBy(percentOff: Percent): Money {
    if (!Number.isInteger(percentOff) || percentOff < 0 || percentOff > 100) {
      throw new RangeError(`Discount must be a whole percentage 0–100, got ${percentOff}`)
    }
    return new Money(Math.floor((this.cents * (100 - percentOff) + 50) / 100))
  }

  equals(other: Money): boolean {
    return this.cents === other.cents
  }

  toString(): string {
    return `${(this.cents / 100).toFixed(2)}`
  }
}
