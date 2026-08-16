/**
 * Order pricing and command validation — pure functions over the value types.
 *
 * Everything here is decided without asking anyone anything, which is why it
 * arrived early in the inside-out cycle: it needs a `Catalogue` and a `Money`
 * and nothing else, so it could be written and tested before there was any
 * such thing as "placing" an order.
 */

import type { Money } from './money'
import type { Catalogue } from './catalogue'
import type { OrderLine, Sku } from '../orderContract'

export type LineProblem = 'EMPTY_ORDER' | 'INVALID_QUANTITY'

/** `undefined` when the lines are well formed. */
export function validateLines(lines: readonly OrderLine[]): LineProblem | undefined {
  if (lines.length === 0) return 'EMPTY_ORDER'
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) return 'INVALID_QUANTITY'
  }
  return undefined
}

export type PricingResult =
  | { readonly ok: true; readonly total: Money }
  | { readonly ok: false; readonly unknownSku: Sku }

/**
 * Total the lines at catalogue prices.
 *
 * Returns the offending sku rather than throwing: an unknown sku is an
 * ordinary answer to "what does this cost", not an exceptional one, and the
 * caller has to turn it into a rejection either way.
 */
export function priceLines(
  lines: readonly OrderLine[],
  catalogue: Catalogue,
): PricingResult {
  let total: Money | undefined

  for (const line of lines) {
    const unitPrice = catalogue.priceOf(line.sku)
    if (unitPrice === undefined) {
      return { ok: false, unknownSku: line.sku }
    }
    const lineTotal = unitPrice.times(line.quantity)
    total = total === undefined ? lineTotal : total.plus(lineTotal)
  }

  // `validateLines` rejects the empty order before pricing is reached, so the
  // only way here with nothing totalled would be a caller that skipped it.
  if (total === undefined) {
    throw new Error('priceLines was given no lines; validate the command first')
  }

  return { ok: true, total }
}
