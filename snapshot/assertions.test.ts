/**
 * Pattern 3 — explicit assertions, for comparison and for cover.
 *
 * Two jobs. It is the third arm of the measurement in `detection.test.ts`, and
 * it is the suite that covers what a projected snapshot cannot see: the badge
 * modifier class and the region's `aria-label`, both named in
 * `project.ts#BLIND_SPOTS`.
 *
 * The cases come from `probes.ts#ASSERTIONS` rather than being written out
 * again here, so the suite a reader sees is exactly the suite the matrix was
 * measured from. They were written against the correct implementation, from
 * what the summary is for — before any of the sixteen variants existed. That
 * ordering is what makes the comparison worth anything: assertions written
 * after seeing the faults would catch the faults and would say nothing about
 * what an assertion suite catches in practice.
 *
 * What it catches, measured: eight of the ten bugs, and none of the six
 * refactors. What it misses is the pair nobody thought to write a case for —
 * the discounted order's total and the tax rounding on a £4.99 delivery — and
 * that is the honest general result about assertion suites. They are exactly
 * as complete as somebody's attention was.
 */

import { describe, expect, it } from 'vitest'

import { ASSERTIONS } from './probes'
import { BLIND_SPOTS } from './project'
import { renderOrderSummary } from './render'

describe('the order summary', () => {
  for (const assertion of ASSERTIONS) {
    it(assertion.id, () => {
      expect(assertion.holds(renderOrderSummary)).toBe(true)
    })
  }
})

describe('the projection blind spots', () => {
  it('are each covered by a case in this file', () => {
    // `project.ts` claims this suite covers what the projection cannot see.
    // A claim in a doc comment is worth nothing on its own, so here it is as
    // an assertion: both blind spots name this file, and both have a case.
    expect(BLIND_SPOTS.map((spot) => spot.coveredBy)).toEqual([
      'assertions.test.ts',
      'assertions.test.ts',
    ])

    const ids = ASSERTIONS.map((assertion) => assertion.id)

    expect(ids).toContain('gives the badge a modifier class per status')
    expect(ids).toContain('names the region for assistive technology')
  })
})
