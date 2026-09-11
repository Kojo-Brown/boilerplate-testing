// @vitest-environment node
/**
 * `README.md`, checked against the code that produced it — without sending a
 * request.
 *
 * The half of the README that needs a running service is the matrix itself, and
 * `matrix.test.ts` does that. This file checks the half that does not: that the
 * tables name every wiring and every drift the code defines, in the same order,
 * with no cell left blank and no row for something that no longer exists.
 *
 * That is worth its own file because it is the failure the matrix cannot catch.
 * A README that has fallen a wiring behind still parses, still matches every
 * cell it does mention, and quietly stops covering the column somebody added
 * last week.
 */

import { describe, expect, it } from 'vitest'

import { DRIFTS } from './drifts.ts'
import { OUTCOMES } from './matrix.ts'
import { bare, expectedMatrix, expectedScores, readmeText, tableRows } from './readme.ts'
import { STRATEGIES } from './strategies.ts'

const readme = readmeText()
const KEYS = STRATEGIES.map((strategy) => strategy.key)

describe('the detection matrix', () => {
  const claimed = expectedMatrix(KEYS, readme)

  it('has a column for every wiring the code defines, in order', () => {
    expect(claimed.strategies).toEqual(KEYS)
  })

  it('has a row for every drift the corpus defines, in order', () => {
    expect(claimed.drifts).toEqual(DRIFTS.map((drift) => drift.key))
  })

  it('fills every cell with an outcome word', () => {
    expect(claimed.cells.size).toBe(claimed.drifts.length * claimed.strategies.length)

    for (const outcome of claimed.cells.values()) expect(OUTCOMES).toContain(outcome)
  })

  it('reserves `quiet` and `alarm` for the control row', () => {
    for (const [key, outcome] of claimed.cells) {
      const isControl = key.startsWith('none/')

      expect(['quiet', 'alarm'].includes(outcome), `${key} reads ${outcome}`).toBe(isControl)
    }
  })
})

describe('the score table', () => {
  const scores = expectedScores(readme)

  it('has a row for every wiring', () => {
    expect([...scores.keys()]).toEqual(KEYS)
  })

  it('scores every wiring out of the number of drifts that are not the control', () => {
    const drifts = DRIFTS.length - 1

    for (const [strategy, score] of scores) {
      expect(score, `${strategy} is not scored out of ${drifts}`).toMatch(new RegExp(`^\\d+/${drifts}$`))
    }
  })

  it('agrees with the matrix about how many rows each wiring caught', () => {
    const claimed = expectedMatrix(KEYS, readme)

    for (const strategy of KEYS) {
      const caught = claimed.drifts.filter(
        (drift) => drift !== 'none' && claimed.cells.get(`${drift}/${strategy}`) === 'catch',
      ).length

      expect(scores.get(strategy), `the ${strategy} score disagrees with its column`).toBe(
        `${caught}/${DRIFTS.length - 1}`,
      )
    }
  })
})

describe('the prose', () => {
  it('says what each wiring looks at, in the wiring’s own words', () => {
    for (const strategy of STRATEGIES) {
      expect(readme, `no summary row for ${strategy.key}`).toContain(`| \`${strategy.key}\` | ${strategy.blurb} |`)
    }
  })

  it('says where each drift comes from, in the drift’s own words', () => {
    for (const drift of DRIFTS) {
      expect(readme, `no corpus row for ${drift.key}`).toContain(`| \`${drift.key}\` | ${drift.blurb} |`)
    }
  })

  it('names the operation the corpus never calls', () => {
    expect(readme).toContain('DELETE /orders/{orderId}')
  })

  it('explains all four outcome words', () => {
    for (const outcome of OUTCOMES) expect(readme, `${outcome} is unexplained`).toContain(`\`${outcome}\``)
  })
})

describe('the parser', () => {
  it('rejects a cell that is not an outcome word', () => {
    const broken = readme.replace('| `extra-field` | miss |', '| `extra-field` | maybe |')

    expect(() => expectedMatrix(KEYS, broken)).toThrow(/reads "maybe"/)
  })

  it('rejects a README whose columns are not the wirings', () => {
    expect(() => expectedMatrix(['made-up-wiring'], readme)).toThrow(/no detection matrix/)
  })

  it('rejects a README with no score table', () => {
    expect(() => expectedScores(readme.replace('| Wiring | Caught |', '| Wiring | Score |'))).toThrow(/no score table/)
  })

  it('stops at the end of the table rather than reading the next one', () => {
    expect(expectedMatrix(KEYS, readme).drifts).not.toContain('Wiring')
  })

  it('reads a row whose cells are dressed in markdown', () => {
    const emphasised = readme.replace('| `empty-collection` | miss |', '| `empty-collection` | *miss* |')

    expect(expectedMatrix(KEYS, emphasised).cells.get('empty-collection/status-only')).toBe('miss')
  })
})

describe('the tables it does not parse', () => {
  it('leaves the two-column summaries out of the matrix', () => {
    // Both summary tables have a first column headed `Wiring` or `Drift`, and
    // the matrix parser keys on the header's *full width*. If that ever stops
    // being true the parser starts reading blurbs as outcome words.
    const widths = new Set(tableRows(readme).map((row) => row.length))

    expect(widths).toContain(2)
    expect(widths).toContain(KEYS.length + 1)
  })

  it('strips the markdown a cell is dressed in', () => {
    expect(bare('  `body-schema`  ')).toBe('body-schema')
  })
})
