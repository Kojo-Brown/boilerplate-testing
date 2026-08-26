/**
 * What each arbitrary actually generates, counted.
 *
 * The gap between what an arbitrary is *for* and what it *produces* is where
 * property suites quietly stop testing anything, and it is invisible from the
 * call site: `fc.assert(fc.property(wideScenario, …))` reads exactly like
 * `fc.assert(fc.property(clusteredScenario, …))` and reports the same two
 * hundred passing runs. The only way to know the difference is to draw a large
 * sample and count.
 *
 * fast-check ships `fc.statistics` for the interactive version of this — print
 * a distribution to a terminal and look at it. That is the right tool while
 * writing an arbitrary and the wrong one afterwards, because nothing fails
 * when the distribution moves. The counts below go into `README.md` under a
 * test, so a change to an arbitrary that stops it generating touching
 * endpoints fails `pnpm test` rather than being noticed by whoever next reads
 * the file.
 *
 * The number of draws is deliberately larger than `NUM_RUNS`. A profile is
 * describing the generator, not testing the system, and a percentage taken
 * over two hundred values moves by half a point when one draw changes.
 */

import fc from 'fast-check'
import { type Sample } from './arbitraries'
import { SEED } from './config'
import { situationsOf, SITUATIONS, type Situation } from './coverage'

/** Draws per profile. */
export const PROFILE_DRAWS = 1000

export interface ArbitraryProfile {
  readonly id: string
  readonly draws: number
  /** How many drawn scenarios were in each situation. */
  readonly counts: Readonly<Record<Situation, number>>
}

/** One decimal place, the way the README prints it. */
export const percent = (count: number, draws: number): string =>
  `${((count / draws) * 100).toFixed(1)}%`

export function profileSample(sample: Sample, draws: number = PROFILE_DRAWS): ArbitraryProfile {
  const counts = Object.fromEntries(SITUATIONS.map((situation) => [situation, 0])) as Record<
    Situation,
    number
  >

  for (const scenario of fc.sample(sample.scenario, { seed: SEED, numRuns: draws })) {
    for (const situation of situationsOf(scenario)) {
      counts[situation] += 1
    }
  }

  return { id: sample.id, draws, counts }
}
