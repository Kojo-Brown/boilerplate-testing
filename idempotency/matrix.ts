/**
 * Eleven hazards, eight strategies, eighty-eight cells, re-derived on every run.
 *
 * Nothing here is recorded. `README.md` states what each cell should be and
 * `matrix.test.ts` compares the live run against it, in both directions — a
 * cell the README claims and the run does not produce is a failure, and so is a
 * cell the run produces that the README does not mention. That is the same
 * arrangement `openapi/`, `dbisolation/` and `containers/` use, and the reason
 * is the one `openapi/readme.ts` gives: a README generated from the code cannot
 * be wrong and cannot be informative either.
 */

import { HAZARDS, type Hazard } from './hazards.ts'
import { runDeliveries, type Observation } from './harness.ts'
import { classify, handled, type Outcome } from './scoring.ts'
import { retryDelay, seededJitter, STRATEGIES, subjectFor, type Strategy } from './strategies.ts'

export interface Cell {
  readonly hazard: string
  readonly strategy: string
  readonly outcome: Outcome
  readonly handled: boolean
  /** Charges committed, for the failure message. */
  readonly charges: number
  /** Money moved, for the failure message. */
  readonly gatewayEffects: number
}

export interface Matrix {
  readonly cells: readonly Cell[]
}

/** The seed for every jittered backoff. One run, one table, byte for byte. */
export const JITTER_SEED = 0x5f3a_c001

/**
 * Apply a strategy's client retry policy to a hazard's deliveries.
 *
 * Only ever *adds* a delay to a delivery that did not declare one: a hazard
 * that says "the retry arrives ninety seconds later" is making a statement
 * about the key's expiry, and a client policy is not allowed to overrule it.
 * That ordering is what keeps `retry-backoff` a comparison of safety rather
 * than an accidental comparison of timing.
 */
function scheduleFor(hazard: Hazard, strategy: Strategy): Hazard {
  if (strategy.retry === 'immediate') return hazard

  const jitter = seededJitter(JITTER_SEED)
  let attempt = 0

  return {
    ...hazard,
    deliveries: hazard.deliveries.map((delivery, index) => {
      if (index === 0) return delivery

      attempt += 1

      if (delivery.delayBefore !== undefined) return delivery

      return { ...delivery, delayBefore: retryDelay(strategy.retry, attempt, jitter) }
    }),
  }
}

/** Run one cell. Exported because a failing cell is usually read on its own. */
export async function runCell(hazard: Hazard, strategy: Strategy): Promise<Cell> {
  const scheduled = scheduleFor(hazard, strategy)
  const observation = await runDeliveries(
    subjectFor(strategy),
    scheduled.deliveries,
    hazard.gatewayOutcomes === undefined ? {} : { gatewayOutcomes: hazard.gatewayOutcomes },
  )
  const outcome = classify(observation, hazard)

  return {
    hazard: hazard.key,
    strategy: strategy.key,
    outcome,
    handled: handled(outcome, hazard),
    charges: observation.charges,
    gatewayEffects: observation.gatewayEffects,
  }
}

/** Run one cell and keep the whole observation, for tests that need the detail. */
export async function observeCell(
  hazard: Hazard,
  strategy: Strategy,
): Promise<{ readonly cell: Cell; readonly observation: Observation }> {
  const scheduled = scheduleFor(hazard, strategy)
  const observation = await runDeliveries(
    subjectFor(strategy),
    scheduled.deliveries,
    hazard.gatewayOutcomes === undefined ? {} : { gatewayOutcomes: hazard.gatewayOutcomes },
  )
  const outcome = classify(observation, hazard)

  return {
    cell: {
      hazard: hazard.key,
      strategy: strategy.key,
      outcome,
      handled: handled(outcome, hazard),
      charges: observation.charges,
      gatewayEffects: observation.gatewayEffects,
    },
    observation,
  }
}

/**
 * The whole table.
 *
 * Serial rather than `Promise.all`, and it costs nothing worth having: each
 * cell builds its own `Store`, so there is no shared state to race over, but a
 * parallel run interleaves the microtask queues of eighty-eight independent
 * harnesses and the parked-delivery release in `runDeliveries` is written
 * against one. Serial keeps the interleaving the hazards describe.
 */
export async function runMatrix(
  hazards: readonly Hazard[] = HAZARDS,
  strategies: readonly Strategy[] = STRATEGIES,
): Promise<Matrix> {
  const cells: Cell[] = []

  for (const hazard of hazards) {
    for (const strategy of strategies) {
      cells.push(await runCell(hazard, strategy))
    }
  }

  return { cells }
}

export function cellFor(matrix: Matrix, hazard: string, strategy: string): Cell {
  const cell = matrix.cells.find(
    (candidate) => candidate.hazard === hazard && candidate.strategy === strategy,
  )

  if (cell === undefined) throw new Error(`No cell for ${hazard}/${strategy}`)

  return cell
}

/** One hazard's row, in the order `STRATEGIES` declares. */
export const rowFor = (matrix: Matrix, hazard: string): readonly Outcome[] =>
  STRATEGIES.map((strategy) => cellFor(matrix, hazard, strategy.key).outcome)

/** How many hazards a strategy handled, out of how many there are. */
export function scoreFor(matrix: Matrix, strategy: string): { readonly handled: number; readonly of: number } {
  const column = matrix.cells.filter((cell) => cell.strategy === strategy)

  return { handled: column.filter((cell) => cell.handled).length, of: column.length }
}
