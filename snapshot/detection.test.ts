// @vitest-environment node
//
// Compiles variants of `render.ts` and imports them, which needs the node
// environment for the same reason `tdd/characterisation/detection.test.ts`
// does.
/**
 * What each technique would actually have caught — and what it would have
 * cried wolf over.
 *
 * Sixteen single changes are applied to the real source, compiled, loaded, and
 * run through all three probes. The matrix that comes out is compared with the
 * one declared in `matrix.ts` and printed in `README.md`.
 *
 * The control comes first and matters more than the matrix: the same source
 * through the same pipeline with no edits at all. If that came out different
 * from what the imported module renders, every variant would look caught and
 * the table would be measuring the compiler rather than the probes.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { BUGS, NOISE, VARIANTS, applyEdits, variantNamed } from './edits'
import type { VariantId } from './edits'
import { loadControl, loadVariant, renderSource } from './load'
import { DETECTION, RESULTS, redFor, resultFor, unionResult } from './matrix'
import { CORPUS } from './orders'
import { PROBES, PROBE_IDS, failingAssertions, record } from './probes'
import type { Baseline, ProbeId } from './probes'
import { renderOrderSummary } from './render'

const red = new Map<VariantId, ProbeId[]>()

let baseline: Baseline

beforeAll(async () => {
  const control = await loadControl()

  baseline = record(control)

  for (const variant of VARIANTS) {
    const render = await loadVariant(variant.id)

    red.set(
      variant.id,
      PROBES.filter((probe) => probe.red(render, baseline)).map((probe) => probe.id),
    )
  }
}, 60_000)

describe('the control', () => {
  it('renders exactly what the imported module renders', async () => {
    const control = await loadControl()

    for (const order of CORPUS) {
      expect(control(order)).toBe(renderOrderSummary(order))
    }
  })

  it('leaves every probe silent', async () => {
    const control = await loadControl()

    expect(PROBES.filter((probe) => probe.red(control, baseline)).map((probe) => probe.id)).toEqual(
      [],
    )
  })
})

describe('the edits', () => {
  for (const variant of VARIANTS) {
    it(`matches the current source exactly once — ${variant.id}`, () => {
      // `applyEdits` throws unless every `from` occurs exactly once. Editing
      // render.ts in a way that invalidates one of these fails here rather
      // than silently measuring a variant that was never applied.
      expect(() => applyEdits(renderSource(), variantNamed(variant.id).edits)).not.toThrow()
    })
  }

  it('changes the rendered output in every case', async () => {
    // A variant that renders identically to the control is an equivalent
    // mutant: it proves nothing about any probe and would sit in the table
    // looking like a probe's failure. There are none here, and this is what
    // says so.
    for (const variant of VARIANTS) {
      const render = await loadVariant(variant.id)
      const changed = CORPUS.some((order) => render(order) !== baseline.full.get(order.reference))

      expect(changed, `${variant.id} renders identically to the control`).toBe(true)
    }
  })
})

describe('the detection matrix', () => {
  for (const variant of VARIANTS) {
    it(`is caught by exactly the declared probes — ${variant.id}`, () => {
      expect(red.get(variant.id)).toEqual([...DETECTION[variant.id]])
    })
  }

  it('leaves no bug invisible to everything', () => {
    for (const bug of BUGS) {
      expect(DETECTION[bug.id].length, `${bug.id} is caught by nothing`).toBeGreaterThan(0)
    }
  })
})

describe('the full-markup snapshot', () => {
  it('catches every one of the ten bugs', () => {
    expect(resultFor('full').caught).toBe(BUGS.length)
    expect(BUGS.length).toBe(10)
  })

  it('also fails on every one of the six refactors', () => {
    // The trade is not detection against detection. Nothing else here sees as
    // much, and nothing else here is wrong as often.
    expect(resultFor('full').falseAlarms).toBe(NOISE.length)
    expect(NOISE.length).toBe(6)
  })

  it('is right 62.5% of the times it goes red', () => {
    expect(resultFor('full').signalRate).toBeCloseTo(62.5, 5)
  })
})

describe('the projected snapshot', () => {
  it('is never red for a change that broke nothing', () => {
    expect(resultFor('projected').falseAlarms).toBe(0)
  })

  it('pays for that with two bugs it cannot see', () => {
    expect(redFor('projected')).not.toContain('BADGE_MODIFIER_DROPPED')
    expect(redFor('projected')).not.toContain('ARIA_LABEL_DROPPED')
    expect(resultFor('projected').caught).toBe(8)
  })

  it('is blind to exactly the structural facts it does not extract', () => {
    // Both blind spots are markup that carries meaning without carrying a
    // value: a class that colours the badge, and the name the region is
    // announced by. Neither is reachable by a projection over `data-field`,
    // which is `project.ts#BLIND_SPOTS` stated as a measurement rather than a
    // comment.
    const missed = BUGS.filter((bug) => !DETECTION[bug.id].includes('projected')).map(
      (bug) => bug.id,
    )

    expect(missed).toEqual(['BADGE_MODIFIER_DROPPED', 'ARIA_LABEL_DROPPED'])
  })
})

describe('the hand-written assertions', () => {
  it('are never red for a change that broke nothing', () => {
    expect(resultFor('assertions').falseAlarms).toBe(0)
  })

  it('miss the two arithmetic errors nobody thought to assert on', () => {
    const missed = BUGS.filter((bug) => !DETECTION[bug.id].includes('assertions')).map(
      (bug) => bug.id,
    )

    expect(missed).toEqual(['DISCOUNT_INCLUDES_DELIVERY', 'TAX_TRUNCATED'])
  })

  it('miss them because the corpus reaches further than the assertions do', async () => {
    // Not because the assertions are careless. Both faults are real and both
    // are only visible on one order in the corpus — the discounted total and
    // the £0.998 tax on the empty order — and neither is an order anybody
    // wrote a total assertion for. This is what an assertion suite's coverage
    // is: wherever somebody's attention happened to land.
    const truncated = await loadVariant('TAX_TRUNCATED')

    expect(failingAssertions(truncated)).toEqual([])
    expect(truncated(CORPUS[3]!)).not.toBe(renderOrderSummary(CORPUS[3]!))
  })
})

describe('the two narrow probes together', () => {
  it('catch every bug between them, with no false alarm', () => {
    // The recommendation, and the reason it is a pair rather than a winner.
    const union = unionResult(['projected', 'assertions'])

    expect(union.caught).toBe(BUGS.length)
    expect(union.falseAlarms).toBe(0)
    expect(union.signalRate).toBe(100)
  })

  it('miss different bugs, so neither one contains the other', () => {
    const projected = new Set(redFor('projected'))
    const assertions = new Set(redFor('assertions'))

    expect(redFor('assertions').filter((id) => !projected.has(id))).toEqual([
      'BADGE_MODIFIER_DROPPED',
      'ARIA_LABEL_DROPPED',
    ])
    expect(redFor('projected').filter((id) => !assertions.has(id))).toEqual([
      'DISCOUNT_INCLUDES_DELIVERY',
      'TAX_TRUNCATED',
    ])
  })
})

describe('the noise column', () => {
  it('is judged by the assertion suite and not by the projection', () => {
    // `edits.ts` calls six changes "noise", and that is a judgement. Checking
    // it against the projection would be circular — the projection is one of
    // the things being measured. The assertion suite is the independent
    // witness: it was written from the description of the summary, before
    // these edits existed, and it stays silent on all six.
    for (const variant of NOISE) {
      expect(DETECTION[variant.id], `${variant.id} is not noise`).toEqual(['full'])
    }
  })
})

describe('the results table', () => {
  it('covers every probe exactly once', () => {
    expect(RESULTS.map((result) => result.probe)).toEqual([...PROBE_IDS])
  })
})
