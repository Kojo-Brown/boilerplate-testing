/**
 * The corpus every probe is run against.
 *
 * Four orders, chosen to reach every branch in `render.ts`: the discount line
 * that only appears above zero, the empty-order paragraph that replaces the
 * table, the singular/plural caption, a zero-tax currency, and a negative
 * money value (the discount line is rendered negative, and `money` has a sign
 * branch for it).
 *
 * Branch coverage of the *subject* is what makes a detection matrix mean
 * anything. A fault in a branch no fixture reaches is caught by nothing, and
 * the matrix would then be reporting the corpus rather than the probes —
 * `detection.test.ts` fails on any variant that no probe notices for exactly
 * that reason.
 *
 * Every value is written down. No clock, no faker, no ids: see the note on
 * volatility in `policy.ts`.
 */

import type { Order } from './render.ts'

/** A plain, fully-populated order. The one most assertions are written against. */
export const STANDARD: Order = {
  reference: 'ORD-1042',
  status: 'paid',
  currency: 'GBP',
  placedOn: '2024-03-11',
  customerName: 'Ada Lovelace',
  items: [
    { sku: 'DESK-01', name: 'Standing desk', quantity: 1, unitPence: 42_000 },
    { sku: 'MAT-07', name: 'Anti-fatigue mat', quantity: 2, unitPence: 3_450 },
  ],
  discountPercent: 0,
  deliveryPence: 995,
}

/**
 * A discounted order whose customer name needs escaping.
 *
 * The ampersand is deliberate: escaping is one of the faults, and a corpus
 * where every name is alphabetic cannot see it.
 */
export const DISCOUNTED: Order = {
  reference: 'ORD-1043',
  status: 'shipped',
  currency: 'EUR',
  placedOn: '2024-03-12',
  customerName: 'Beaumont & Fletcher',
  items: [
    { sku: 'CHAIR-22', name: 'Task chair', quantity: 3, unitPence: 18_999 },
    { sku: 'LAMP-04', name: 'Desk lamp', quantity: 1, unitPence: 4_500 },
    { sku: 'CABLE-99', name: 'Cable tidy', quantity: 4, unitPence: 799 },
  ],
  discountPercent: 15,
  deliveryPence: 1_250,
}

/** Cancelled, single item, zero-tax currency, and the singular caption. */
export const CANCELLED: Order = {
  reference: 'ORD-1044',
  status: 'cancelled',
  currency: 'USD',
  placedOn: '2024-03-13',
  customerName: 'Grace Hopper',
  items: [{ sku: 'PEN-01', name: 'Fountain pen', quantity: 1, unitPence: 2_500 }],
  discountPercent: 0,
  deliveryPence: 0,
}

/** No items at all: the branch where the table is replaced by a paragraph. */
export const EMPTY: Order = {
  reference: 'ORD-1045',
  status: 'pending',
  currency: 'GBP',
  placedOn: '2024-03-14',
  customerName: 'Alan Turing',
  items: [],
  discountPercent: 0,
  deliveryPence: 499,
}

export const CORPUS: readonly Order[] = [STANDARD, DISCOUNTED, CANCELLED, EMPTY]
