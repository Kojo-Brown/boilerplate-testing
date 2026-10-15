/**
 * What one line costs, bulk discount included.
 *
 * Imports `money.ts`, is imported by `cart.ts`: the middle of the chain, and
 * the module whose change a depth-1 selector handles and a transitive one has
 * to walk two hops to cover.
 */

import { addCents, scaleCents, type Line } from './money.ts'

/** Quantity at which the bulk discount starts. Rewritten by the `bulk-threshold` fault. */
export const BULK_THRESHOLD = 12

/** The bulk discount, in basis points: 500 is 5%. */
export const BULK_DISCOUNT_BASIS_POINTS = 500

export function lineTotal(line: Line): number {
  const gross = scaleCents(line.unitCents, line.quantity)

  if (line.quantity < BULK_THRESHOLD) return gross

  return addCents(gross, -Math.round((gross * BULK_DISCOUNT_BASIS_POINTS) / 10_000))
}
