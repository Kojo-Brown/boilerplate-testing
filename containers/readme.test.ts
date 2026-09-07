// @vitest-environment node
/**
 * `README.md`, checked against the code that produced it — without a container.
 *
 * The half of the README that needs a Docker daemon to verify is the matrix
 * itself, and `residue.container.test.ts` does that. This file checks the half
 * that does not: that the tables name every strategy and behaviour the code
 * defines, in the same order, with no cell left blank and no row for something
 * that no longer exists.
 *
 * That is worth its own file because it is the failure the container job cannot
 * catch cheaply. A README that has fallen a strategy behind still parses, still
 * matches every cell it does mention, and quietly stops covering the column
 * somebody added last week.
 */

import { describe, expect, it } from 'vitest'

import { STORE_NAMES } from './images.ts'
import { KAFKA_STRATEGIES, POSTGRES_STRATEGIES, REDIS_STRATEGIES } from './isolation.ts'
import { expectedMatrix, OUTCOME_WORDS, readmeText, tableRows, bare, wordFor } from './readme.ts'
import { KAFKA_BEHAVIOURS, POSTGRES_BEHAVIOURS, REDIS_BEHAVIOURS } from './workload.ts'

const readme = readmeText()

const PLANS = [
  { store: 'postgres' as const, strategies: POSTGRES_STRATEGIES, behaviours: POSTGRES_BEHAVIOURS },
  { store: 'redis' as const, strategies: REDIS_STRATEGIES, behaviours: REDIS_BEHAVIOURS },
  { store: 'kafka' as const, strategies: KAFKA_STRATEGIES, behaviours: KAFKA_BEHAVIOURS },
]

describe.each(PLANS)('the $store matrix', ({ store, strategies, behaviours }) => {
  const keys = strategies.map((strategy) => strategy.key)

  it('has a column for every strategy the code defines, in order', () => {
    expect(expectedMatrix(store, keys, readme).strategies).toEqual(keys)
  })

  it('has a row for every behaviour the code defines, in order', () => {
    expect(expectedMatrix(store, keys, readme).behaviours).toEqual(behaviours.map((behaviour) => behaviour.key))
  })

  it('fills every cell with an outcome word', () => {
    const matrix = expectedMatrix(store, keys, readme)

    for (const behaviour of matrix.behaviours) {
      for (const strategy of matrix.strategies) {
        expect(matrix.cells.get(`${strategy}/${behaviour}`)).toBeDefined()
      }
    }

    expect(matrix.cells.size).toBe(matrix.behaviours.length * matrix.strategies.length)
  })
})

describe('the prose', () => {
  it('describes every strategy in a summary table', () => {
    const described = tableRows(readme)
      .filter((row) => row.length === 2)
      .map((row) => bare(row[0] ?? ''))

    for (const strategy of [...POSTGRES_STRATEGIES, ...REDIS_STRATEGIES, ...KAFKA_STRATEGIES]) {
      expect(described, `no summary row for ${strategy.store}/${strategy.key}`).toContain(strategy.key)
    }
  })

  it('says what each behaviour trips on', () => {
    for (const behaviour of [...POSTGRES_BEHAVIOURS, ...REDIS_BEHAVIOURS, ...KAFKA_BEHAVIOURS]) {
      expect(readme, `no leftover row for ${behaviour.key}`).toContain(`| \`${behaviour.key}\` | ${behaviour.leftover} |`)
    }
  })

  it('names every store it claims to cover', () => {
    for (const store of STORE_NAMES) {
      expect(readme.toLowerCase()).toContain(store)
    }
  })

  it('spells outcomes the way the parser reads them', () => {
    expect(Object.keys(OUTCOME_WORDS).map((word) => wordFor(OUTCOME_WORDS[word] ?? 'passed'))).toEqual(
      Object.keys(OUTCOME_WORDS),
    )
  })
})

describe('the parser', () => {
  it('rejects a cell that is not an outcome word', () => {
    const broken = readme.replace('| `counts-rows` | fail |', '| `counts-rows` | maybe |')

    expect(() => expectedMatrix('postgres', POSTGRES_STRATEGIES.map((strategy) => strategy.key), broken)).toThrow(
      /reads "maybe"/,
    )
  })

  it('rejects a README with no table for a store', () => {
    expect(() => expectedMatrix('postgres', ['made-up-strategy'], readme)).toThrow(/no matrix table for postgres/)
  })

  it('stops at the next table rather than reading its header as a behaviour', () => {
    const matrix = expectedMatrix('postgres', POSTGRES_STRATEGIES.map((strategy) => strategy.key), readme)

    expect(matrix.behaviours).not.toContain('Behaviour')
  })
})
