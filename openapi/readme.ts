/**
 * `README.md`, read as data.
 *
 * The matrix in the README is the *expected* result and the live run is checked
 * against it, not the other way round. A README generated from the code cannot
 * be wrong and cannot be informative either — it says whatever the code does
 * today, including whatever it does today by accident. A README the code is
 * checked against is a claim, and `matrix.test.ts` fails the moment the claim
 * stops being true.
 *
 * Two readers. `readme.test.ts` checks the tables are well formed and complete
 * — every wiring has a column, every drift has a row, every cell has a word,
 * every blurb in the source appears in the prose — and needs nothing but the
 * file. `matrix.test.ts` compares the cells to what six wirings actually said
 * about twelve real HTTP responses.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { OUTCOMES, type Outcome } from './matrix.ts'

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

const isOutcome = (word: string): word is Outcome => (OUTCOMES as readonly string[]).includes(word)

/** The detection matrix, as the README states it. */
export interface ExpectedMatrix {
  /** Wiring keys, in the order the README lists them as columns. */
  readonly strategies: readonly string[]
  /** Drift keys, in the order the README lists them as rows. */
  readonly drifts: readonly string[]
  /** `drift/strategy` → outcome. */
  readonly cells: ReadonlyMap<string, Outcome>
}

const MATRIX_HEADER = 'Drift'

/**
 * Find and parse the detection matrix.
 *
 * Identified by its header row rather than by the heading above it: the table
 * starts with `Drift` and its remaining columns are the wiring keys, which no
 * other table in the file shares. Keying on a section title would break the
 * parse every time somebody rewords a heading, and a gate that breaks on
 * rewording is a gate somebody deletes.
 */
export function expectedMatrix(
  strategyKeys: readonly string[],
  markdown: string = readmeText(),
): ExpectedMatrix {
  const rows = tableRows(markdown)
  const headerIndex = rows.findIndex((cells) => {
    if (bare(cells[0] ?? '') !== MATRIX_HEADER) return false

    const columns = cells.slice(1).map(bare)

    return columns.length === strategyKeys.length && columns.every((column, index) => column === strategyKeys[index])
  })

  if (headerIndex === -1) {
    throw new Error(
      `README has no detection matrix: expected a header row of | ${MATRIX_HEADER} | ${strategyKeys.join(' | ')} |`,
    )
  }

  const cells = new Map<string, Outcome>()
  const drifts: string[] = []

  // The row after the header is markdown's `| --- |` separator; the body runs
  // until a row that is not a full-width data row.
  for (const row of rows.slice(headerIndex + 2)) {
    const label = bare(row[0] ?? '')

    if (label === '' || label === MATRIX_HEADER || label.startsWith('---') || row.length !== strategyKeys.length + 1) {
      break
    }

    drifts.push(label)

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

  if (drifts.length === 0) throw new Error("README's detection matrix has a header and no rows")

  return { strategies: [...strategyKeys], drifts, cells }
}

/** The outcome the README claims for one pair. */
export function expectedOutcome(matrix: ExpectedMatrix, drift: string, strategy: string): Outcome {
  const outcome = matrix.cells.get(`${drift}/${strategy}`)

  if (outcome === undefined) throw new Error(`README's matrix has no cell for ${drift}/${strategy}`)

  return outcome
}

/** One drift's row, in the column order the README lists. */
export function expectedRow(matrix: ExpectedMatrix, drift: string): readonly Outcome[] {
  return matrix.strategies.map((strategy) => expectedOutcome(matrix, drift, strategy))
}

/** The score the README claims for each wiring, as `caught/of`. */
export function expectedScores(markdown: string = readmeText()): ReadonlyMap<string, string> {
  const scores = new Map<string, string>()
  const rows = tableRows(markdown)
  const headerIndex = rows.findIndex(
    (cells) => bare(cells[0] ?? '') === 'Wiring' && bare(cells[1] ?? '') === 'Caught',
  )

  if (headerIndex === -1) throw new Error('README has no score table: expected a header row of | Wiring | Caught |')

  for (const row of rows.slice(headerIndex + 2)) {
    const label = bare(row[0] ?? '')

    if (label === '' || label.startsWith('---') || row.length !== 2) break

    scores.set(label, bare(row[1] ?? ''))
  }

  return scores
}
