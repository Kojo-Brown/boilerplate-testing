/**
 * The projection itself, and the contract it depends on.
 *
 * The interesting tests here are the closed-table ones. A projection is only
 * as good as the set of fields it extracts, and its failure mode is silent in
 * the flattering direction: render a new price without a `data-field` and the
 * projected snapshot does not change, so every reviewer reads "no snapshot
 * changes" as "the values are right". `FIELDS` is therefore closed — a field
 * rendered but not listed fails here — and a `data-field` containing markup is
 * an error rather than a value, because the regex would otherwise silently
 * project the wrong text.
 */

import { describe, expect, it } from 'vitest'

import { CORPUS } from './orders'
import { FIELDS, ITEM_FIELDS, NestedFieldError, isKnownField, project, projectionLines } from './project'
import { renderOrderSummary } from './render'

const projectionOf = (html: string): ReturnType<typeof project> => project(html)

describe('the projection', () => {
  it('extracts a field as a name and its text', () => {
    expect(projectionOf('<span data-field="total">£5.99</span>')).toEqual([['total', '£5.99']])
  })

  it('keeps document order, so a moved value is visible', () => {
    const html = '<span data-field="total">1</span><span data-field="subtotal">2</span>'

    expect(projectionOf(html).map(([name]) => name)).toEqual(['total', 'subtotal'])
  })

  it('ignores markup that publishes no field', () => {
    expect(projectionOf('<div class="order"><p>Order for <b>Ada</b></p></div>')).toEqual([])
  })

  it('reads a field regardless of the other attributes on its element', () => {
    const html = '<span class="x" data-field="total" id="y">£1.00</span>'

    expect(projectionOf(html)).toEqual([['total', '£1.00']])
  })

  it('renders as one line per field', () => {
    expect(projectionLines('<span data-field="a">1</span><span data-field="b">2</span>')).toEqual([
      'a: 1',
      'b: 2',
    ])
  })

  it('rejects a field containing markup rather than projecting part of it', () => {
    // Without this the regex simply fails to match and the field vanishes from
    // the projection — the exact silent-blindness failure the closed table
    // exists to prevent, arriving through a different door.
    expect(() => projectionOf('<span data-field="total"><b>£5.99</b></span>')).toThrow(
      NestedFieldError,
    )
  })

  it('names the offending field in that error', () => {
    try {
      projectionOf('<span data-field="total"><b>£5.99</b></span>')
      expect.unreachable('expected a NestedFieldError')
    } catch (error) {
      expect(error).toBeInstanceOf(NestedFieldError)
      expect((error as NestedFieldError).field).toBe('total')
    }
  })

  it('projects an empty field as an empty value rather than dropping it', () => {
    expect(projectionOf('<span data-field="note"></span>')).toEqual([['note', '']])
  })
})

describe('the field table', () => {
  it('recognises a plain field and a per-item one', () => {
    expect(isKnownField('total')).toBe(true)
    expect(isKnownField('item.DESK-01.line')).toBe(true)
  })

  it('rejects a name that resembles a per-item field without being one', () => {
    expect(isKnownField('item.DESK-01.colour')).toBe(false)
    expect(isKnownField('item.DESK-01')).toBe(false)
    expect(isKnownField('items.DESK-01.line')).toBe(false)
    expect(isKnownField('grandTotal')).toBe(false)
  })

  it('covers every field the corpus actually renders', () => {
    // The closed half. A value added to `render.ts` under a new field name
    // fails here until somebody decides it belongs in the projection.
    const rendered = new Set(
      CORPUS.flatMap((order) => project(renderOrderSummary(order)).map(([name]) => name)),
    )

    for (const name of rendered) {
      expect(isKnownField(name), `${name} is rendered but not in FIELDS`).toBe(true)
    }
  })

  it('declares no field the corpus never renders', () => {
    // The other half. A field listed but never rendered is either a typo or a
    // value that quietly stopped being published, and both are worth failing
    // over — `shape/boundaries.ts` closes its table in both directions for the
    // same reason.
    const rendered = new Set(
      CORPUS.flatMap((order) => project(renderOrderSummary(order)).map(([name]) => name)),
    )

    for (const name of FIELDS) {
      expect(rendered.has(name), `${name} is declared but never rendered`).toBe(true)
    }

    for (const suffix of ITEM_FIELDS) {
      expect(
        [...rendered].some((name) => name.startsWith('item.') && name.endsWith(`.${suffix}`)),
        `item.*.${suffix} is declared but never rendered`,
      ).toBe(true)
    }
  })
})
