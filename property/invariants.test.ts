/**
 * Every invariant, asserted against the real system, under every arbitrary it
 * is meaningful over.
 *
 * This is the suite a contributor would actually keep: twenty properties, run
 * at a written-down seed, `fc.assert`ing rather than `fc.check`ing so a failure
 * arrives as fast-check's own report with the shrunk counterexample in it.
 * Everything else in this directory exists to say what this suite is worth;
 * this is the suite.
 *
 * The same fourteen domain-agnostic invariants are run four times over, once
 * per arbitrary, which is not redundancy — it is the experiment. Identical
 * predicates, four distributions, four different sets of bugs caught. The
 * measurement is in `detection.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { availability } from './availability'
import { SAMPLES, sampleNamed } from './arbitraries'
import { NUM_RUNS } from './config'
import { faultNamed } from './faults'
import { FAMILIES, INVARIANTS, invariantNamed, invariantsFor } from './invariants'

for (const sample of SAMPLES) {
  describe(`the real system, under the ${sample.id} arbitrary`, () => {
    for (const invariant of invariantsFor(sample)) {
      it(`${invariant.id}: ${invariant.statement}`, () => {
        invariant.assert(availability, sample)
      })
    }
  })
}

describe('the invariant catalogue', () => {
  it('gives every invariant a distinct id', () => {
    const ids = INVARIANTS.map((invariant) => invariant.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('puts every family to use, so none of the three is a dead category', () => {
    const used = new Set(INVARIANTS.map((invariant) => invariant.family))

    expect([...used].sort()).toEqual([...FAMILIES].sort())
  })

  it('holds every model-based invariant to the bounded domain', () => {
    // A model invariant over the wide arbitrary would hand `toPoints` a
    // fractional coordinate and get a RangeError reported as a counterexample:
    // the oracle failing, dressed up as the system failing.
    for (const invariant of INVARIANTS.filter((candidate) => candidate.family === 'model')) {
      expect(invariant.domain, `${invariant.id} is model-based`).toBe('bounded')
    }
  })

  it('runs the domain-agnostic invariants under every arbitrary, and the rest under one', () => {
    const anywhere = INVARIANTS.filter((invariant) => invariant.domain === 'any')
    const modelled = SAMPLES.filter((sample) => sample.modelled)

    expect(modelled).toHaveLength(1)

    for (const sample of SAMPLES) {
      expect(invariantsFor(sample).length).toBe(
        sample.modelled ? INVARIANTS.length : anywhere.length,
      )
    }
  })

  it('states each property in a sentence, not a name', () => {
    for (const invariant of INVARIANTS) {
      expect(invariant.statement.length, `${invariant.id} has no statement`).toBeGreaterThan(30)
    }
  })

  it('names the operation each invariant constrains, matching its id', () => {
    for (const invariant of INVARIANTS) {
      expect(invariant.id.startsWith(`${invariant.operation}/`)).toBe(true)
    }
  })

  it('finds an invariant by id and refuses one that does not exist', () => {
    expect(invariantNamed('normalise/idempotent').family).toBe('metamorphic')
    expect(() => invariantNamed('normalise/no-such-property')).toThrow('no invariant named')
  })
})

describe('check, the reporting form the probes use', () => {
  const bounded = sampleNamed('bounded')

  it('reports no failure against the system that is not broken', () => {
    const outcome = invariantNamed('normalise/canonical-form').check(availability, bounded)

    expect(outcome.failed).toBe(false)
    expect(outcome.report).toBeNull()
    expect(outcome.numRuns).toBe(NUM_RUNS)
  })

  it('carries fast-check’s own report when a system is broken', () => {
    const outcome = invariantNamed('normalise/canonical-form').check(
      faultNamed('TOUCHING_NOT_MERGED').build(),
      bounded,
    )

    expect(outcome.failed).toBe(true)
    expect(outcome.report).toContain('Property failed after')
    expect(outcome.counterexample).not.toBeNull()
  })

  it('runs the model only against the one arbitrary that can be modelled', () => {
    expect(sampleNamed('bounded').modelled).toBe(true)
    expect(sampleNamed('clustered').modelled).toBe(false)
  })
})
