// @vitest-environment node
/**
 * `README.md`, checked against the code that produced it — without running the
 * matrix.
 *
 * The half of the README that needs a run is the matrix itself, and
 * `matrix.test.ts` does that. This file checks the half that does not: that the
 * tables name every strategy and every hazard the code defines, in the same
 * order, with nothing blank and no row for something that no longer exists.
 *
 * That is worth its own file because it is the failure the matrix cannot catch.
 * A README that has fallen one strategy behind still parses and still matches
 * every cell it does mention — it is simply missing a column, silently, which
 * is the direction documentation always rots in.
 */

import { describe, expect, it } from 'vitest'

import { HAZARDS } from './hazards.ts'
import { bare, expectedMatrix, expectedScores, readmeText, tableRows } from './readme.ts'
import { OUTCOMES } from './scoring.ts'
import { STRATEGIES } from './strategies.ts'

const STRATEGY_KEYS = STRATEGIES.map((strategy) => strategy.key)
const markdown = readmeText()

describe('the outcome matrix', () => {
  it('has a column for every strategy, in the order the code declares them', () => {
    expect(expectedMatrix(STRATEGY_KEYS).strategies).toEqual(STRATEGY_KEYS)
  })

  it('has a row for every hazard, in the order the code declares them', () => {
    expect(expectedMatrix(STRATEGY_KEYS).hazards).toEqual(HAZARDS.map((hazard) => hazard.key))
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

  it('refuses a cell that is not an outcome', () => {
    const broken = markdown.replace('| `clean` | `safe` |', '| `clean` | `probably` |')

    expect(() => expectedMatrix(STRATEGY_KEYS, broken)).toThrow('expected one of')
  })
})

describe('the score table', () => {
  it('names every strategy and nothing else', () => {
    expect([...expectedScores().keys()]).toEqual(STRATEGY_KEYS)
  })

  it('states every score as handled-out-of-eleven', () => {
    for (const score of expectedScores().values()) {
      expect(score).toMatch(new RegExp(`^\\d+/${String(HAZARDS.length)}$`))
    }
  })

  it('refuses a document with no score table', () => {
    expect(() => expectedScores(markdown.replace('| Strategy | Handled |', '| Strategy | Score |'))).toThrow(
      'no score table',
    )
  })
})

describe('the prose', () => {
  /**
   * Each blurb lives in the source and is printed in the README, so the two can
   * disagree. They are checked rather than generated for the reason
   * `readme.ts` gives: a generated document cannot be wrong and cannot be
   * informative either.
   */
  it('prints every strategy blurb exactly as the code states it', () => {
    for (const strategy of STRATEGIES) {
      expect(markdown).toContain(strategy.blurb)
    }
  })

  it('names every outcome word in the outcome table', () => {
    const rows = tableRows(markdown)
    const described = new Set(
      rows.filter((row) => row.length === 2).map((row) => bare(row[0] ?? '')),
    )

    for (const outcome of OUTCOMES) {
      expect(described).toContain(outcome)
    }
  })

  it('names every file in the directory table', () => {
    const rows = tableRows(markdown)
    const files = new Set(rows.filter((row) => row.length === 2).map((row) => bare(row[0] ?? '')))

    for (const file of [
      'harness.ts',
      'store.ts',
      'service.ts',
      'gateway.ts',
      'hazards.ts',
      'strategies.ts',
      'scoring.ts',
      'matrix.ts',
      'server.ts',
      'clock.ts',
      'fixture.ts',
    ]) {
      expect(files).toContain(file)
    }
  })

  /**
   * The headline number. If somebody changes the corpus without re-reading the
   * opening paragraph, this is what says so — the claim "4 of 11" is the first
   * thing anybody reads and the easiest thing to leave behind.
   */
  it('states the hazard count the corpus actually has', () => {
    expect(markdown).toContain(`of ${String(HAZARDS.length)} hazards handled`)
  })
})
