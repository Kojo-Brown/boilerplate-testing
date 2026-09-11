/**
 * Rendering what was measured, in the dialect `README.md` is written in.
 *
 * The suite prints its tables into the log for the reason `containers/report.ts`
 * does: when a cell disagrees with the README the failure names that cell, and
 * the next question is always what the whole table looks like now. The markdown
 * here is the markdown `readme.ts` parses, so a genuine change in behaviour is
 * pasted from the log into the README rather than retyped a column out of
 * alignment.
 */

import { coverageOf, percentage, type Coverage } from './coverage.ts'
import type { Exchange } from './exchange.ts'
import { CONTROL, scoreFor, type Matrix } from './matrix.ts'
import { STRATEGIES } from './strategies.ts'

/** The detection matrix as a markdown table. */
export function renderMatrix(matrix: Matrix): string {
  const drifts = [...new Set(matrix.cells.map((cell) => cell.drift))]
  const strategies = STRATEGIES.map((strategy) => strategy.key)
  const header = `| Drift | ${strategies.map((key) => `\`${key}\``).join(' | ')} |`
  const rule = `| --- | ${strategies.map(() => '---').join(' | ')} |`
  const body = drifts.map((drift) => {
    const cells = strategies.map((strategy) => {
      const cell = matrix.cells.find((candidate) => candidate.drift === drift && candidate.strategy === strategy)

      return cell?.outcome ?? '?'
    })

    return `| \`${drift}\` | ${cells.join(' | ')} |`
  })

  return [header, rule, ...body].join('\n')
}

/** How many drifts each wiring caught, as a markdown table. */
export function renderScores(matrix: Matrix): string {
  const header = '| Wiring | Caught |'
  const rule = '| --- | --- |'
  const body = STRATEGIES.map((strategy) => {
    const score = scoreFor(matrix, strategy.key)

    return `| \`${strategy.key}\` | ${score.caught}/${score.of} |`
  })

  return [header, rule, ...body].join('\n')
}

/** Coverage as the two lines worth reading. */
export function renderCoverage(coverage: Coverage): string {
  const operations = coverage.operations.length - coverage.untouchedOperations.length
  const responses = coverage.responses.length - coverage.unobservedResponses.length

  return [
    `operations: ${operations}/${coverage.operations.length} ` +
      `(${percentage(operations, coverage.operations.length)}%)` +
      (coverage.untouchedOperations.length === 0 ? '' : ` — untouched: ${coverage.untouchedOperations.join(', ')}`),
    `responses:  ${responses}/${coverage.responses.length} ` +
      `(${percentage(responses, coverage.responses.length)}%)` +
      (coverage.unobservedResponses.length === 0 ? '' : ` — unobserved: ${coverage.unobservedResponses.join(', ')}`),
  ].join('\n')
}

/** Everything, for a log that has to explain itself without the source next to it. */
export function renderReport(matrix: Matrix, exchanges: readonly Exchange[]): string {
  const control = matrix.cells.filter((cell) => cell.drift === CONTROL && cell.outcome === 'alarm')

  return [
    renderMatrix(matrix),
    '',
    renderScores(matrix),
    '',
    renderCoverage(coverageOf(exchanges)),
    ...(control.length === 0
      ? []
      : ['', `control row alarmed: ${control.map((cell) => `${cell.strategy} (${cell.detail})`).join('; ')}`]),
  ].join('\n')
}
