/**
 * `README.md`, read as data.
 *
 * Same direction as `containers/readme.ts`, and for the same reason: the tables
 * in the README are the claim, and the live run is checked against them. A
 * README generated from the code cannot be wrong and cannot say anything
 * either — it reports whatever the code does today. A README the code is
 * checked against is a statement somebody made, and the suite fails when it
 * stops being true.
 *
 * Two readers. `readme.test.ts` runs in `pnpm test` and checks the tables are
 * well formed and complete — every strategy, every fault, every behaviour,
 * every probe, no cell left blank — on a machine with no container runtime.
 * The three `*.container.test.ts` suites compare the cells to what a real
 * Postgres did.
 *
 * The grids are found by their header row rather than by the heading above
 * them: each starts with a different word in its first column and continues
 * with the strategy keys, which nothing else in the document repeats. Keying on
 * section titles would make the parse break whenever somebody rewords one,
 * which is the kind of gate people delete rather than fix.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const README_PATH = fileURLToPath(new URL('./README.md', import.meta.url))

export const readmeText = (): string => readFileSync(README_PATH, 'utf8')

/** Every markdown table row in the README, split into trimmed cells. */
export function tableRows(markdown: string = readmeText()): readonly (readonly string[])[] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('| '))
    .map((line) =>
      line
        .slice(1, line.endsWith('|') ? -1 : undefined)
        .split('|')
        .map((cell) => cell.trim()),
    )
}

/** Strip the markdown a cell is dressed in, leaving the identifier. */
export const bare = (cell: string): string => cell.replaceAll('`', '').replaceAll('*', '').trim()

/** One grid: rows down the side, strategies across the top. */
export interface Grid {
  /** Row labels, in the order the README lists them. */
  readonly rows: readonly string[]
  /** Column keys, in the order the README lists them. */
  readonly columns: readonly string[]
  /** `row/column` → the word in that cell. */
  readonly cells: ReadonlyMap<string, string>
}

export const gridKey = (row: string, column: string): string => `${row}/${column}`

/**
 * Find and parse the grid whose header starts with `firstCell` and continues
 * with exactly `columns`.
 *
 * `vocabulary` is the closed set of words a cell may hold. Closing it is what
 * turns a typo into a failure naming the cell rather than into a row that
 * silently compares unequal to everything.
 */
export function expectedGrid(
  firstCell: string,
  columns: readonly string[],
  vocabulary: readonly string[],
  markdown: string = readmeText(),
): Grid {
  const rows = tableRows(markdown)
  const headerIndex = rows.findIndex((cells) => {
    if (bare(cells[0] ?? '') !== firstCell) {
      return false
    }

    const found = cells.slice(1).map(bare)

    return found.length === columns.length && found.every((column, index) => column === columns[index])
  })

  if (headerIndex === -1) {
    throw new Error(
      `README has no ${firstCell} grid: expected a header row of | ${firstCell} | ${columns.join(' | ')} |`,
    )
  }

  const cells = new Map<string, string>()
  const labels: string[] = []

  // The row after the header is markdown's `| --- |` separator; the body runs
  // until a row that is not a full-width data row.
  //
  // `tableRows` drops every line that is not a table row, blank lines included,
  // so the row after a table's last is the *next* table's header. This document
  // has three grids over the same strategies one after another, so a body that
  // stopped only at a blank label would swallow all three and report the second
  // grid's header as a row called `Behaviour`. The terminator is therefore any
  // row whose cells after the first are exactly the column keys — a header,
  // whatever it is called — rather than this grid's own header by name.
  const isHeaderRow = (row: readonly string[]): boolean =>
    row.length === columns.length + 1 && row.slice(1).every((cell, index) => bare(cell) === columns[index])

  for (const row of rows.slice(headerIndex + 2)) {
    const label = bare(row[0] ?? '')

    if (label === '' || label.startsWith('---') || row.length !== columns.length + 1 || isHeaderRow(row)) {
      break
    }

    labels.push(label)

    for (const [index, column] of columns.entries()) {
      const word = bare(row[index + 1] ?? '')

      if (!vocabulary.includes(word)) {
        throw new Error(
          `${firstCell} grid, ${label}/${column} in README.md reads ${JSON.stringify(word)}; ` +
            `expected one of ${vocabulary.join(', ')}`,
        )
      }

      cells.set(gridKey(label, column), word)
    }
  }

  if (labels.length === 0) {
    throw new Error(`README's ${firstCell} grid has a header and no rows`)
  }

  return { rows: labels, columns: [...columns], cells }
}

/** The word the README claims for one cell. */
export function expectedCell(grid: Grid, row: string, column: string): string {
  const word = grid.cells.get(gridKey(row, column))

  if (word === undefined) {
    throw new Error(`README grid has no cell for ${row}/${column}`)
  }

  return word
}

// ---------------------------------------------------------------------------
// The three grids and the orderings table
// ---------------------------------------------------------------------------

export const DETECTION_HEADER = 'Fault'
export const DETECTION_WORDS = ['caught', 'missed'] as const

export const USABILITY_HEADER = 'Behaviour'
export const USABILITY_WORDS = ['runs', 'unusable'] as const

export const LEAKAGE_HEADER = 'Probe'
export const LEAKAGE_WORDS = ['pass', 'fail'] as const

export const detectionGrid = (columns: readonly string[], markdown?: string): Grid =>
  expectedGrid(DETECTION_HEADER, columns, DETECTION_WORDS, markdown)

export const usabilityGrid = (columns: readonly string[], markdown?: string): Grid =>
  expectedGrid(USABILITY_HEADER, columns, USABILITY_WORDS, markdown)

export const leakageGrid = (columns: readonly string[], markdown?: string): Grid =>
  expectedGrid(LEAKAGE_HEADER, columns, LEAKAGE_WORDS, markdown)

/** One row of the cost-ordering table, as the README states it. */
export interface StatedOrdering {
  readonly cheaper: string
  readonly dearer: string
}

/**
 * The orderings the README claims, so `cost.ts`'s list and the document can be
 * checked against each other in both directions.
 *
 * Found by its header rather than its position, like the grids, and it is the
 * only three-column table in the document whose first two headers are `Cheaper`
 * and `Dearer` — the "what is being measured" table has three columns too and
 * does not collide.
 */
export function statedOrderings(markdown: string = readmeText()): readonly StatedOrdering[] {
  const rows = tableRows(markdown)
  const headerIndex = rows.findIndex(
    (cells) => bare(cells[0] ?? '') === 'Cheaper' && bare(cells[1] ?? '') === 'Dearer',
  )

  if (headerIndex === -1) {
    throw new Error('README has no cost-ordering table: expected a header row of | Cheaper | Dearer | Why |')
  }

  const orderings: StatedOrdering[] = []

  for (const row of rows.slice(headerIndex + 2)) {
    const cheaper = bare(row[0] ?? '')

    if (cheaper === '' || cheaper.startsWith('---') || row.length !== 3) {
      break
    }

    orderings.push({ cheaper, dearer: bare(row[1] ?? '') })
  }

  if (orderings.length === 0) {
    throw new Error("README's cost-ordering table has a header and no rows")
  }

  return orderings
}
