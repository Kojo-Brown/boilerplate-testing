// @vitest-environment node
//
// The expensive file: fourteen Vitest processes against copies of `fixture/`,
// six to record coverage and eight to apply a fault. Everything in `matrix.ts`
// is re-derived here, so a cell that stops being true fails `pnpm test` rather
// than quietly becoming a wrong row in a README.
//
// No browser, no container, no network. The subject is six suites of
// arithmetic.

import { beforeAll, describe, expect, it } from 'vitest'

import { FAULTS, FAULT_IDS } from './faults.ts'
import { GROUND_TRUTH, MATRIX, SUITES, TOTAL_SUITES, totalSelected, unsafeFaults } from './matrix.ts'
import { measure, type Measurement } from './runs.ts'
import { scoreAll, type Cell } from './score.ts'
import { STRATEGY_IDS } from './strategies.ts'

let measurement: Measurement
let cells: readonly Cell[]

const cellFor = (strategy: string, fault: string): Cell => {
  const found = cells.find((cell) => cell.strategy === strategy && cell.fault === fault)

  if (found === undefined) throw new Error(`no cell for ${strategy} × ${fault}`)

  return found
}

beforeAll(async () => {
  measurement = await measure()
  cells = scoreAll(measurement)
}, 300_000)

describe('the subject', () => {
  it('has the six suites the catalogue is scored against', () => {
    expect(measurement.baseline.testFiles).toEqual([
      'src/cart.test.ts',
      'src/label.test.ts',
      'src/money.test.ts',
      'src/pricing.test.ts',
      'src/rates.test.ts',
      'src/rules/registry.test.ts',
    ])
  })

  it('records a coverage map for every suite, from a real run of it', () => {
    expect([...measurement.coverage.keys()]).toEqual(measurement.baseline.testFiles)
  })

  // The measurement that makes the coverage column worth having: no parser
  // can find these two files, and a run of the suite that loads them does.
  it('records the runtime-loaded rule files in the coverage of the suite that loads them', () => {
    expect([...(measurement.coverage.get('src/rules/registry.test.ts') ?? [])].sort()).toEqual([
      'src/rules/bulk.rule.ts',
      'src/rules/registry.ts',
      'src/rules/weekend.rule.ts',
      'src/support/factory.ts',
    ])
  })

  // And the measurement that stops the coverage column being the answer: the
  // data file is read, not imported, so it is not instrumented and appears in
  // no map at all.
  it('records no coverage for the data file the rate table reads', () => {
    const everything = [...measurement.coverage.values()].flatMap((covered) => [...covered])

    expect(everything).not.toContain('src/data/rates.json')
  })
})

describe('what each fault actually breaks', () => {
  it.each(FAULT_IDS)('%s breaks exactly the suites the ground truth records', (fault) => {
    expect(measurement.runs.get(fault)?.failing).toEqual(GROUND_TRUTH[fault])
  })

  it.each(FAULT_IDS)('%s leaves the subject with the suite count the matrix is scored over', (fault) => {
    expect(measurement.runs.get(fault)?.testFiles).toHaveLength(SUITES[fault])
  })

  it('breaks at least one suite per fault, or there would be nothing to miss', () => {
    expect(FAULTS.filter((fault) => (measurement.runs.get(fault.id)?.failing.length ?? 0) === 0)).toEqual([])
  })

  it('adds a suite for the fault that adds a test file, and only for that one', () => {
    expect(FAULT_IDS.filter((fault) => SUITES[fault] === 7)).toEqual(['new-test'])
  })
})

describe('the published matrix', () => {
  it.each(STRATEGY_IDS)('%s selects what the matrix says, fault by fault', (strategy) => {
    expect(FAULT_IDS.map((fault) => cellFor(strategy, fault).selected)).toEqual(
      FAULT_IDS.map((fault) => MATRIX[strategy][fault].selected),
    )
  })

  it.each(STRATEGY_IDS)('%s is safe on exactly the faults the matrix says it is', (strategy) => {
    expect(FAULT_IDS.filter((fault) => !cellFor(strategy, fault).safe)).toEqual([...unsafeFaults(strategy)])
  })

  it('is scored over 49 suite-runs', () => {
    expect(cells.filter((cell) => cell.strategy === 'all').reduce((sum, cell) => sum + cell.total, 0)).toBe(
      TOTAL_SUITES,
    )
  })

  it.each(STRATEGY_IDS)('%s selects the total the matrix publishes', (strategy) => {
    expect(cells.filter((cell) => cell.strategy === strategy).reduce((sum, cell) => sum + cell.selected, 0)).toBe(
      totalSelected(strategy),
    )
  })
})

describe('the findings the matrix is published for', () => {
  it('shows the full run safe on every fault, which is what every other row is measured against', () => {
    expect(unsafeFaults('all')).toEqual([])
  })

  // The headline. "Run the tests that changed" is the cheapest row in the
  // table by a factor of twenty and misses seven faults out of eight, and
  // every one of those misses is a green build.
  it('shows the cheapest strategy missing seven of the eight faults', () => {
    expect(unsafeFaults('changed-tests')).toHaveLength(7)
    expect(totalSelected('changed-tests')).toBe(1)
  })

  it('shows one hop of the import graph missing a fault two hops away', () => {
    expect(cellFor('importers-direct', 'bulk-threshold').missed).toEqual(['src/cart.test.ts'])
    expect(cellFor('importers-transitive', 'bulk-threshold').missed).toEqual([])
  })

  it('shows the transitive graph missing every dependency that is not an import', () => {
    expect(unsafeFaults('importers-transitive')).toEqual([
      'runtime-rule',
      'rate-table',
      'snapshot-baseline',
      'setup-matcher',
    ])
  })

  it('shows a trigger converting the setup-file miss into a full run', () => {
    expect(cellFor('transitive-triggers', 'setup-matcher')).toMatchObject({ ranAll: true, safe: true })
  })

  it('shows coverage catching the module no parser can see', () => {
    expect(cellFor('coverage', 'runtime-rule').safe).toBe(true)
    expect(cellFor('importers-transitive', 'runtime-rule').safe).toBe(false)
  })

  it('shows coverage missing the data file, the snapshot and the setup file', () => {
    expect(unsafeFaults('coverage')).toContain('rate-table')
    expect(unsafeFaults('coverage')).toContain('snapshot-baseline')
    expect(unsafeFaults('coverage')).toContain('setup-matcher')
  })

  // The one-run-stale blind spot, isolated: the `coverage` row is a pure map
  // lookup, and a test file added by the diff is in no map. Every graph row
  // above covers it because reverse reachability includes its own seed.
  it('shows coverage missing a test the diff added, which the graph rows get for free', () => {
    expect(cellFor('coverage', 'new-test').missed).toEqual(['src/discount.test.ts'])
    expect(cellFor('importers-transitive', 'new-test').missed).toEqual([])
  })

  it('shows one strategy safe on all eight faults', () => {
    expect(STRATEGY_IDS.filter((strategy) => unsafeFaults(strategy).length === 0)).toEqual([
      'all',
      'transitive-triggers-edges',
    ])
  })

  // And the number that matters to anybody deciding whether to adopt this: the
  // safe selector still runs 43% of the suite across a catalogue chosen to be
  // hard, which is a long way from the order-of-magnitude saving the technique
  // is usually sold with.
  it('shows the safe selector running well under half the suite, and well over none of it', () => {
    const share = totalSelected('transitive-triggers-edges') / TOTAL_SUITES

    expect(share).toBeGreaterThan(0.4)
    expect(share).toBeLessThan(0.45)
  })
})
