/**
 * Shrinking, measured against a real bug.
 *
 * The claim is that fast-check hands back a counterexample small enough to
 * read. It is easy to demonstrate on a toy and easy to lose in real code, so
 * both halves are numbers here: how much smaller the reduced input is, and
 * whether an arbitrary that generates the *same values* can throw the whole
 * benefit away.
 *
 * The fault is `MERGE_LOSES_FURTHEST_END` — merging a long range with a short
 * one inside it truncates the long one — and the invariant is the point-set
 * model. Both were chosen because the bug needs a specific arrangement to
 * appear, which is the case where the raw counterexample is cluttered with the
 * five ranges that had nothing to do with it.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { interval } from './availability'
import { boundedScenario } from './arbitraries'
import { NUM_RUNS, SEED } from './config'
import { faultNamed } from './faults'
import { invariantNamed } from './invariants'
import { measureShrinking, OPAQUE, scenarioSize, SHRINKABLE } from './shrinking'

const broken = faultNamed('MERGE_LOSES_FURTHEST_END').build()
const invariant = invariantNamed('normalise/matches-point-model')

const shrinkable = measureShrinking(SHRINKABLE, broken, invariant)
const opaque = measureShrinking(OPAQUE, broken, invariant)

describe('scenarioSize, the unit the comparison is stated in', () => {
  it('counts ranges and the magnitude of their coordinates', () => {
    expect(scenarioSize({ a: [interval(0, 1)], b: [], point: 0 })).toBe(2)
    expect(scenarioSize({ a: [interval(10, 12)], b: [], point: 0 })).toBe(23)
  })

  it('grows with both operands, since a counterexample is the whole input', () => {
    const one = { a: [interval(0, 1)], b: [], point: 0 }
    const two = { a: [interval(0, 1)], b: [interval(0, 1)], point: 0 }

    expect(scenarioSize(two)).toBeGreaterThan(scenarioSize(one))
  })
})

describe('an arbitrary fast-check can take apart', () => {
  it('finds a first counterexample far too large to read: six ranges, size 734', () => {
    expect(shrinkable.rawSize).toBe(734)
    expect(shrinkable.raw?.a).toHaveLength(6)
  })

  it('reduces it to two ranges, one inside the other, in 62 steps', () => {
    // The minimal statement of this bug: a range, and a range inside it. There
    // is nothing left to delete — which is what makes the counterexample a
    // diagnosis rather than a data dump.
    expect(shrinkable.shrunk).toEqual({ a: [interval(0, 3), interval(1, 2)], b: [], point: 0 })
    expect(shrinkable.numShrinks).toBe(62)
  })

  it('shrinks the input by more than 98%', () => {
    expect(shrinkable.shrunkSize).toBe(8)
    expect(1 - shrinkable.shrunkSize / shrinkable.rawSize).toBeGreaterThan(0.98)
  })

  it('hands back an input that still fails, which is the only thing that makes it useful', () => {
    // A shrinker that walked past the edge would return something that passes,
    // and fast-check's own report would not say so.
    expect(shrinkable.stillFails).toBe(true)
  })
})

describe('an arbitrary fast-check cannot see inside', () => {
  it('generates from the same distribution and finds the bug just as well', () => {
    // `fc.constantFrom(...pool)` where the pool came from `boundedScenario`.
    // Nothing about detection changes; the property fails either way.
    expect(opaque.raw).not.toBeNull()
  })

  it('reduces nothing at all, because every value is a leaf', () => {
    expect(opaque.numShrinks).toBe(0)
    expect(opaque.shrunkSize).toBe(opaque.rawSize)
  })

  it('leaves a counterexample a hundred times larger than the shrinkable one', () => {
    expect(opaque.shrunkSize).toBe(826)
    expect(opaque.shrunkSize / shrinkable.shrunkSize).toBeGreaterThan(100)
  })

  it('keeps ten ranges in the answer, nine of which have nothing to do with the bug', () => {
    expect((opaque.shrunk?.a.length ?? 0) + (opaque.shrunk?.b.length ?? 0)).toBe(10)
  })
})

describe('replaying a failure', () => {
  // The other half of reproducibility. A seed re-runs the whole property; a
  // seed plus a path jumps straight back to the one input that failed, which
  // is what makes the two lines fast-check prints on failure worth pasting
  // into a test while fixing it.
  const property = fc.property(boundedScenario, (scenario) => invariant.holds(broken, scenario))

  const original = fc.check(property, { seed: SEED, numRuns: NUM_RUNS })

  it('reports a path alongside the seed', () => {
    expect(original.failed).toBe(true)
    expect(original.counterexamplePath).toEqual(expect.any(String))
  })

  it('reproduces the identical counterexample from the seed and the path alone', () => {
    const replayed = fc.check(property, {
      seed: SEED,
      numRuns: NUM_RUNS,
      path: original.counterexamplePath ?? '',
    })

    expect(replayed.counterexample).toEqual(original.counterexample)
  })

  it('reproduces it in one run rather than searching again', () => {
    const replayed = fc.check(property, {
      seed: SEED,
      numRuns: NUM_RUNS,
      path: original.counterexamplePath ?? '',
    })

    expect(replayed.numRuns).toBe(1)
  })
})
