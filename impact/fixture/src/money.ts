/**
 * Minor-unit arithmetic: the bottom of the fixture's import graph.
 *
 * `pricing.ts` imports it, `cart.ts` imports `pricing.ts`, and `money.test.ts`
 * sits beside it — so a change here is the one case every selection strategy
 * gets right, and the depth at which the shallow ones start to fail.
 */

/** One line of an order. Imported as a type by four other modules. */
export interface Line {
  readonly sku: string
  readonly unitCents: number
  readonly quantity: number
}

export function addCents(a: number, b: number): number {
  return a + b
}

export function scaleCents(cents: number, quantity: number): number {
  return cents * quantity
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
