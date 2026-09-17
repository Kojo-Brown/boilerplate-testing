// @vitest-environment node
/**
 * `README.md`, checked against the code that produced it — without running the
 * matrix.
 *
 * The half of the README that needs a run is the matrix itself, and
 * `matrix.test.ts` does that. This file checks the half that does not: that
 * the tables name every wiring and every hazard the code defines, in the same
 * order, with nothing blank and no row for something that no longer exists.
 *
 * That is worth its own file because it is the failure the matrix cannot
 * catch. A README that has fallen one wiring behind still parses and still
 * matches every cell it does mention — it is simply missing a column,
 * silently.
 */

import { describe, expect, it } from 'vitest'

import { HAZARDS, hazardKeys } from './hazards.ts'
import { bare, describedBy, expectedMatrix, expectedScores, readmeText, tableRows } from './readme.ts'
import { OUTCOMES } from './scoring.ts'
import { STRATEGIES, strategyKeys } from './strategies.ts'

const STRATEGY_KEYS = strategyKeys()
const markdown = readmeText()

describe('the outcome matrix', () => {
  it('has a column for every wiring, in the order the code declares them', () => {
    expect(expectedMatrix(STRATEGY_KEYS).strategies).toEqual(STRATEGY_KEYS)
  })

  it('has a row for every hazard, in the order the code declares them', () => {
    expect(expectedMatrix(STRATEGY_KEYS).hazards).toEqual(hazardKeys())
  })

  it('fills every cell with a word from the vocabulary', () => {
    const matrix = expectedMatrix(STRATEGY_KEYS)

    for (const hazard of matrix.hazards) {
      for (const strategy of matrix.strategies) {
        expect(OUTCOMES).toContain(matrix.cells.get(`${hazard}/${strategy}`))
      }
    }
  })

  it('refuses a matrix whose columns do not match the code', () => {
    expect(() => expectedMatrix([...STRATEGY_KEYS, 'invented'])).toThrow('no outcome matrix')
  })

  /**
   * The hazard description table also opens with `Hazard`, so this is the
   * check that the matrix parser is keyed on the full column list rather than
   * on the first cell.
   */
  it('is not confused with the two-column hazard table above it', () => {
    expect(expectedMatrix(STRATEGY_KEYS).cells.size).toBe(HAZARDS.length * STRATEGY_KEYS.length)
  })

  it('refuses a cell that is not an outcome', () => {
    const broken = markdown.replace('| `merged` | `leaked` |', '| `merged` | `probably` |')

    expect(() => expectedMatrix(STRATEGY_KEYS, broken)).toThrow('expected one of')
  })
})

describe('the score table', () => {
  it('names every wiring and nothing else', () => {
    expect([...expectedScores().keys()]).toEqual(STRATEGY_KEYS)
  })

  it('states every score as handled-out-of-twelve', () => {
    for (const score of expectedScores().values()) {
      expect(score).toMatch(new RegExp(`^\\d+/${String(HAZARDS.length)}$`))
    }
  })

  it('refuses a document with no score table', () => {
    expect(() =>
      expectedScores(markdown.replace('| Strategy | Handled |', '| Strategy | Score |')),
    ).toThrow('no score table')
  })
})

describe('the description tables', () => {
  it('describes every wiring, in the order the code declares them', () => {
    expect([...describedBy(['Strategy', 'What it does']).keys()]).toEqual(STRATEGY_KEYS)
  })

  it('prints every wiring blurb exactly as the code states it', () => {
    const described = describedBy(['Strategy', 'What it does'])

    for (const strategy of STRATEGIES) {
      expect(described.get(strategy.key), strategy.key).toBe(strategy.blurb)
    }
  })

  it('describes every hazard, in the order the code declares them', () => {
    expect([...describedBy(['Hazard', 'What happens']).keys()]).toEqual(hazardKeys())
  })

  it('prints every hazard blurb exactly as the code states it', () => {
    const described = describedBy(['Hazard', 'What happens'])

    for (const hazard of HAZARDS) {
      expect(described.get(hazard.key), hazard.key).toBe(hazard.blurb)
    }
  })

  it('defines every word in the outcome vocabulary, in the order the code declares them', () => {
    expect([...describedBy(['Outcome', 'Meaning']).keys()]).toEqual([...OUTCOMES])
  })

  it('refuses to find a table that is not there', () => {
    expect(() => describedBy(['Strategy', 'Invented'])).toThrow('no | Strategy | Invented | table')
  })
})

describe('the prose', () => {
  it('names every file in the directory table', () => {
    const files = new Set(
      tableRows(markdown)
        .filter((row) => row.length === 2)
        .map((row) => bare(row[0] ?? '')),
    )

    for (const file of [
      'cloud.ts',
      'deployer.ts',
      'seeds.ts',
      'clock.ts',
      'strategies.ts',
      'hazards.ts',
      'harness.ts',
      'scoring.ts',
      'matrix.ts',
      'readme.ts',
      'workflows.ts',
    ]) {
      expect(files).toContain(file)
    }
  })

  /**
   * The headline number, which is the first thing anybody reads and the
   * easiest thing to leave behind when the corpus changes.
   */
  it('states the hazard count the corpus actually has', () => {
    expect(markdown).toContain(`of ${String(HAZARDS.length)} hazards handled`)
  })

  it('states the cell count the matrix actually has', () => {
    expect(markdown).toContain(`all ${String(HAZARDS.length * STRATEGIES.length)} cells`)
  })
})
