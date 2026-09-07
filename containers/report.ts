/**
 * Rendering what was measured, in the shape `README.md` states it.
 *
 * The container suites print their tables into the CI log for one reason: when
 * a cell disagrees with the README, the failure message says which cell, and
 * the next question is always "so what does the whole table look like now".
 * Answering that from a list of individual assertion failures is an exercise
 * in reassembly; printing the table is one line of code.
 *
 * The markdown is the same dialect `readme.ts` parses, so a genuine change in
 * behaviour can be pasted from the log into the README and re-checked, rather
 * than retyped.
 */

import type { StoreMatrix } from './matrix.ts'
import { wordFor } from './readme.ts'
import type { Startup } from './readiness.ts'

/** One store's matrix as a markdown table. */
export function renderMatrix(matrix: StoreMatrix): string {
  const strategies = [...new Set(matrix.cells.map((cell) => cell.strategy))]
  const behaviours = [...new Set(matrix.cells.map((cell) => cell.behaviour))]
  const header = `| Behaviour | ${strategies.map((strategy) => `\`${strategy}\``).join(' | ')} |`
  const rule = `| --- | ${strategies.map(() => '---').join(' | ')} |`
  const body = behaviours.map((behaviour) => {
    const cells = strategies.map((strategy) => {
      const cell = matrix.cells.find(
        (candidate) => candidate.strategy === strategy && candidate.behaviour === behaviour,
      )

      return cell === undefined ? '?' : wordFor(cell.secondSuite)
    })

    return `| \`${behaviour}\` | ${cells.join(' | ')} |`
  })

  return [`### ${matrix.store}`, '', header, rule, ...body].join('\n')
}

/** What each strategy's `beforeAll` cost, in the order the strategies ran. */
export function renderCosts(matrix: StoreMatrix): string {
  return matrix.costs
    .map((cost) => `${matrix.store}/${cost.strategy}: ${cost.perRunMs.map((ms) => `${ms}ms`).join(', ')}`)
    .join('\n')
}

/** A startup measurement as one line. */
export function renderStartup(startup: Startup): string {
  return (
    `${startup.store}${startup.reused ? ' (reused)' : ''}: start() ${startup.startMs}ms, ` +
    `usable +${startup.readiness.elapsedMs}ms after ${startup.readiness.attempts} probe(s), ` +
    `total ${startup.totalMs}ms`
  )
}
