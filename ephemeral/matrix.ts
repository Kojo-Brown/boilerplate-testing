/**
 * Running every hazard against every wiring.
 *
 * Ninety-six cells, each one a fresh {@link Harness} — a fresh cloud, a fresh
 * set of datasets, a fresh clock at zero. Sharing any of that between cells
 * would make the table depend on the order it was computed in, which is the
 * one property a comparison may not have.
 *
 * The derivation is cheap enough (no containers, no sockets, no sleeps) that
 * `matrix.test.ts` re-derives the whole thing rather than caching it to disk.
 * A table checked into the repository is a table that can be stale; this one
 * cannot be, because it does not exist until a test asks for it.
 */

import { HAZARDS, type Hazard } from './hazards.ts'
import { Harness } from './harness.ts'
import { classify, handled, score, type Outcome } from './scoring.ts'
import { STRATEGIES, type Strategy } from './strategies.ts'

/** One played timeline. */
export interface Cell {
  readonly hazard: string
  readonly strategy: string
  readonly outcome: Outcome
  /** Whether the outcome is the one the hazard calls correct. */
  readonly handled: boolean
}

/** Play one hazard against one wiring. */
export function run(strategy: Strategy, hazard: Hazard): Cell {
  const observation = Harness.play(strategy.wiring, hazard.steps)
  const outcome = classify(observation, hazard)

  return {
    hazard: hazard.key,
    strategy: strategy.key,
    outcome,
    handled: handled(outcome, hazard),
  }
}

export interface Matrix {
  readonly cells: readonly Cell[]
  /** `hazard/strategy` → outcome. */
  readonly byPair: ReadonlyMap<string, Outcome>
  /** strategy → `handled/of`. */
  readonly scores: ReadonlyMap<string, { readonly handled: number; readonly of: number }>
}

export function derive(
  strategies: readonly Strategy[] = STRATEGIES,
  hazards: readonly Hazard[] = HAZARDS,
): Matrix {
  const cells: Cell[] = []
  const byPair = new Map<string, Outcome>()
  const scores = new Map<string, { handled: number; of: number }>()

  for (const strategy of strategies) {
    const outcomes = new Map<string, Outcome>()

    for (const hazard of hazards) {
      const cell = run(strategy, hazard)

      cells.push(cell)
      byPair.set(`${hazard.key}/${strategy.key}`, cell.outcome)
      outcomes.set(hazard.key, cell.outcome)
    }

    scores.set(strategy.key, score(outcomes, hazards))
  }

  return { cells, byPair, scores }
}

/** The outcome for one pair, or a loud failure if the pair was never run. */
export function outcomeFor(matrix: Matrix, hazard: string, strategy: string): Outcome {
  const outcome = matrix.byPair.get(`${hazard}/${strategy}`)

  if (outcome === undefined) throw new Error(`matrix has no cell for ${hazard}/${strategy}`)

  return outcome
}

/** A strategy's score, rendered the way the README states it. */
export function scoreText(matrix: Matrix, strategy: string): string {
  const result = matrix.scores.get(strategy)

  if (result === undefined) throw new Error(`matrix has no score for ${strategy}`)

  return `${String(result.handled)}/${String(result.of)}`
}
