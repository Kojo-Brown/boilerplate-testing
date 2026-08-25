/**
 * The policy, tested on counts that are written down rather than measured.
 *
 * A gate is only worth having if it fails on the thing it exists to catch, so
 * most of what follows is the gate failing. Testing it against the repository's
 * real numbers would prove only that today is fine, and would change meaning
 * every time someone adds a test.
 */

import { describe, expect, it } from 'vitest'
import type { Layer } from './boundaries.ts'
import { evaluate, measure, percent, POLICY, SHAPES, type Policy } from './policy.ts'

const counts = (unit: number, integration: number, e2e: number): Record<Layer, number> => ({
  unit,
  integration,
  e2e,
})

/**
 * The shape measured on this PR's merge commit, near the middle of every band.
 *
 * Written down rather than collected. These tests are about what the policy
 * does with a set of counts, and wiring them to the live suite would make every
 * assertion below change meaning whenever anybody added a test.
 */
const HEALTHY = counts(553, 295, 51)

const honeycombPolicy: Policy = {
  shape: 'honeycomb',
  bands: SHAPES.honeycomb.bands,
  why: 'Used here to check the other shape is enforceable too.',
}

describe('measure', () => {
  it('turns counts into percentages of the whole suite', () => {
    const measurement = measure(counts(50, 30, 20))

    expect(measurement.total).toBe(100)
    expect(measurement.share.unit).toBeCloseTo(50)
    expect(measurement.share.integration).toBeCloseTo(30)
    expect(measurement.share.e2e).toBeCloseTo(20)
  })

  it('reports zero shares for an empty suite rather than dividing by zero', () => {
    const measurement = measure(counts(0, 0, 0))

    expect(measurement.total).toBe(0)
    expect(Number.isNaN(measurement.share.unit)).toBe(false)
    expect(measurement.share.unit).toBe(0)
  })
})

describe('evaluate, on a suite that satisfies its policy', () => {
  it('passes the shape this repository declares', () => {
    expect(evaluate(measure(HEALTHY))).toEqual([])
  })

  it('passes a honeycomb-shaped suite under the honeycomb policy', () => {
    expect(evaluate(measure(counts(150, 600, 60)), honeycombPolicy)).toEqual([])
  })
})

describe('evaluate, on a suite that has changed shape', () => {
  it('rejects a pyramid whose middle layer has overtaken its base', () => {
    const violations = evaluate(measure(counts(200, 500, 50)))
    const ordering = violations.filter((violation) => violation.kind === 'ordering')

    expect(ordering).toHaveLength(1)
    expect(ordering[0]).toMatchObject({ wider: 'unit', narrower: 'integration' })
  })

  it('rejects a pyramid with more end-to-end tests than integration tests', () => {
    const violations = evaluate(measure(counts(700, 40, 200)))

    expect(violations.some((violation) => violation.kind === 'ordering')).toBe(true)
  })

  it('rejects a tie, because equal layers are not a decreasing order', () => {
    const violations = evaluate(measure(counts(300, 300, 50)))

    expect(violations.some((violation) => violation.kind === 'ordering')).toBe(true)
  })

  it('rejects this repository’s real shape under the honeycomb policy', () => {
    // The two shapes genuinely disagree — a suite cannot satisfy both — which
    // is what makes declaring one of them a decision rather than a formality.
    expect(evaluate(measure(HEALTHY), honeycombPolicy).length).toBeGreaterThan(0)
  })
})

describe('evaluate, on a suite that has drifted within its shape', () => {
  it('rejects an end-to-end layer that has grown past its ceiling', () => {
    // The band exists to refuse this: the ordering still holds, so only the
    // ceiling catches a Playwright suite quietly doubling.
    const violations = evaluate(measure(counts(514, 241, 200)))
    const e2e = violations.filter(
      (violation) => violation.kind === 'band' && violation.layer === 'e2e',
    )

    expect(e2e).toHaveLength(1)
    expect(e2e[0]).toMatchObject({ band: POLICY.bands.e2e })
  })

  it('rejects a unit layer that has fallen through its floor', () => {
    const violations = evaluate(measure(counts(300, 240, 50)))

    expect(
      violations.some((violation) => violation.kind === 'band' && violation.layer === 'unit'),
    ).toBe(true)
  })

  it('rejects an integration layer above its ceiling while the ordering still holds', () => {
    const violations = evaluate(measure(counts(500, 450, 40)))

    expect(violations.every((violation) => violation.kind === 'band')).toBe(true)
    expect(
      violations.some(
        (violation) => violation.kind === 'band' && violation.layer === 'integration',
      ),
    ).toBe(true)
  })

  it('compares the unrounded share, so a layer just over its ceiling cannot round back in', () => {
    // 10.03% of the suite: displays as 10.0%, which reads as inside a 10%
    // ceiling, and is not.
    const overCeiling = counts(6000, 2900, 992)
    const violations = evaluate(measure(overCeiling))

    expect(percent(measure(overCeiling).share.e2e)).toBe('10.0%')
    expect(
      violations.some((violation) => violation.kind === 'band' && violation.layer === 'e2e'),
    ).toBe(true)
  })

  it('accepts a share exactly on a boundary, because the bands are inclusive', () => {
    // e2e at exactly 10%: 100 of 1000.
    expect(evaluate(measure(counts(650, 250, 100)))).toEqual([])
  })
})

describe('evaluate, on nothing at all', () => {
  it('reports an empty suite rather than a satisfied policy', () => {
    const violations = evaluate(measure(counts(0, 0, 0)))

    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('empty')
  })
})

describe('the declared policy', () => {
  it('leaves headroom the textbook pyramid does not', () => {
    // 29.9% integration against a textbook ceiling of 30% is a gate with a
    // 0.1-point margin, which fails on the next honest commit. The declared
    // bands widen it deliberately; this pins that they are wider.
    expect(POLICY.bands.integration.max).toBeGreaterThan(SHAPES.pyramid.bands.integration.max)
    expect(POLICY.bands.unit.min).toBeLessThan(SHAPES.pyramid.bands.unit.min)
  })

  it('leaves the end-to-end ceiling on the textbook 10%, where it still has teeth', () => {
    // A 12% ceiling was tried and abandoned: it let the Playwright suite double
    // and still pass, which makes the band decorative. This is the test that
    // established it, so the claim in POLICY's comment is measured.
    expect(POLICY.bands.e2e.max).toBe(SHAPES.pyramid.bands.e2e.max)

    const doubled = measure(counts(553, 295, 102))

    expect(percent(doubled.share.e2e)).toBe('10.7%')
    expect(
      evaluate(doubled).some(
        (violation) => violation.kind === 'band' && violation.layer === 'e2e',
      ),
    ).toBe(true)
  })

  it('states headroom the bands actually leave, one layer at a time', () => {
    // Each figure quoted in POLICY's comment and in README.md, checked at the
    // edge: the last value that passes and the first that does not.
    expect(evaluate(measure(counts(553, 295, 94)))).toEqual([])
    expect(evaluate(measure(counts(553, 295, 95))).length).toBeGreaterThan(0)

    // Integration is stopped by the unit *floor*, not its own ceiling: at 401
    // the middle band is only 39.9% but unit has been diluted to 55.02%.
    expect(evaluate(measure(counts(553, 401, 51)))).toEqual([])
    expect(evaluate(measure(counts(553, 402, 51)))).toMatchObject([{ layer: 'unit' }])

    expect(evaluate(measure(counts(553 - 130, 295, 51)))).toEqual([])
    expect(evaluate(measure(counts(553 - 131, 295, 51))).length).toBeGreaterThan(0)
  })

  it('tolerates a quarter of ordinary growth without firing', () => {
    expect(evaluate(measure(counts(553 + 60, 295 + 30, 51 + 6)))).toEqual([])
  })

  it('names a shape that exists', () => {
    expect(Object.keys(SHAPES)).toContain(POLICY.shape)
  })
})

describe('the documented shapes', () => {
  it('gives each shape an origin a reader can go and check', () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
      expect(shape.origin, `${name} has no origin`).toMatch(/\d{4}/)
      expect(shape.rationale.length).toBeGreaterThan(40)
    }
  })

  it('states bands for every layer that sum to a plausible whole', () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
      const minimums = Object.values(shape.bands).reduce((sum, band) => sum + band.min, 0)
      const maximums = Object.values(shape.bands).reduce((sum, band) => sum + band.max, 0)

      expect(minimums, `${name}'s floors demand more than a whole suite`).toBeLessThanOrEqual(100)
      expect(maximums, `${name}'s ceilings cannot reach a whole suite`).toBeGreaterThanOrEqual(100)
    }
  })

  it('disagrees with itself across shapes, which is the point of naming two', () => {
    expect(SHAPES.pyramid.bands.unit.min).toBeGreaterThan(SHAPES.honeycomb.bands.unit.max)
    expect(SHAPES.honeycomb.bands.integration.min).toBeGreaterThan(
      SHAPES.pyramid.bands.integration.max,
    )
  })
})
