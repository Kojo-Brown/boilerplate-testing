/**
 * The fault corpus, held to its own claims.
 *
 * A detection matrix is worth exactly as much as the corpus it is measured
 * over, and a corpus is the easiest thing in a comparison to get quietly
 * wrong: a "fault" that is not actually a bug shows up as a column of misses
 * that look like a weakness in the probes, and a fault that breaks two things
 * at once shows up as a catch that proves less than it appears to.
 *
 * Three claims, all checked here rather than trusted:
 *
 *   1. `normaliseWith(CORRECT_NORMALISE)`, `intersectWith(CORRECT_INTERSECT)`
 *      and `subtractWith(CORRECT_SUBTRACT)` are observationally identical to
 *      the real implementations. This is what stops the flagged copies drifting
 *      away from `availability.ts` — change the original and these fail until
 *      the copy follows.
 *   2. Every fault differs from correct in exactly one flag, or is a wrapper
 *      that changes exactly one argument.
 *   3. Every fault is genuinely broken, and no two are the same bug.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { availability, sameIntervals, type AvailabilityApi } from './availability'
import { SAMPLES, sampleNamed } from './arbitraries'
import { SEED } from './config'
import {
  BASELINE_INTERSECT,
  BASELINE_NORMALISE,
  BASELINE_SUBTRACT,
  CORRECT_INTERSECT,
  CORRECT_NORMALISE,
  CORRECT_SUBTRACT,
  FAULT_IDS,
  FAULTS,
  faultNamed,
  NORMALISE_FLAGS,
} from './faults'

const AGREEMENT_DRAWS = 500

const scenarios = SAMPLES.flatMap((sample) =>
  fc.sample(sample.scenario, { seed: SEED, numRuns: AGREEMENT_DRAWS }),
)

describe('the flagged copies against the real implementations', () => {
  it('normalises identically to the real one on every scenario either arbitrary draws', () => {
    for (const { a } of scenarios) {
      expect(sameIntervals(BASELINE_NORMALISE(a), availability.normalise(a))).toBe(true)
    }
  })

  it('intersects identically to the real one', () => {
    for (const { a, b } of scenarios) {
      expect(sameIntervals(BASELINE_INTERSECT(a, b), availability.intersect(a, b))).toBe(true)
    }
  })

  it('subtracts identically to the real one', () => {
    for (const { a, b } of scenarios) {
      expect(sameIntervals(BASELINE_SUBTRACT(a, b), availability.subtract(a, b))).toBe(true)
    }
  })

  it('covers a large enough sample for the agreement to mean something', () => {
    expect(scenarios.length).toBe(SAMPLES.length * AGREEMENT_DRAWS)
  })
})

describe('every fault is one behaviour change', () => {
  it('flips exactly one flag, or is a wrapper that changes one argument', () => {
    for (const fault of FAULTS) {
      if (fault.flag === null) {
        // The two wrapper faults hand the real implementation a changed second
        // operand, which is a faithful model of the bug and cannot drift.
        expect(fault.operation, `${fault.id} is a wrapper`).toBe('subtract')

        continue
      }

      const known = [
        ...NORMALISE_FLAGS,
        ...Object.keys(CORRECT_INTERSECT),
        ...Object.keys(CORRECT_SUBTRACT),
      ]

      expect(known, `${fault.id} names a flag that does not exist`).toContain(fault.flag)
    }
  })

  it('names a flag that belongs to the operation it claims to break', () => {
    const owners: Record<string, readonly string[]> = {
      normalise: NORMALISE_FLAGS,
      intersect: Object.keys(CORRECT_INTERSECT),
      subtract: Object.keys(CORRECT_SUBTRACT),
    }

    for (const fault of FAULTS.filter((candidate) => candidate.flag !== null)) {
      expect(owners[fault.operation], `${fault.id}`).toContain(fault.flag)
    }
  })

  it('leaves the correct settings correct, so a flag is a bug only when flipped', () => {
    expect(CORRECT_NORMALISE).toEqual({
      dropEmpty: true,
      mergeTouching: true,
      extendToFurthestEnd: true,
      keepLast: true,
      clampNegative: false,
      roundEndpoints: false,
    })
    expect(CORRECT_INTERSECT).toEqual({ advanceBoth: false })
    expect(CORRECT_SUBTRACT).toEqual({ normaliseRemovals: true })
  })
})

describe('every fault is genuinely broken', () => {
  const bounded = sampleNamed('bounded')
  const clustered = sampleNamed('clustered')
  const inputs = [
    ...fc.sample(bounded.scenario, { seed: SEED, numRuns: AGREEMENT_DRAWS }),
    ...fc.sample(clustered.scenario, { seed: SEED, numRuns: AGREEMENT_DRAWS }),
  ]

  /** Every answer a system gives, flattened so two systems can be compared. */
  const fingerprint = (system: AvailabilityApi): string =>
    inputs
      .map(({ a, b, point }) =>
        [
          JSON.stringify(system.normalise(a)),
          JSON.stringify(system.union(a, b)),
          JSON.stringify(system.intersect(a, b)),
          JSON.stringify(system.subtract(a, b)),
          String(system.covers(a, point)),
        ].join('|'),
      )
      .join('\n')

  const real = fingerprint(availability)

  it('differs from the real system on at least one generated input', () => {
    // The guard against a fault that has stopped being one — which is exactly
    // what happens when `availability.ts` changes and a copy here does not.
    for (const fault of FAULTS) {
      expect(fingerprint(fault.build()), `${fault.id} behaves like the real system`).not.toBe(real)
    }
  })

  it('gives every fault a distinct behaviour, so no two rows measure one bug', () => {
    const seen = new Map<string, string>()

    for (const fault of FAULTS) {
      const signature = fingerprint(fault.build())
      const existing = seen.get(signature)

      expect(existing, `${fault.id} behaves exactly like ${String(existing)}`).toBeUndefined()
      seen.set(signature, fault.id)
    }
  })
})

describe('the fault catalogue', () => {
  it('lists exactly the faults the ids declare', () => {
    expect(FAULTS.map((fault) => fault.id)).toEqual([...FAULT_IDS])
  })

  it('describes every fault as a user would meet it, not as a diff', () => {
    for (const fault of FAULTS) {
      expect(fault.description.length, `${fault.id} has no description`).toBeGreaterThan(30)
    }
  })

  it('finds a fault by id', () => {
    expect(faultNamed('DROPS_LAST_RANGE').operation).toBe('normalise')
    expect(faultNamed('SUBTRACT_TRUSTS_INPUT_ORDER').flag).toBe('normaliseRemovals')
  })
})
