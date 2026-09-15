/**
 * `README.md`, read as data.
 *
 * The direction matters and it is the same one `openapi/readme.ts` argues for:
 * the README states the *expected* matrix and the live run is checked against
 * it, never the other way round. A README generated from the code cannot be
 * wrong, and cannot be informative either — it says whatever the code does
 * today, including whatever it does today by accident. A README the code is
 * checked against is a claim, and `matrix.test.ts` fails the moment the claim
 * stops being true.
 *
 * Two readers use this. `readme.test.ts` checks the document is well formed and
 * complete — every strategy has a column, every hazard has a row, every cell is
 * a word from the vocabulary, every blurb in the source appears in the prose —
 * and needs nothing but the file. `matrix.test.ts` compares those cells to what
 * eight handlers actually did under eleven hazards.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { OUTCOMES, type Outcome } from './scoring.ts'

export const README_PATH = fileURLToPath(new URL('./README.md', import.meta.url))

export const readmeText = (): string => readFileSync(README_PATH, 'utf8')

const splitRow = (line: string): readonly string[] =>
  line
    .slice(1, line.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((cell) => cell.trim())

/**
 * The README's tables, each as its own group of rows.
 *
 * Grouped rather than flattened, and that is not tidiness. A flat list of every
 * `| ` line in the document loses the blank line between two tables, so a
 * parser that reads "rows until one that is not a full-width data row" walks
 * straight out of the score table and into the file table below it — both are
 * two columns wide. The first version of this file did exactly that and read
 * `What it is` as a score.
 */
export function tables(markdown: string = readmeText()): readonly (readonly (readonly string[])[])[] {
  const grouped: (readonly string[])[][] = []
  let current: (readonly string[])[] | null = null

  for (const line of markdown.split('\n')) {
    if (line.startsWith('| ')) {
      current ??= []
      current.push(splitRow(line))
      continue
    }

    if (current !== null) {
      grouped.push(current)
      current = null
    }
  }

  if (current !== null) grouped.push(current)

  return grouped
}

/** Every markdown table row in the README, split into trimmed cells. */
export const tableRows = (markdown: string = readmeText()): readonly (readonly string[])[] =>
  tables(markdown).flat()

/** Strip the markdown a cell is dressed in, leaving the identifier. */
export const bare = (cell: string): string => cell.replaceAll('`', '').replaceAll('*', '').trim()

const isOutcome = (word: string): word is Outcome => (OUTCOMES as readonly string[]).includes(word)

export interface ExpectedMatrix {
  /** Strategy keys, in the order the README lists them as columns. */
  readonly strategies: readonly string[]
  /** Hazard keys, in the order the README lists them as rows. */
  readonly hazards: readonly string[]
  /** `hazard/strategy` → outcome. */
  readonly cells: ReadonlyMap<string, Outcome>
}

const MATRIX_HEADER = 'Hazard'

/**
 * Find and parse the outcome matrix.
 *
 * Identified by its header row rather than by the heading above it: the table
 * starts with `Hazard` and its remaining columns are the strategy keys in
 * order, which no other table in the file matches. Keying on a section title
 * would break the parse every time somebody rewords a heading, and a gate that
 * breaks on rewording is a gate somebody deletes.
 */
export function expectedMatrix(
  strategyKeys: readonly string[],
  markdown: string = readmeText(),
): ExpectedMatrix {
  const table = tables(markdown).find((rows) => {
    const cells = rows[0] ?? []

    if (bare(cells[0] ?? '') !== MATRIX_HEADER) return false

    const columns = cells.slice(1).map(bare)

    return (
      columns.length === strategyKeys.length &&
      columns.every((column, index) => column === strategyKeys[index])
    )
  })

  if (table === undefined) {
    throw new Error(
      `README has no outcome matrix: expected a header row of | ${MATRIX_HEADER} | ${strategyKeys.join(' | ')} |`,
    )
  }

  const cells = new Map<string, Outcome>()
  const hazards: string[] = []

  // The row after the header is markdown's `| --- |` separator.
  for (const row of table.slice(2)) {
    const label = bare(row[0] ?? '')

    if (label === '' || label.startsWith('---') || row.length !== strategyKeys.length + 1) break

    hazards.push(label)

    for (const [index, strategy] of strategyKeys.entries()) {
      const word = bare(row[index + 1] ?? '')

      if (!isOutcome(word)) {
        throw new Error(
          `${label}/${strategy} in README.md reads ${JSON.stringify(word)}; expected one of ${OUTCOMES.join(', ')}`,
        )
      }

      cells.set(`${label}/${strategy}`, word)
    }
  }

  if (hazards.length === 0) throw new Error("README's outcome matrix has a header and no rows")

  return { strategies: [...strategyKeys], hazards, cells }
}

/** The outcome the README claims for one pair. */
export function expectedOutcome(matrix: ExpectedMatrix, hazard: string, strategy: string): Outcome {
  const outcome = matrix.cells.get(`${hazard}/${strategy}`)

  if (outcome === undefined) throw new Error(`README's matrix has no cell for ${hazard}/${strategy}`)

  return outcome
}

/** One hazard's row, in the column order the README lists. */
export const expectedRow = (matrix: ExpectedMatrix, hazard: string): readonly Outcome[] =>
  matrix.strategies.map((strategy) => expectedOutcome(matrix, hazard, strategy))

/** The score the README claims for each strategy, as `handled/of`. */
export function expectedScores(markdown: string = readmeText()): ReadonlyMap<string, string> {
  const scores = new Map<string, string>()
  const table = tables(markdown).find(
    (rows) => bare(rows[0]?.[0] ?? '') === 'Strategy' && bare(rows[0]?.[1] ?? '') === 'Handled',
  )

  if (table === undefined) {
    throw new Error('README has no score table: expected a header row of | Strategy | Handled |')
  }

  for (const row of table.slice(2)) {
    const label = bare(row[0] ?? '')

    if (label === '' || label.startsWith('---') || row.length !== 2) break

    scores.set(label, bare(row[1] ?? ''))
  }

  return scores
}
