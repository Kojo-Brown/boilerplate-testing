/**
 * The whole order. Two hops from `money.ts`, which is the point of it.
 */

import { addCents, formatCents, type Line } from './money.ts'
import { lineTotal } from './pricing.ts'

export function cartTotal(lines: readonly Line[]): number {
  return lines.reduce((total, line) => addCents(total, lineTotal(line)), 0)
}

export function cartLabel(lines: readonly Line[]): string {
  return formatCents(cartTotal(lines))
}
