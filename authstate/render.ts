/**
 * The README's tables, rendered from the measurements.
 *
 * `readme.test.ts` does not *check* the published tables against `capture.ts`
 * and `isolation.ts`; it renders them from those files and compares the text.
 * There is no version of the README that agrees with a wrong cell, a reordered
 * row, or a column somebody added and did not document. The two are the same
 * string or the build is red — the arrangement `intercept/` introduced and the
 * one thing in this directory that makes documentation stay true without
 * anybody remembering to update it.
 */

import { EXPECTED_CAPTURE, type CaptureRow } from './capture.ts'
import { EXPECTED_ISOLATION, HAZARDS, hazardsCleared, type IsolationRow } from './isolation.ts'
import { PROBES } from './probes.ts'
import { STRATEGY_KEYS } from './strategies.ts'
import { WIRING_KEYS } from './wirings.ts'

/** A Markdown table whose columns are padded to their widest cell. */
export function renderGrid(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' | ')} |`

  return [
    line(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n')
}

/** The capture table: four wirings down, seven probes across. */
export function renderCapture(
  table: Readonly<Record<string, CaptureRow>> = EXPECTED_CAPTURE,
): string {
  return renderGrid(
    ['wiring', ...PROBES.map((probe) => probe.key)],
    WIRING_KEYS.map((wiring) => [
      `\`${wiring}\``,
      ...PROBES.map((probe) => table[wiring]?.[probe.key] ?? '?'),
    ]),
  )
}

/** The isolation table: five strategies down, three hazards and two costs across. */
export function renderIsolation(
  table: Readonly<Record<string, IsolationRow>> = EXPECTED_ISOLATION,
): string {
  return renderGrid(
    ['strategy', ...HAZARDS, 'cleared', 'logins', 'accounts'],
    STRATEGY_KEYS.map((strategy) => [
      `\`${strategy}\``,
      ...HAZARDS.map((hazard) => table[strategy]?.[hazard] ?? '?'),
      `${hazardsCleared(strategy, table)}/${HAZARDS.length}`,
      String(table[strategy]?.logins ?? '?'),
      String(table[strategy]?.accounts ?? '?'),
    ]),
  )
}
