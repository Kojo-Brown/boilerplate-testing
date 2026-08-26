/**
 * Measuring what shrinking is worth, instead of describing it.
 *
 * Shrinking is the half of property testing that decides whether anybody keeps
 * using it. A generator that finds a bug and hands you
 * `[[41,49),[7,20),[33,41),[2,6)]` versus `[[0,2),[1,2)]` are the same bug and
 * two entirely different afternoons — and the second one is small enough that
 * you can see the cause without running anything.
 *
 * Two things are measured here, both by putting fast-check in front of a
 * system that is genuinely broken and looking at what comes back.
 *
 *   1. **Shrinking against no shrinking.** `endOnFailure: true` stops the run
 *      at the first counterexample, which is the only honest way to see what
 *      the raw failing input looked like; anything else is guessing at it. The
 *      same property, same seed, same fault, run twice.
 *
 *   2. **A shrinkable arbitrary against an opaque one.** This is the trap
 *      worth knowing about, because the broken version *works*: build the same
 *      values with `fc.constantFrom(...pool)` and generation is identical,
 *      the property still finds the bug, and every counterexample is a leaf
 *      the shrinker cannot take apart. `fc.constantFrom` shrinks toward
 *      earlier entries in the list, so what you get back is whichever
 *      pre-generated monster happened to sit nearest the front — a fact about
 *      the pool's order, not about the bug.
 *
 * The unit is {@link scenarioSize}: range count plus total coordinate
 * magnitude. Any monotone measure of "how much is there to read" would do; the
 * point is to have one, so the comparison is a number rather than two examples
 * chosen to make a point.
 */

import fc from 'fast-check'
import type { AvailabilityApi } from './availability'
import { boundedScenario, type Scenario } from './arbitraries'
import { NUM_RUNS, RUN, RUN_WITHOUT_SHRINKING, SEED } from './config'
import type { Invariant } from './invariants'

/**
 * How much there is to read in a counterexample.
 *
 * Range count first, because that is what a reader meets first, plus the
 * magnitude of every coordinate, because `[[0, 1)]` is easier to reason about
 * than `[[41, 49)]` even though both are one range. Integer coordinates only —
 * this is used on the bounded arbitrary, where the model runs.
 */
export function scenarioSize(scenario: Scenario): number {
  const magnitude = [...scenario.a, ...scenario.b].reduce(
    (total, candidate) => total + Math.abs(candidate.start) + Math.abs(candidate.end),
    0,
  )

  return scenario.a.length + scenario.b.length + magnitude
}

export interface ShrinkMeasurement {
  /** How the arbitrary is described in the README. */
  readonly label: string
  /** The first failing input fast-check found, before any reduction. */
  readonly raw: Scenario | null
  readonly rawSize: number
  /** What it handed back after shrinking. */
  readonly shrunk: Scenario | null
  readonly shrunkSize: number
  readonly numShrinks: number
  /** Whether the reduced input is still a counterexample. */
  readonly stillFails: boolean
}

/** Everything a shrink measurement needs, so the two arbitraries stay comparable. */
export interface ShrinkSubject {
  readonly label: string
  readonly scenario: fc.Arbitrary<Scenario>
}

/**
 * Run one invariant against one broken system, with and without shrinking.
 *
 * The invariant's own predicate is re-run on the reduced input at the end,
 * which is why `Invariant` exposes it: a shrinker that walked off the edge and
 * handed back something that passes is a worse failure than no shrinking at
 * all, and it is not a thing fast-check's own report would tell you.
 */
export function measureShrinking(
  subject: ShrinkSubject,
  api: AvailabilityApi,
  invariant: Invariant,
): ShrinkMeasurement {
  const property = fc.property(subject.scenario, (scenario) => invariant.holds(api, scenario))

  const withShrinking = fc.check(property, RUN)
  const withoutShrinking = fc.check(property, RUN_WITHOUT_SHRINKING)

  if (!withShrinking.failed || !withoutShrinking.failed) {
    throw new Error(
      `${invariant.id} did not fail against this system, so there is nothing to shrink`,
    )
  }

  const raw = withoutShrinking.counterexample?.[0] ?? null
  const shrunk = withShrinking.counterexample?.[0] ?? null

  return {
    label: subject.label,
    raw,
    rawSize: raw === null ? 0 : scenarioSize(raw),
    shrunk,
    shrunkSize: shrunk === null ? 0 : scenarioSize(shrunk),
    numShrinks: withShrinking.numShrinks,
    stillFails: shrunk !== null && !invariant.holds(api, shrunk),
  }
}

/** The arbitrary that shrinks: primitives underneath, `map` on top. */
export const SHRINKABLE: ShrinkSubject = {
  label: 'built with tuple + map',
  scenario: boundedScenario,
}

/**
 * The same values, drawn from a pre-generated pool.
 *
 * Deliberately built *from* `boundedScenario`, so the two subjects generate
 * from the same distribution and the only difference is whether fast-check can
 * see inside a value. Sampling with the run's own seed keeps it deterministic.
 */
export const OPAQUE: ShrinkSubject = {
  label: 'drawn from a pre-generated pool with fc.constantFrom',
  scenario: fc.constantFrom(
    ...fc.sample(boundedScenario, { seed: SEED, numRuns: NUM_RUNS }),
  ),
}
