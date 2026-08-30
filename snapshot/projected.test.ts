/**
 * Pattern 2 — the projected inline snapshot.
 *
 * The published fields, in document order, as an inline snapshot. Three
 * properties follow from that choice and they are the whole recommendation:
 *
 *   - It is in the reviewer's eye-line. An inline snapshot changes *in the
 *     test*, next to the name of the behaviour it belongs to, so the diff
 *     arrives with its own context instead of in a `__snapshots__` file the
 *     reviewer has to go and open.
 *   - It is small enough to read. 54 lines across the corpus against 138.
 *   - It does not move when the markup is refactored. Measured: zero red
 *     against all six refactors in `edits.ts`, where the full snapshot is red
 *     against all six.
 *
 * And the cost, measured in the same run: it is blind to two of the ten bugs —
 * the badge's modifier class and the region's `aria-label`. Both are markup
 * that carries meaning without carrying a value, and no projection over
 * `data-field` can reach them. That is why `assertions.test.ts` exists and why
 * `project.ts#BLIND_SPOTS` names them rather than leaving them to be
 * discovered.
 *
 * The corpus is all four orders here, because this is the cheap one.
 */

import { describe, expect, it } from 'vitest'

import { CANCELLED, DISCOUNTED, EMPTY, STANDARD } from './orders'
import { projectionLines } from './project'
import { renderOrderSummary } from './render'

const projectionOf = (order: Parameters<typeof renderOrderSummary>[0]): string =>
  projectionLines(renderOrderSummary(order)).join('\n')

describe('the published fields of an order summary', () => {
  it('lists every value of a paid order, in document order', () => {
    expect(projectionOf(STANDARD)).toMatchInlineSnapshot(`
      "reference: ORD-1042
      customer: Ada Lovelace
      placedOn: 2024-03-11
      status: Paid
      itemCount: 3 items
      item.DESK-01.quantity: 1
      item.DESK-01.unit: £420.00
      item.DESK-01.line: £420.00
      item.MAT-07.quantity: 2
      item.MAT-07.unit: £34.50
      item.MAT-07.line: £69.00
      subtotal: £489.00
      delivery: £9.95
      tax: £99.79
      total: £598.74"
    `)
  })

  it('shows the discount line, negative, when there is a discount', () => {
    expect(projectionOf(DISCOUNTED)).toMatchInlineSnapshot(`
      "reference: ORD-1043
      customer: Beaumont &amp; Fletcher
      placedOn: 2024-03-12
      status: Shipped
      itemCount: 8 items
      item.CHAIR-22.quantity: 3
      item.CHAIR-22.unit: €189.99
      item.CHAIR-22.line: €569.97
      item.LAMP-04.quantity: 1
      item.LAMP-04.unit: €45.00
      item.LAMP-04.line: €45.00
      item.CABLE-99.quantity: 4
      item.CABLE-99.unit: €7.99
      item.CABLE-99.line: €31.96
      subtotal: €646.93
      discount: -€97.04
      delivery: €12.50
      tax: €106.85
      total: €669.24"
    `)
  })

  it('says one item in the singular, and charges no tax in USD', () => {
    expect(projectionOf(CANCELLED)).toMatchInlineSnapshot(`
      "reference: ORD-1044
      customer: Grace Hopper
      placedOn: 2024-03-13
      status: Cancelled
      itemCount: 1 item
      item.PEN-01.quantity: 1
      item.PEN-01.unit: $25.00
      item.PEN-01.line: $25.00
      subtotal: $25.00
      delivery: $0.00
      tax: $0.00
      total: $25.00"
    `)
  })

  it('still totals delivery and tax when the order has no items', () => {
    // No `itemCount` line. The empty branch replaces the whole table — caption
    // included — with a paragraph, so the field is not rendered at all rather
    // than rendered as zero. A projection shows an absence as a missing line,
    // which is the one thing it states more clearly than the markup does.
    expect(projectionOf(EMPTY)).toMatchInlineSnapshot(`
      "reference: ORD-1045
      customer: Alan Turing
      placedOn: 2024-03-14
      status: Awaiting payment
      subtotal: £0.00
      delivery: £4.99
      tax: £1.00
      total: £5.99"
    `)
  })
})
