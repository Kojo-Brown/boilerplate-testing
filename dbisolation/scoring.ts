/**
 * The scoring rule, and the subtraction the whole matrix rests on.
 *
 * Its own module, with no driver import, for the reason `rewrite.ts` has one:
 * this is a pure function over run records that decides what every cell of the
 * detection table means, and it is worth testing against synthetic runs in
 * `pnpm test` rather than only as a by-product of an eighty-eight-run container
 * suite.
 *
 * The rule: a fault counts as caught only when some behaviour was **green on
 * the correct subject and red with the fault**. Dropping that qualification
 * scores `rollback-savepoint` at 10/10 — `notification` is red on every faulted
 * run because it is red on every run — and reverses the directory's headline
 * finding. `scoring.test.ts` pins it from both sides.
 */

import type { Fault } from './faults.ts'

/** What one behaviour did. */
export interface BehaviourResult {
  readonly behaviour: string
  readonly red: boolean
  readonly detail: string | null
}

/** One suite run: a strategy, a subject, seven behaviours. */
export interface SuiteRun {
  readonly strategy: string
  /** `null` is the control: the correct subject. */
  readonly fault: Fault | null
  readonly results: readonly BehaviourResult[]
}

/** How a strategy scored one fault, relative to its own control run. */
export type Detection = 'caught' | 'missed'

export interface StrategyReport {
  readonly strategy: string
  /** Behaviours that are red on the correct subject. Their verdicts carry no information. */
  readonly falseAlarms: readonly string[]
  /** Per fault: caught or missed. */
  readonly detection: ReadonlyMap<Fault, Detection>
  /** Per fault: the behaviours that went from green to red. */
  readonly catchers: ReadonlyMap<Fault, readonly string[]>
}

/** Score one strategy's runs against its own control. */
export function scoreStrategy(strategy: string, runs: readonly SuiteRun[]): StrategyReport {
  const mine = runs.filter((run) => run.strategy === strategy)
  const control = mine.find((run) => run.fault === null)

  if (control === undefined) {
    throw new Error(`No control run for strategy ${strategy}`)
  }

  const falseAlarms = control.results.filter((result) => result.red).map((result) => result.behaviour)
  const detection = new Map<Fault, Detection>()
  const catchers = new Map<Fault, readonly string[]>()

  for (const run of mine) {
    if (run.fault === null) {
      continue
    }

    // Green in the control and red now. A behaviour that was already red is
    // excluded rather than credited: its verdict does not depend on the
    // subject, so it cannot be evidence about the subject.
    const caught = run.results
      .filter((result) => result.red && !falseAlarms.includes(result.behaviour))
      .map((result) => result.behaviour)

    detection.set(run.fault, caught.length > 0 ? 'caught' : 'missed')
    catchers.set(run.fault, caught)
  }

  return { strategy, falseAlarms, detection, catchers }
}
