/**
 * Scoring a selection: safe, and how much it saved.
 *
 * ---------------------------------------------------------------------------
 * The two numbers, and why both
 * ---------------------------------------------------------------------------
 * **Safety** is whether the selection contains every suite that actually
 * failed. It is the only number that can disqualify a strategy, and it is
 * binary per fault: a selection that misses one failing suite reports green on
 * a broken change, which is worse than running nothing at all because it comes
 * with a tick beside it.
 *
 * **Cost** is how many suites were selected out of how many exist. It is the
 * entire reason anybody wants this, and it is meaningless without the first
 * number — `changed-tests` has the best cost in the table and the worst
 * safety, because selecting nothing is extremely cheap.
 *
 * Reading the two together is what makes the matrix say something: the
 * strategies sort into "wrong", "safe and saves nothing", and one row that is
 * safe on all eight faults while running a third of the suite.
 *
 * ---------------------------------------------------------------------------
 * Where the coverage map comes from
 * ---------------------------------------------------------------------------
 * The baseline run, not the faulted one. That is not a convenience: a
 * coverage-based selector in a real pipeline reads a map recorded *before* the
 * diff, and giving it a map recorded after would be measuring a tool nobody
 * has. It is also exactly why the `new-test` fault scores the way it does.
 */

import type { CoverageMap } from './coverage.ts'
import { FAULTS, diffOf, fault as faultById, type FaultId } from './faults.ts'
import type { Measurement } from './runs.ts'
import { select } from './select.ts'
import { STRATEGY_IDS, type StrategyId } from './strategies.ts'
import { FIXTURE_EDGES } from './edges.ts'
import { FIXTURE_TRIGGERS } from './triggers.ts'

export interface Cell {
  readonly fault: FaultId
  readonly strategy: StrategyId
  /** Suites selected. */
  readonly selected: number
  /** Suites that exist in the subject as the fault leaves it. */
  readonly total: number
  /** Suites that actually failed. */
  readonly failing: number
  /** Failing suites the selection left out. Empty is the only acceptable value. */
  readonly missed: readonly string[]
  readonly safe: boolean
  readonly ranAll: boolean
}

export function scoreCell(
  strategy: StrategyId,
  fault: FaultId,
  measurement: Measurement,
  coverage: CoverageMap,
): Cell {
  const run = measurement.runs.get(fault)

  if (run === undefined) throw new Error(`no measured run for fault: ${fault}`)

  const selection = select(strategy, {
    graph: run.graph,
    testFiles: run.testFiles,
    changed: diffOf(faultById(fault)),
    triggers: FIXTURE_TRIGGERS,
    edges: FIXTURE_EDGES,
    coverage,
  })
  const chosen = new Set(selection.suites)
  const missed = run.failing.filter((suite) => !chosen.has(suite))

  return {
    fault,
    strategy,
    selected: selection.suites.length,
    total: run.testFiles.length,
    failing: run.failing.length,
    missed,
    safe: missed.length === 0,
    ranAll: selection.ranAll,
  }
}

/** Every cell: one per strategy per fault. */
export function scoreAll(measurement: Measurement): readonly Cell[] {
  return STRATEGY_IDS.flatMap((strategy) =>
    FAULTS.map((fault) => scoreCell(strategy, fault.id, measurement, measurement.coverage)),
  )
}

/** One strategy, summarised: faults missed, and suites selected across all of them. */
export interface Row {
  readonly strategy: StrategyId
  readonly unsafeFaults: readonly FaultId[]
  readonly selected: number
  readonly total: number
}

export function summarise(cells: readonly Cell[]): readonly Row[] {
  return STRATEGY_IDS.map((strategy) => {
    const row = cells.filter((cell) => cell.strategy === strategy)

    return {
      strategy,
      unsafeFaults: row.filter((cell) => !cell.safe).map((cell) => cell.fault),
      selected: row.reduce((sum, cell) => sum + cell.selected, 0),
      total: row.reduce((sum, cell) => sum + cell.total, 0),
    }
  })
}
