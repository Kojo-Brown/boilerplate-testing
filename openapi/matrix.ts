/**
 * The experiment: every wiring judges every exchange, and the table is what
 * each one said.
 *
 * A cell is one of four words, and the fourth is the reason there are four:
 *
 *   - `catch` — the wiring produced at least one finding for a drifting
 *     exchange. It would have failed the build.
 *   - `miss`  — the wiring produced nothing for a drifting exchange. The build
 *     is green and the service does not match its document.
 *   - `quiet` — the wiring produced nothing for the *conforming* exchange,
 *     which is what it must do.
 *   - `alarm` — the wiring produced a finding for the conforming exchange. A
 *     column of `catch` under a strategy that also alarms is not a strategy, it
 *     is a broken one, and without this word a wiring that rejected every
 *     response would score a perfect eleven out of eleven.
 *
 * The `none` row exists for the last of those. It is not padding: a matrix of
 * detection rates with no control is how a check that always fires gets adopted.
 */

import { captureCorpus, type Exchange } from './exchange.ts'
import { DRIFTS, type Drift } from './drifts.ts'
import { compileWiring, STRATEGIES, type Finding, type Wiring } from './strategies.ts'

export const OUTCOMES = ['catch', 'miss', 'quiet', 'alarm'] as const

export type Outcome = (typeof OUTCOMES)[number]

/** The drift key whose row is the control. */
export const CONTROL = 'none'

export interface Cell {
  readonly drift: string
  readonly strategy: string
  readonly outcome: Outcome
  /** The first finding, when there was one — what a failing cell prints. */
  readonly detail: string | null
}

export interface Matrix {
  readonly cells: readonly Cell[]
  readonly exchanges: readonly Exchange[]
}

function outcomeFor(drift: string, findings: readonly Finding[]): Outcome {
  if (drift === CONTROL) return findings.length === 0 ? 'quiet' : 'alarm'

  return findings.length === 0 ? 'miss' : 'catch'
}

/** Judge one already-captured exchange with every wiring. */
export function judge(exchange: Exchange, wiring: Wiring): readonly Cell[] {
  return STRATEGIES.map((strategy) => {
    const findings = strategy.check(exchange, wiring.lenient, wiring.strict)

    return {
      drift: exchange.drift,
      strategy: strategy.key,
      outcome: outcomeFor(exchange.drift, findings),
      detail: findings[0]?.message ?? null,
    }
  })
}

/** Capture the corpus and judge all of it. One server per drift, one pass per wiring. */
export async function runMatrix(drifts: readonly Drift[] = DRIFTS): Promise<Matrix> {
  const wiring = compileWiring()
  const exchanges = await captureCorpus(drifts)

  return { cells: exchanges.flatMap((exchange) => judge(exchange, wiring)), exchanges }
}

/** Look one cell up, for assertions that name a pair rather than an index. */
export function cellFor(matrix: Matrix, drift: string, strategy: string): Cell {
  const cell = matrix.cells.find((candidate) => candidate.drift === drift && candidate.strategy === strategy)

  if (cell === undefined) throw new Error(`No cell for ${drift}/${strategy}`)

  return cell
}

/** One drift's row, in the order `STRATEGIES` declares. */
export function rowFor(matrix: Matrix, drift: string): readonly Outcome[] {
  return STRATEGIES.map((strategy) => cellFor(matrix, drift, strategy.key).outcome)
}

/** How many drifts a wiring caught, out of how many there are to catch. */
export function scoreFor(matrix: Matrix, strategy: string): { readonly caught: number; readonly of: number } {
  const row = matrix.cells.filter((cell) => cell.strategy === strategy && cell.drift !== CONTROL)

  return { caught: row.filter((cell) => cell.outcome === 'catch').length, of: row.length }
}
