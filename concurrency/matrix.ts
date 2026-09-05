/**
 * The measurement: every strategy against every fault, plus the control.
 *
 * Computed once and shared, because a faulted subject is a compiled copy of
 * `ledger.ts` and the whole grid is 14 variants × 6 strategies × up to 200
 * trials × 9 scenarios. Running it per test file would make this the slowest
 * thing in the repository by an order of magnitude.
 *
 * ---------------------------------------------------------------------------
 * Why a rate and not a tick
 * ---------------------------------------------------------------------------
 * Every other detection matrix in this repository is boolean: the probe either
 * catches the fault or it does not. That answer is wrong for concurrency, and
 * wrong in the direction that gets people hurt. A strategy that catches a race
 * one run in twenty *does* catch it — the cell would be ticked — and in a suite
 * it is a test that goes red on unrelated pull requests until somebody
 * quarantines it. The number that decides whether a strategy is usable is how
 * often it catches, so every cell here is a count of detections over trials,
 * and `strategies.ts#runsFor` turns that into the number of runs a gate would
 * need.
 *
 * ---------------------------------------------------------------------------
 * Why the control comes first
 * ---------------------------------------------------------------------------
 * `detection.test.ts` asserts, before it looks at a single fault, that every
 * strategy holds every invariant it can state on the unedited source, in every
 * trial. Without that, a strategy that is simply broken — a scenario whose
 * tasks never overlap, an invariant asserting something the ledger never
 * promised — reads as a strategy that catches everything, and the matrix
 * becomes a measurement of the harness.
 *
 * The control also has to be run at full trial count, not once. A flaky
 * *invariant* would look like a strategy with a high detection rate, and the
 * only way to see it is to run the correct subject as many times as the faulted
 * ones.
 */

import { FAULT_IDS, type FaultId } from './faults.ts'
import { loadControl, loadFaulted } from './load.ts'
import type { InvariantId } from './scenarios.ts'
import {
  STRATEGIES,
  type Attempt,
  type StrategyId,
  type Witness,
} from './strategies.ts'

/** What one strategy saw of one variant, over all its trials. */
export interface Cell {
  readonly strategy: StrategyId
  /** `null` for the unedited source. */
  readonly fault: FaultId | null
  /** Trials in which at least one invariant was violated. */
  readonly detections: number
  readonly trials: number
  /** Scenario executions paid for, across every trial. */
  readonly executions: number
  /** Store operations issued, across every trial. */
  readonly operations: number
  /** Every invariant violated in any trial, in declaration order of discovery. */
  readonly violated: readonly InvariantId[]
  /** The first failing run, in a form somebody could re-run. */
  readonly witness: Witness | null
  /** False when a search hit its budget. */
  readonly complete: boolean
}

export interface Matrix {
  readonly control: readonly Cell[]
  readonly faulted: readonly Cell[]
}

async function measureCell(
  strategy: (typeof STRATEGIES)[number],
  fault: FaultId | null,
): Promise<Cell> {
  const subject = fault === null ? await loadControl() : await loadFaulted(fault)
  const attempts: Attempt[] = []

  for (let trial = 0; trial < strategy.trials; trial += 1) {
    attempts.push(await strategy.attempt(subject, trial))
  }

  const violated: InvariantId[] = []

  for (const attempt of attempts) {
    for (const invariant of attempt.violated) {
      if (!violated.includes(invariant)) {
        violated.push(invariant)
      }
    }
  }

  return {
    strategy: strategy.id,
    fault,
    detections: attempts.filter((attempt) => attempt.violated.length > 0).length,
    trials: attempts.length,
    executions: attempts.reduce((sum, attempt) => sum + attempt.executions, 0),
    operations: attempts.reduce((sum, attempt) => sum + attempt.operations, 0),
    violated,
    witness: attempts.find((attempt) => attempt.witness !== null)?.witness ?? null,
    complete: attempts.every((attempt) => attempt.complete),
  }
}

let pending: Promise<Matrix> | null = null

export function measure(): Promise<Matrix> {
  pending ??= (async (): Promise<Matrix> => {
    const control: Cell[] = []
    const faulted: Cell[] = []

    for (const strategy of STRATEGIES) {
      control.push(await measureCell(strategy, null))

      for (const fault of FAULT_IDS) {
        faulted.push(await measureCell(strategy, fault))
      }
    }

    return { control, faulted }
  })()

  return pending
}

export const cellFor = (matrix: Matrix, strategy: StrategyId, fault: FaultId): Cell => {
  const found = matrix.faulted.find(
    (cell) => cell.strategy === strategy && cell.fault === fault,
  )

  if (found === undefined) {
    throw new Error(`no cell for ${strategy} on ${fault}`)
  }

  return found
}

export const controlFor = (matrix: Matrix, strategy: StrategyId): Cell => {
  const found = matrix.control.find((cell) => cell.strategy === strategy)

  if (found === undefined) {
    throw new Error(`no control cell for ${strategy}`)
  }

  return found
}

/** Detections over trials, in [0, 1]. */
export const rateOf = (matrix: Matrix, strategy: StrategyId, fault: FaultId): number => {
  const cell = cellFor(matrix, strategy, fault)

  return cell.trials === 0 ? 0 : cell.detections / cell.trials
}

/** Whether a strategy ever caught a fault. */
export const detected = (matrix: Matrix, strategy: StrategyId, fault: FaultId): boolean =>
  cellFor(matrix, strategy, fault).detections > 0

/** Whether a strategy caught a fault in every trial it ran. */
export const reliable = (matrix: Matrix, strategy: StrategyId, fault: FaultId): boolean =>
  rateOf(matrix, strategy, fault) === 1

/** The faults a strategy ever caught, in corpus order. */
export const caughtBy = (matrix: Matrix, strategy: StrategyId): readonly FaultId[] =>
  FAULT_IDS.filter((fault) => detected(matrix, strategy, fault))

/** The faults a strategy never caught, in corpus order. */
export const missedBy = (matrix: Matrix, strategy: StrategyId): readonly FaultId[] =>
  FAULT_IDS.filter((fault) => !detected(matrix, strategy, fault))

/** The faults a strategy caught in some trials and missed in others. */
export const flakyFor = (matrix: Matrix, strategy: StrategyId): readonly FaultId[] =>
  FAULT_IDS.filter((fault) => {
    const rate = rateOf(matrix, strategy, fault)

    return rate > 0 && rate < 1
  })
