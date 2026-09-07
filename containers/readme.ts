/**
 * `README.md`, read as data.
 *
 * The matrix in the README is not a transcript of a run somebody once did: it
 * is the expected result, and the live run is checked against it. That
 * direction matters. A README generated from the code cannot be wrong and
 * cannot be informative either — it says whatever the code does today. A README
 * the code is checked *against* is a claim, and `residue.container.test.ts`
 * fails when the claim stops being true.
 *
 * Two readers use this module. `readme.test.ts` runs in `pnpm test` and checks
 * the tables are well formed and complete — every strategy, every behaviour,
 * no cell left blank — without needing a container. `residue.container.test.ts`
 * needs a container, and compares the cells to what actually happened.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { StoreName } from './images.ts'
import type { Outcome } from './matrix.ts'

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

/**
 * How an outcome is spelled in the README.
 *
 * `hang` rather than `timed-out` because that is what it does, and because a
 * column of `fail`/`fail`/`hang` reads as three different things happening,
 * which is the finding.
 */
export const OUTCOME_WORDS: Readonly<Record<string, Outcome>> = {
  pass: 'passed',
  fail: 'failed',
  hang: 'timed-out',
}

export const wordFor = (outcome: Outcome): string => {
  const word = Object.entries(OUTCOME_WORDS).find(([, value]) => value === outcome)?.[0]

  if (word === undefined) {
    throw new Error(`No README word for outcome ${outcome}`)
  }

  return word
}

/** One store's matrix, as the README states it. */
export interface ExpectedMatrix {
  readonly store: StoreName
  /** Strategy keys, in the order the README lists them. */
  readonly strategies: readonly string[]
  /** Behaviour keys, in the order the README lists them. */
  readonly behaviours: readonly string[]
  /** `strategy/behaviour` → outcome. */
  readonly cells: ReadonlyMap<string, Outcome>
}

const HEADER_FIRST_CELL = 'Behaviour'

/**
 * Find and parse the matrix table for one store.
 *
 * Tables are identified by their header rather than by the heading above them:
 * a matrix table starts with `Behaviour` and its remaining columns are that
 * store's strategy keys, which no other store shares. Keying on the heading
 * would make the parse break every time somebody rewords a section title,
 * which is the kind of gate people delete.
 */
export function expectedMatrix(
  store: StoreName,
  strategyKeys: readonly string[],
  markdown: string = readmeText(),
): ExpectedMatrix {
  const rows = tableRows(markdown)
  const headerIndex = rows.findIndex((cells) => {
    if (bare(cells[0] ?? '') !== HEADER_FIRST_CELL) {
      return false
    }

    const columns = cells.slice(1).map(bare)

    return columns.length === strategyKeys.length && columns.every((column, index) => column === strategyKeys[index])
  })

  if (headerIndex === -1) {
    throw new Error(
      `README has no matrix table for ${store}: expected a header row of ` +
        `| ${HEADER_FIRST_CELL} | ${strategyKeys.join(' | ')} |`,
    )
  }

  const cells = new Map<string, Outcome>()
  const behaviours: string[] = []

  // The row after the header is markdown's `| --- |` separator; the body runs
  // until a row that is not a full-width data row.
  for (const row of rows.slice(headerIndex + 2)) {
    const label = bare(row[0] ?? '')

    // The body ends at the first row that is not one: a blank label, the
    // header of the next store's table, a separator, or a different width.
    if (
      label === '' ||
      label === HEADER_FIRST_CELL ||
      label.startsWith('---') ||
      row.length !== strategyKeys.length + 1
    ) {
      break
    }

    behaviours.push(label)

    for (const [index, strategy] of strategyKeys.entries()) {
      const word = bare(row[index + 1] ?? '')
      const outcome = OUTCOME_WORDS[word]

      if (outcome === undefined) {
        throw new Error(
          `${store}/${strategy}/${label} in README.md reads ${JSON.stringify(word)}; ` +
            `expected one of ${Object.keys(OUTCOME_WORDS).join(', ')}`,
        )
      }

      cells.set(`${strategy}/${label}`, outcome)
    }
  }

  if (behaviours.length === 0) {
    throw new Error(`README's ${store} matrix has a header and no rows`)
  }

  return { store, strategies: [...strategyKeys], behaviours, cells }
}

/** The outcome the README claims for one pair. */
export function expectedOutcome(matrix: ExpectedMatrix, strategy: string, behaviour: string): Outcome {
  const outcome = matrix.cells.get(`${strategy}/${behaviour}`)

  if (outcome === undefined) {
    throw new Error(`README's ${matrix.store} matrix has no cell for ${strategy}/${behaviour}`)
  }

  return outcome
}
