/**
 * The six ways of testing concurrent code that this directory compares.
 *
 * They are in the order a team discovers them, which is also roughly the order
 * of how much they cost:
 *
 *   1. `sequential`   — the ordinary test. Await each operation in turn.
 *   2. `concurrent`   — `await Promise.all([...])`. The first thing anybody
 *                       writes when told to test concurrency, and the one whose
 *                       behaviour surprises people most (see below).
 *   3. `jittered`     — chaos scheduling: make every store call take a random
 *                       number of microtasks, so overlapping operations
 *                       interleave differently from run to run.
 *   4. `stress`       — the same thing in a loop. The strategy a flaky bug
 *                       usually provokes somebody into writing.
 *   5. `schedule`     — take the interleaving away from the runtime: suspend
 *                       every store operation and pick which one settles next,
 *                       at random, recording the choices.
 *   6. `systematic`   — the same controlled scheduler, enumerating the choices
 *                       instead of drawing them.
 *
 * ---------------------------------------------------------------------------
 * The thing to notice about `concurrent`
 * ---------------------------------------------------------------------------
 * It is not random. `Promise.all` starts every task and the microtask queue
 * then runs them in a fixed, deterministic order, so the test explores exactly
 * *one* interleaving — the same one, on every machine, forever. That is the
 * opposite of the two properties people assume it has. It cannot be flaky (a
 * comfort) and it cannot find anything outside the schedule the engine happens
 * to pick (a problem), and neither fact is visible from reading the test.
 *
 * ---------------------------------------------------------------------------
 * Why jitter is counted in microtasks and not milliseconds
 * ---------------------------------------------------------------------------
 * The usual way to write `jittered` is `await sleep(Math.random() * 10)`.
 * That makes the suite slow *and* leaves it non-reproducible, which is the
 * worst pair available; `CLAUDE.md` bans the sleeps and `determinism/README.md`
 * spends a directory on the second half. A draw here is a number of microtask
 * turns, from a seeded generator, which reorders operations exactly as a sleep
 * would and costs nothing. Every rate in `README.md` is therefore a property of
 * a fixed family of seeds, and re-running the matrix reproduces it exactly.
 *
 * That is a real difference from a suite in the wild, and it flatters nobody:
 * `jittered` here has a *better* failure story than the version people write,
 * because a failure comes back with the seed that caused it.
 */

import { createRng } from '../fuzz/random.ts'

import { runFree, runScheduled, type Chooser, type Subject } from './runtime.ts'
import { SCENARIOS, violations, type InvariantId, type ScenarioId } from './scenarios.ts'

export const STRATEGY_IDS = [
  'sequential',
  'concurrent',
  'jittered',
  'stress',
  'schedule',
  'systematic',
] as const

export type StrategyId = (typeof STRATEGY_IDS)[number]

/** A failing run, in the form that lets somebody else re-run it. */
export interface Witness {
  readonly scenario: ScenarioId
  readonly violated: readonly InvariantId[]
  /** The scheduler choices that produced it, for the strategies that have them. */
  readonly choices: readonly number[] | null
  /** The seed that produced it, for the strategies that draw one. */
  readonly seed: number | null
}

/** What one independent trial of a strategy saw. */
export interface Attempt {
  readonly violated: readonly InvariantId[]
  /** Scenario executions this trial paid for. */
  readonly executions: number
  /** Store operations issued across those executions. */
  readonly operations: number
  /** The first failing run, when there was one. */
  readonly witness: Witness | null
  /**
   * False when a search hit its budget before covering everything it meant to.
   * Only `systematic` can report anything but `true`.
   */
  readonly complete: boolean
}

export interface Strategy {
  readonly id: StrategyId
  readonly summary: string
  /** Whether tasks can be in flight at the same time. */
  readonly overlapping: boolean
  /**
   * Independent trials the matrix runs.
   *
   * One for the deterministic strategies, because a second trial of a
   * deterministic strategy is a copy of the first.
   */
  readonly trials: number
  readonly attempt: (subject: Subject, trial: number) => Promise<Attempt>
}

/** Distinct interleavings a stress trial pays for. */
export const STRESS_REPEATS = 25

/** Scenario executions a systematic search will spend before giving up. */
export const SYSTEMATIC_BUDGET = 400

/**
 * How far apart the seed families are.
 *
 * `jittered` and `stress` must not draw the same delay sequences, or the
 * comparison between them would be "one run against the same run twenty-five
 * times" rather than against twenty-five different ones.
 */
const JITTER_SEEDS = 1_000
const STRESS_SEEDS = 500_000
const SCHEDULE_SEEDS = 9_000_000

const MAX_JITTER_TICKS = 4

const emptyAttempt = (): {
  violated: InvariantId[]
  executions: number
  operations: number
  witness: Witness | null
} => ({ violated: [], executions: 0, operations: 0, witness: null })

/** One pass over every scenario with the runtime deciding the interleaving. */
async function sweepFree(
  subject: Subject,
  shape: 'sequential' | 'overlapping',
  latency: () => number,
  seed: number | null,
): Promise<Attempt> {
  const found = emptyAttempt()

  for (const scenario of SCENARIOS) {
    const observation = await runFree(subject, scenario.plan, shape, latency)
    const violated = violations(scenario.id, observation, shape === 'overlapping')

    found.executions += 1
    found.operations += observation.operations.length
    found.violated.push(...violated)

    if (violated.length > 0 && found.witness === null) {
      found.witness = { scenario: scenario.id, violated, choices: null, seed }
    }
  }

  return { ...found, violated: [...new Set(found.violated)], complete: true }
}

/** One pass over every scenario with the schedule drawn from a seed. */
async function sweepScheduled(subject: Subject, seed: number): Promise<Attempt> {
  const found = emptyAttempt()
  const rng = createRng(seed)
  const choose: Chooser = (count) => rng.int(count)

  for (const scenario of SCENARIOS) {
    const run = await runScheduled(subject, scenario.plan, choose)
    const violated = violations(scenario.id, run.observation, true)

    found.executions += 1
    found.operations += run.observation.operations.length
    found.violated.push(...violated)

    if (violated.length > 0 && found.witness === null) {
      found.witness = {
        scenario: scenario.id,
        violated,
        choices: run.schedule.choices,
        seed,
      }
    }
  }

  return { ...found, violated: [...new Set(found.violated)], complete: true }
}

/**
 * Every interleaving of one scenario's store operations, up to a budget.
 *
 * A depth-first walk of the choice tree, re-running the scenario from the start
 * for each path: at every decision point the run reports how many operations
 * were pending, so the alternatives to the one taken can be queued as prefixes
 * to try later. Re-running rather than snapshotting is what makes this fit in a
 * page — a JavaScript continuation cannot be forked, and the scenarios are
 * microseconds each.
 *
 * The budget is not a detail. It is why the strategy is called `systematic`
 * rather than `exhaustive`: `complete` says whether the tree was actually
 * covered, and `README.md` reports which scenarios come back short.
 */
export async function explore(
  subject: Subject,
  scenario: (typeof SCENARIOS)[number],
  budget: number = SYSTEMATIC_BUDGET,
): Promise<Attempt> {
  const found = emptyAttempt()
  const queue: number[][] = [[]]
  let complete = true

  while (queue.length > 0) {
    if (found.executions >= budget) {
      complete = false
      break
    }

    const prefix = queue.pop() ?? []
    const run = await runScheduled(
      subject,
      scenario.plan,
      (_count, step) => prefix[step] ?? 0,
    )
    const violated = violations(scenario.id, run.observation, true)

    found.executions += 1
    found.operations += run.observation.operations.length
    found.violated.push(...violated)

    if (violated.length > 0 && found.witness === null) {
      found.witness = {
        scenario: scenario.id,
        violated,
        choices: run.schedule.choices,
        seed: null,
      }
    }

    for (let step = prefix.length; step < run.schedule.options.length; step += 1) {
      for (let alternative = 1; alternative < (run.schedule.options[step] ?? 1); alternative += 1) {
        queue.push([...run.schedule.choices.slice(0, step), alternative])
      }
    }
  }

  return { ...found, violated: [...new Set(found.violated)], complete }
}

export const STRATEGIES: readonly Strategy[] = [
  {
    id: 'sequential',
    summary: 'Await each operation to completion before starting the next.',
    overlapping: false,
    trials: 1,
    attempt: (subject) => sweepFree(subject, 'sequential', () => 0, null),
  },
  {
    id: 'concurrent',
    summary: 'Start every operation and `await Promise.all`, letting the microtask queue decide.',
    overlapping: true,
    trials: 1,
    attempt: (subject) => sweepFree(subject, 'overlapping', () => 0, null),
  },
  {
    id: 'jittered',
    summary: 'As `concurrent`, with every store call delayed by a drawn number of microtasks.',
    overlapping: true,
    trials: 500,
    attempt: (subject, trial) => {
      const seed = JITTER_SEEDS + trial
      const rng = createRng(seed)

      return sweepFree(subject, 'overlapping', () => rng.int(MAX_JITTER_TICKS), seed)
    },
  },
  {
    id: 'stress',
    summary: `As \`jittered\`, repeated ${STRESS_REPEATS} times with a fresh draw each time.`,
    overlapping: true,
    trials: 80,
    attempt: async (subject, trial) => {
      const merged = emptyAttempt()
      let repeats = 0

      while (repeats < STRESS_REPEATS) {
        const seed = STRESS_SEEDS + trial * STRESS_REPEATS + repeats
        const rng = createRng(seed)
        const attempt = await sweepFree(
          subject,
          'overlapping',
          () => rng.int(MAX_JITTER_TICKS),
          seed,
        )

        merged.executions += attempt.executions
        merged.operations += attempt.operations
        merged.violated.push(...attempt.violated)
        merged.witness ??= attempt.witness
        repeats += 1
      }

      return { ...merged, violated: [...new Set(merged.violated)], complete: true }
    },
  },
  {
    id: 'schedule',
    summary: 'Suspend every store operation and settle them in a drawn order, recording it.',
    overlapping: true,
    trials: 500,
    attempt: (subject, trial) => sweepScheduled(subject, SCHEDULE_SEEDS + trial),
  },
  {
    id: 'systematic',
    summary: `Enumerate the interleavings of each scenario, up to ${SYSTEMATIC_BUDGET} runs of it.`,
    overlapping: true,
    trials: 1,
    attempt: async (subject) => {
      const merged = emptyAttempt()
      let complete = true

      for (const scenario of SCENARIOS) {
        const attempt = await explore(subject, scenario, SYSTEMATIC_BUDGET)

        merged.executions += attempt.executions
        merged.operations += attempt.operations
        merged.violated.push(...attempt.violated)
        merged.witness ??= attempt.witness
        complete &&= attempt.complete
      }

      return { ...merged, violated: [...new Set(merged.violated)], complete }
    },
  },
]

export const strategyNamed = (id: StrategyId): Strategy => {
  const found = STRATEGIES.find((strategy) => strategy.id === id)

  if (found === undefined) {
    throw new Error(`no strategy named ${id}`)
  }

  return found
}

/**
 * Runs that would be needed for a detection rate to be a gate somebody trusts.
 *
 * The arithmetic nobody does before writing `for (let i = 0; i < 100; i++)`: at
 * a per-run detection probability `rate`, the chance of seeing nothing in `n`
 * runs is `(1 - rate) ** n`, so reaching 99% confidence takes
 * `log(0.01) / log(1 - rate)` of them. It is the number that decides whether a
 * stress test is a gate or a lottery, and it goes to infinity fast: a fault
 * found in one run in fifty needs 228.
 */
export function runsFor(rate: number, confidence = 0.99): number | null {
  if (rate <= 0) {
    return null
  }

  if (rate >= 1) {
    return 1
  }

  return Math.ceil(Math.log(1 - confidence) / Math.log(1 - rate))
}
