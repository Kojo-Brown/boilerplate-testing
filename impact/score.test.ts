// @vitest-environment node
//
// The arithmetic only. The scores against the real runs are in `runs.test.ts`,
// which is the file that pays for fourteen subprocesses; these cases establish
// that a miss is counted as a miss, which is the one thing the matrix cannot
// show about itself.

import { describe, expect, it } from 'vitest'

import { buildGraph, type Graph } from './graph.ts'
import { FIXTURE_ROOT, isTestFile, treeFiles, type FaultRun, type Measurement } from './runs.ts'
import { scoreCell, summarise, type Cell } from './score.ts'

const files = treeFiles(FIXTURE_ROOT)
const graph: Graph = buildGraph(FIXTURE_ROOT, files)
const testFiles = files.filter(isTestFile)

/** A measurement whose ground truth is stated rather than run, so a cell can be checked. */
function measurementWith(failing: readonly string[]): Measurement {
  const run: FaultRun = {
    fault: 'bulk-threshold',
    files,
    testFiles,
    failing,
    exitCode: 1,
    graph,
  }

  return {
    runs: new Map([['bulk-threshold', run]]),
    coverage: new Map(),
    baseline: { files, testFiles, graph },
  }
}

describe('scoring one cell', () => {
  it('is safe when the selection contains every failing suite', () => {
    const cell = scoreCell(
      'importers-transitive',
      'bulk-threshold',
      measurementWith(['src/pricing.test.ts']),
      new Map(),
    )

    expect(cell).toMatchObject({ selected: 2, failing: 1, missed: [], safe: true, total: 6 })
  })

  it('is unsafe, and names what it missed, when a failing suite was left out', () => {
    const cell = scoreCell(
      'importers-direct',
      'bulk-threshold',
      measurementWith(['src/pricing.test.ts', 'src/cart.test.ts']),
      new Map(),
    )

    expect(cell.safe).toBe(false)
    expect(cell.missed).toEqual(['src/cart.test.ts'])
  })

  // Selecting nothing is the cheapest possible selection and the worst
  // possible answer, and the score has to say both.
  it('counts an empty selection as unsafe rather than as free', () => {
    const cell = scoreCell('changed-tests', 'bulk-threshold', measurementWith(['src/pricing.test.ts']), new Map())

    expect(cell).toMatchObject({ selected: 0, safe: false })
  })

  it('marks the cell that ran everything, so the cost of a trigger is visible', () => {
    const cell = scoreCell('all', 'bulk-threshold', measurementWith(['src/pricing.test.ts']), new Map())

    expect(cell).toMatchObject({ ranAll: true, selected: 6, safe: true })
  })

  it('refuses to score a fault that was never run', () => {
    expect(() => scoreCell('all', 'rate-table', measurementWith([]), new Map())).toThrow('no measured run')
  })
})

describe('summarising a strategy', () => {
  const cells: readonly Cell[] = [
    { fault: 'bulk-threshold', strategy: 'coverage', selected: 2, total: 6, failing: 1, missed: [], safe: true, ranAll: false },
    {
      fault: 'rate-table',
      strategy: 'coverage',
      selected: 0,
      total: 6,
      failing: 1,
      missed: ['src/rates.test.ts'],
      safe: false,
      ranAll: false,
    },
  ]

  it('lists the faults the strategy was unsafe on', () => {
    expect(summarise(cells).find((row) => row.strategy === 'coverage')?.unsafeFaults).toEqual(['rate-table'])
  })

  it('adds up the suites selected across the catalogue', () => {
    expect(summarise(cells).find((row) => row.strategy === 'coverage')).toMatchObject({ selected: 2, total: 12 })
  })

  it('reports a row for every strategy, including the ones with no cells', () => {
    expect(summarise(cells).map((row) => row.strategy)).toContain('all')
  })
})
