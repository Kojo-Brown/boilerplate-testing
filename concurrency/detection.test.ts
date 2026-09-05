// @vitest-environment node
//
// Compiles copies of `ledger.ts` and imports them off disk, which needs the
// node environment: jsdom's `import.meta.url` is not a file URL, so
// `fileURLToPath` throws.

import { beforeAll, describe, expect, it } from 'vitest'

import { FAULTS, FAULT_IDS, type FaultId } from './faults.ts'
import { loadControl, loadFaulted } from './load.ts'
import {
  caughtBy,
  cellFor,
  controlFor,
  flakyFor,
  measure,
  missedBy,
  rateOf,
  reliable,
  type Matrix,
} from './matrix.ts'
import { replaying, runScheduled } from './runtime.ts'
import { scenarioNamed, violations, type ScenarioId } from './scenarios.ts'
import {
  explore,
  runsFor,
  STRATEGIES,
  STRESS_REPEATS,
  strategyNamed,
  type StrategyId,
} from './strategies.ts'

// The measurement `README.md` is written from. Every number quoted there is
// asserted here, so the prose cannot drift away from the run.
//
// The grid is 14 variants × 6 strategies × up to 500 trials × 8 scenarios and
// takes a few seconds. That is the measurement, not an accident of the harness:
// the whole question is what a strategy costs to reach a verdict.

let matrix: Matrix

beforeAll(async () => {
  matrix = await measure()
}, 300_000)

/** The detection rate, to the three decimals `README.md` prints. */
const rate = (strategy: StrategyId, fault: FaultId): number =>
  Number(rateOf(matrix, strategy, fault).toFixed(3))

describe('the control', () => {
  // First, and before a single fault is looked at. A strategy that fails on the
  // unedited source reads as a strategy that catches everything, and the matrix
  // becomes a measurement of the harness rather than of the techniques.
  it('holds every invariant in every strategy, on the unedited source', () => {
    for (const strategy of STRATEGIES) {
      const cell = controlFor(matrix, strategy.id)

      expect({ strategy: strategy.id, detections: cell.detections, violated: cell.violated }).toEqual(
        { strategy: strategy.id, detections: 0, violated: [] },
      )
    }
  })

  // A flaky invariant would look exactly like a strategy with a high detection
  // rate, and one run of the correct subject cannot tell the two apart.
  it('runs the correct subject as many times as the faulted ones', () => {
    for (const strategy of STRATEGIES) {
      expect(controlFor(matrix, strategy.id).trials).toBe(strategy.trials)
    }

    expect(controlFor(matrix, 'jittered').trials).toBe(500)
    expect(controlFor(matrix, 'stress').trials).toBe(80)
  })

  it('finishes every task of every scenario, every time', () => {
    for (const strategy of STRATEGIES) {
      expect(controlFor(matrix, strategy.id).violated).not.toContain('every-task-settles')
    }
  })
})

describe('what each strategy catches', () => {
  it('catches 6, 11, 13, 13, 13 and 13 of the thirteen faults', () => {
    expect(STRATEGIES.map((strategy) => caughtBy(matrix, strategy.id).length)).toEqual([
      6, 11, 13, 13, 13, 13,
    ])
    expect(FAULT_IDS).toHaveLength(13)
  })

  // Not "the sequential test is useless". It catches every bug whose
  // concurrency is inside one call, plus the deadlock — which is the one race
  // that shows up without a second caller, because the second caller is the
  // test's own next line.
  it('catches exactly the faults that need no second caller, with no interleaving at all', () => {
    const withoutOverlap = new Set(['sequential', 'deadlock', 'self-interference', 'staleness'])

    for (const fault of FAULTS) {
      expect({ fault: fault.id, caught: rate('sequential', fault.id) > 0 }).toEqual({
        fault: fault.id,
        caught: withoutOverlap.has(fault.hazard),
      })
    }
  })

  it('leaves the seven mutual-exclusion, fairness and lost-update faults to the strategies that overlap', () => {
    expect(missedBy(matrix, 'sequential')).toEqual([
      'MUTEX_NEVER_MARKED_HELD',
      'MUTEX_ACQUIRE_DOES_NOT_WAIT',
      'MUTEX_RELEASE_ALWAYS_CLEARS_HELD',
      'MUTEX_WAKES_THE_NEWEST_WAITER',
      'DEPOSIT_NOT_LOCKED',
      'DEPOSIT_UNLOCKS_BEFORE_WRITING',
      'READ_NEVER_COALESCED',
    ])
  })
})

// ---------------------------------------------------------------------------
// The first headline. `await Promise.all([...])` is the test everybody writes
// for concurrent code, and it is not a search: the microtask queue picks one
// interleaving and picks the same one forever.
// ---------------------------------------------------------------------------
describe('a Promise.all test', () => {
  it('never lands between never and always, on any fault', () => {
    for (const fault of FAULT_IDS) {
      expect({ fault, rate: rate('concurrent', fault) }).toEqual({
        fault,
        rate: rate('concurrent', fault) === 0 ? 0 : 1,
      })
    }

    expect(flakyFor(matrix, 'concurrent')).toEqual([])
  })

  it('misses the two faults whose window the engine happens to step over', () => {
    expect(missedBy(matrix, 'concurrent')).toEqual([
      'MUTEX_RELEASE_ALWAYS_CLEARS_HELD',
      'DEPOSIT_UNLOCKS_BEFORE_WRITING',
    ])
  })

  it('catches five faults no sequential test can reach, at no extra cost', () => {
    const gained = caughtBy(matrix, 'concurrent').filter(
      (fault) => !caughtBy(matrix, 'sequential').includes(fault),
    )

    expect(gained).toHaveLength(5)
    expect(controlFor(matrix, 'concurrent').executions).toBe(
      controlFor(matrix, 'sequential').executions,
    )
  })
})

// ---------------------------------------------------------------------------
// The second headline, and the reason a boolean matrix is the wrong shape for
// concurrency: two of the cells `jittered` ticks are tests that would be red on
// one pull request in seven and green on the next.
// ---------------------------------------------------------------------------
describe('chaos delays', () => {
  it('reaches every fault in the corpus, and is sure of eleven of them', () => {
    expect(missedBy(matrix, 'jittered')).toEqual([])
    expect(FAULT_IDS.filter((fault) => reliable(matrix, 'jittered', fault))).toHaveLength(11)
  })

  it('catches the two narrowest windows 15.0% and 63.4% of the time', () => {
    expect(flakyFor(matrix, 'jittered')).toEqual([
      'MUTEX_RELEASE_ALWAYS_CLEARS_HELD',
      'DEPOSIT_UNLOCKS_BEFORE_WRITING',
    ])
    expect(rate('jittered', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD')).toBe(0.15)
    expect(rate('jittered', 'DEPOSIT_UNLOCKS_BEFORE_WRITING')).toBe(0.634)
  })

  // The same bug, twice, at two window sizes: the lock is gone, and the lock is
  // released one statement early. A boolean matrix records them identically.
  it('separates two versions of the same lost update by an order of magnitude', () => {
    expect(rate('jittered', 'DEPOSIT_NOT_LOCKED')).toBe(1)
    expect(rate('jittered', 'DEPOSIT_UNLOCKS_BEFORE_WRITING')).toBeLessThan(0.7)
  })

  // The third decimal of a rate is noise, and saying so in prose is cheaper
  // than believing it. 500 trials at p ≈ 0.15 carry a 95% interval of about
  // ±0.031, so this re-measures over a disjoint family of 1,000 seeds and holds
  // the two within 0.05 of each other rather than pinning them together.
  it('lands within the sampling error of a rate measured on a different family of seeds', async () => {
    const jittered = strategyNamed('jittered')
    const faulted = await loadFaulted('MUTEX_RELEASE_ALWAYS_CLEARS_HELD')
    let detections = 0

    for (let trial = 700_000; trial < 701_000; trial += 1) {
      const attempt = await jittered.attempt(faulted, trial)

      detections += attempt.violated.length > 0 ? 1 : 0
    }

    expect(detections / 1_000).toBeCloseTo(rate('jittered', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD'), 1)
  }, 60_000)

  it('needs 29 runs of the whole scenario set to be 99% sure of the narrowest one', () => {
    expect(runsFor(rate('jittered', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD'))).toBe(29)
    expect(runsFor(rate('jittered', 'DEPOSIT_UNLOCKS_BEFORE_WRITING'))).toBe(5)
    expect(runsFor(1)).toBe(1)
    expect(runsFor(0)).toBeNull()
  })
})

describe('a stress loop', () => {
  it('turns a 15.0% detection into 96.3%, and still cannot promise a green run means anything', () => {
    expect(rate('stress', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD')).toBe(0.963)
    expect(flakyFor(matrix, 'stress')).toEqual(['MUTEX_RELEASE_ALWAYS_CLEARS_HELD'])
  })

  // The arithmetic nobody does before writing the loop. Repeats are cheap and
  // the return on them is exponential in the wrong direction: 25 of them turn
  // one CI run in seven into one in twenty-seven.
  it('lands within a point of what independent repeats predict', () => {
    const single = rateOf(matrix, 'jittered', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD')
    const predicted = 1 - (1 - single) ** STRESS_REPEATS

    expect(predicted).toBeCloseTo(0.983, 3)
    expect(rateOf(matrix, 'stress', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD')).toBeCloseTo(predicted, 1)
  })

  it('pays 25 times the executions of a single pass for it', () => {
    const stress = controlFor(matrix, 'stress')
    const jittered = controlFor(matrix, 'jittered')

    expect(stress.executions / stress.trials).toBe(
      (jittered.executions / jittered.trials) * STRESS_REPEATS,
    )
  })
})

// ---------------------------------------------------------------------------
// The third headline, and the one that surprised this directory into existing.
// Taking the schedule away from the runtime and drawing it at random is
// strictly *worse* than letting the runtime decide, on the faults the runtime
// happened to catch — a uniform draw spends its choices spreading operations
// out, and a lost update needs them bunched.
// ---------------------------------------------------------------------------
describe('a randomly drawn schedule', () => {
  it('reaches every fault, and is sure of only seven', () => {
    expect(missedBy(matrix, 'schedule')).toEqual([])
    expect(FAULT_IDS.filter((fault) => reliable(matrix, 'schedule', fault))).toHaveLength(7)
  })

  it('makes four faults flaky that a plain Promise.all caught in every run', () => {
    const lost = flakyFor(matrix, 'schedule').filter((fault) => rate('concurrent', fault) === 1)

    expect(lost).toEqual([
      'MUTEX_NEVER_MARKED_HELD',
      'MUTEX_ACQUIRE_DOES_NOT_WAIT',
      'DEPOSIT_NOT_LOCKED',
      'SETTLE_APPLIES_IN_PARALLEL',
    ])
    expect(rate('schedule', 'SETTLE_APPLIES_IN_PARALLEL')).toBe(0.816)
  })

  it('halves the chance of finding the narrowest window compared with chaos delays', () => {
    expect(rate('schedule', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD')).toBe(0.078)
    expect(rate('jittered', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD')).toBeGreaterThan(
      rate('schedule', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD') * 1.9,
    )
  })

  // What it buys instead, and it is not nothing: a failure comes back as the
  // list of choices that produced it, and those choices are the whole run.
  it('comes back with a schedule that reproduces the failure it found', async () => {
    for (const fault of FAULT_IDS) {
      const witness = cellFor(matrix, 'schedule', fault).witness

      expect(witness?.choices).toBeDefined()

      const scenario = scenarioNamed(witness?.scenario as ScenarioId)
      const replayed = await runScheduled(
        await loadFaulted(fault),
        scenario.plan,
        replaying(witness?.choices ?? []),
      )

      expect({
        fault,
        violated: violations(scenario.id, replayed.observation, true),
      }).toEqual({ fault, violated: witness?.violated })
    }
  })
})

describe('enumerating the interleavings', () => {
  it('catches every fault, in every trial, with the search finished', () => {
    expect(missedBy(matrix, 'systematic')).toEqual([])
    expect(flakyFor(matrix, 'systematic')).toEqual([])

    for (const fault of FAULT_IDS) {
      expect({ fault, complete: cellFor(matrix, 'systematic', fault).complete }).toEqual({
        fault,
        complete: true,
      })
    }
  })

  // The finding that makes enumeration affordable here, and it is a property of
  // the subject rather than of the search: a lock that works leaves one
  // operation outstanding at a time, so correct code has almost no
  // interleavings to explore. The space is created by the bug.
  it('finds one interleaving per scenario in the correct ledger, except where a read runs outside the lock', async () => {
    const control = await loadControl()
    const sizes: Partial<Record<ScenarioId, number>> = {}

    for (const scenario of [
      'two-deposits',
      'race-to-empty',
      'queued-writers',
      'late-arrival',
    ] as const) {
      sizes[scenario] = (await explore(control, scenarioNamed(scenario))).executions
    }

    expect(sizes).toEqual({
      'two-deposits': 1,
      'race-to-empty': 1,
      'queued-writers': 1,
      'late-arrival': 5,
    })
  })

  it('explores the space the bug opens up, and finds the narrowest fault in twelve runs', async () => {
    const faulted = await loadFaulted('MUTEX_RELEASE_ALWAYS_CLEARS_HELD')
    const attempt = await explore(faulted, scenarioNamed('late-arrival'))

    expect(attempt.executions).toBe(12)
    expect(attempt.complete).toBe(true)
    expect(attempt.violated).toEqual(['a-late-arrival-does-not-overwrite-the-holder'])
  })

  // The cost comparison the whole directory is for. Twelve executions of one
  // scenario, and the answer is *certain* — against 29 sweeps of everything for
  // a 99% chance, or 25 repeats that still leave one run in twenty-seven green.
  it('costs less than the stress loop that is still not sure', () => {
    const sweep = controlFor(matrix, 'jittered').executions / controlFor(matrix, 'jittered').trials
    const runs = runsFor(rate('jittered', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD')) ?? 0

    expect(sweep * runs).toBe(232)
    expect(cellFor(matrix, 'systematic', 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD').executions).toBe(19)
  })

  it('pays for the certainty in executions when exclusion is gone entirely', () => {
    expect(cellFor(matrix, 'systematic', 'MUTEX_NEVER_MARKED_HELD').executions).toBe(383)
    expect(controlFor(matrix, 'systematic').executions).toBe(12)
  })
})

describe('which invariant caught what', () => {
  it('catches the unfair wake-up through the ordering claim and nothing else', () => {
    expect(cellFor(matrix, 'systematic', 'MUTEX_WAKES_THE_NEWEST_WAITER').violated).toEqual([
      'waiters-are-served-in-arrival-order',
    ])
  })

  // The one fault that produces no answer at all. Every strategy sees it, and
  // sees it the same way: the tasks are still waiting when the budget runs out.
  it('catches the unreleased lock through nothing but the tasks failing to finish', () => {
    for (const strategy of STRATEGIES) {
      expect({
        strategy: strategy.id,
        violated: cellFor(matrix, strategy.id, 'LOCK_RELEASED_ONLY_ON_SUCCESS').violated,
      }).toEqual({ strategy: strategy.id, violated: ['every-task-settles'] })
    }
  })

  it('catches the stampede through the coalescing claim, which a sequential run cannot state', () => {
    expect(cellFor(matrix, 'systematic', 'READ_NEVER_COALESCED').violated).toEqual([
      'overlapping-reads-hit-the-store-once',
    ])
    expect(cellFor(matrix, 'sequential', 'READ_NEVER_COALESCED').violated).toEqual([])
  })

  it('catches the self-racing batch with one task and no concurrency in the test at all', () => {
    expect(cellFor(matrix, 'sequential', 'SETTLE_APPLIES_IN_PARALLEL').violated).toEqual([
      'a-batch-applies-every-line',
    ])
  })
})

describe('the strategies', () => {
  it('runs one trial of each deterministic strategy and many of each drawn one', () => {
    expect(STRATEGIES.map((strategy) => strategy.trials)).toEqual([1, 1, 500, 80, 500, 1])
  })

  it('summarises every strategy in a sentence', () => {
    for (const strategy of STRATEGIES) {
      expect(strategy.summary.endsWith('.')).toBe(true)
    }
  })

  it('refuses a strategy it has no entry for', () => {
    // @ts-expect-error — the point of the check is the id that is not in the union.
    expect(() => strategyNamed('guessing')).toThrow('no strategy named guessing')
  })
})
