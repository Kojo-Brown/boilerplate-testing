/**
 * Reads the matrix and the totals back out of `pact/README.md`.
 *
 * Same job as `containers/readme.ts`: a README that states measurements is a
 * README that goes stale, silently, the first time somebody adds a scenario or
 * changes a matcher. So the numbers are parsed out and compared with the ones
 * the run produced, in both directions — a row in the table with no cell in the
 * matrix is as much a failure as a cell with no row.
 *
 * The tables are delimited by HTML comments rather than found by heading, so
 * prose can be rewritten freely without breaking the parser, and a table that
 * loses its markers fails loudly instead of parsing as empty.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Cell, StrategyId } from './strategies'

const README = join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md')

/** One row of the matrix table, as written down. */
export interface ReadmeRow {
  readonly scenario: string
  readonly truth: string
  /** Keyed by strategy id, valued `verdict/stage`. */
  readonly cells: Readonly<Record<string, string>>
}

/** One row of the totals table, as written down. */
export interface ReadmeTotals {
  readonly strategy: string
  readonly caught: number
  readonly missed: number
  readonly falseAlarms: number
}

function section(marker: string, source: string): string {
  const open = `<!-- ${marker} -->`
  const close = `<!-- /${marker} -->`
  const from = source.indexOf(open)
  const to = source.indexOf(close)
  if (from === -1 || to === -1) {
    throw new Error(`pact/README.md has no <!-- ${marker} --> … <!-- /${marker} --> block`)
  }
  return source.slice(from + open.length, to)
}

/** Splits a markdown table row into trimmed cells. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** Table body rows: everything but the header and the `---` separator. */
function bodyRows(block: string): string[][] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map(cells)
}

/** The matrix as the README states it. */
export function readmeMatrix(source: string = readFileSync(README, 'utf8')): ReadmeRow[] {
  const block = section('MATRIX', source)
  const header = cells(
    block.split('\n').find((line) => line.trim().startsWith('|')) ?? '',
  )
  // Columns 0 and 1 are the scenario and its ground truth; the rest are
  // strategies, read from the header rather than assumed, so adding a wiring
  // is one edit here and one in `strategies.ts`.
  const strategies = header.slice(2)

  return bodyRows(block).map((row) => {
    const table: Record<string, string> = {}
    strategies.forEach((strategy, index) => {
      table[strategy] = row[index + 2] ?? ''
    })
    return {
      scenario: (row[0] ?? '').replace(/`/g, ''),
      truth: row[1] ?? '',
      cells: table,
    }
  })
}

/** The totals as the README states them. */
export function readmeTotals(source: string = readFileSync(README, 'utf8')): ReadmeTotals[] {
  return bodyRows(section('TOTALS', source)).map((row) => ({
    strategy: row[0] ?? '',
    caught: Number(row[1]),
    missed: Number(row[2]),
    falseAlarms: Number(row[3]),
  }))
}

/** How a cell is written in the README. The single source of that format. */
export function formatCell(cell: Cell): string {
  return `${cell.verdict}/${cell.stage}`
}

/** The strategy ids the README's matrix header names, in order. */
export function readmeStrategies(source: string = readFileSync(README, 'utf8')): StrategyId[] {
  const block = section('MATRIX', source)
  const header = cells(block.split('\n').find((line) => line.trim().startsWith('|')) ?? '')
  return header.slice(2) as StrategyId[]
}
