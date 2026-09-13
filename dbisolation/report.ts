/**
 * Rendering what was measured, in the dialect `readme.ts` parses.
 *
 * Printed into the log by every container suite, for the reason
 * `containers/report.ts` gives: when a cell disagrees with the README the
 * failure names that cell, and the next question is always what the whole table
 * looks like now. Answering that from a list of individual assertion failures
 * is an exercise in reassembly. Emitting the table is one function, and because
 * it is the same markdown the README holds, a genuine change in behaviour can
 * be pasted from the log into the document rather than retyped.
 */

import type { Cost } from './cost.ts'
import type { Cell } from './leakage.ts'
import { PROBES } from './leakage.ts'
import { BEHAVIOURS } from './behaviours.ts'
import { FAULTS } from './faults.ts'
import type { StrategyReport } from './matrix.ts'
import { STRATEGY_KEYS } from './strategies.ts'

const table = (firstCell: string, columns: readonly string[], body: readonly (readonly string[])[]): string =>
  [
    `| ${firstCell} | ${columns.map((column) => `\`${column}\``).join(' | ')} |`,
    `| ${['---', ...columns.map(() => '---')].join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')

/** The detection grid. */
export function renderDetection(reports: readonly StrategyReport[]): string {
  return table(
    'Fault',
    STRATEGY_KEYS,
    FAULTS.map((fault) => [
      `\`${fault}\``,
      ...STRATEGY_KEYS.map((key) => reports.find((report) => report.strategy === key)?.detection.get(fault) ?? '?'),
    ]),
  )
}

/** The usability grid: which behaviours are red on the correct subject. */
export function renderUsability(reports: readonly StrategyReport[]): string {
  return table(
    'Behaviour',
    STRATEGY_KEYS,
    BEHAVIOURS.map((behaviour) => [
      `\`${behaviour.key}\``,
      ...STRATEGY_KEYS.map((key) =>
        reports.find((report) => report.strategy === key)?.falseAlarms.includes(behaviour.key) ? 'unusable' : 'runs',
      ),
    ]),
  )
}

/** The leakage grid: what the second run did. */
export function renderLeakage(cells: readonly Cell[]): string {
  return table(
    'Probe',
    STRATEGY_KEYS,
    PROBES.map((probe) => [
      `\`${probe.key}\``,
      ...STRATEGY_KEYS.map(
        (key) => cells.find((cell) => cell.strategy === key && cell.probe === probe.key)?.secondRun ?? '?',
      ),
    ]),
  )
}

/** The cost table, in the README's three columns. */
export function renderCosts(costs: readonly Cost[]): string {
  return [
    '| Strategy | Median | Range |',
    '| --- | --- | --- |',
    ...costs.map(
      (cost) =>
        `| \`${cost.strategy}\` | ${cost.medianMs.toFixed(1)}ms | ${cost.minMs.toFixed(1)} – ${cost.maxMs.toFixed(1)} |`,
    ),
  ].join('\n')
}
