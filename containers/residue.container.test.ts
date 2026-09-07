/**
 * The residue matrix, re-derived on every run and checked against the README.
 *
 * The direction is deliberate: the README holds the expected outcome and this
 * file measures the real one. A table generated from a run cannot be wrong, and
 * a table nothing re-derives stops being true the week somebody changes a
 * fixture. This one goes red on both.
 *
 * Each store gets its own container here rather than the shared one from
 * `suite.ts`, because the experiment writes to fixed addresses — `suite_0`,
 * database 3, `orders-s2` — and sharing those with the example suites would
 * make a cell depend on what else ran first. The fixture's containers are the
 * pattern; these are the laboratory.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { STORE_NAMES, type StoreName } from './images.ts'
import { KAFKA_STRATEGIES, POSTGRES_STRATEGIES, REDIS_STRATEGIES } from './isolation.ts'
import { cellFor, completeStrategies, runStoreMatrix, type StoreMatrix } from './matrix.ts'
import { expectedMatrix, expectedOutcome } from './readme.ts'
import { renderCosts, renderMatrix } from './report.ts'
import { startUsableStore, type StartedStore } from './stores.ts'

const STRATEGY_KEYS: Readonly<Record<StoreName, readonly string[]>> = {
  postgres: POSTGRES_STRATEGIES.map((strategy) => strategy.key),
  redis: REDIS_STRATEGIES.map((strategy) => strategy.key),
  kafka: KAFKA_STRATEGIES.map((strategy) => strategy.key),
}

const measured = new Map<StoreName, StoreMatrix>()
const containers: StartedStore[] = []

beforeAll(async () => {
  for (const store of STORE_NAMES) {
    const started = await startUsableStore(store, { reuse: false })

    containers.push(started)

    const matrix = await runStoreMatrix(store, started)

    measured.set(store, matrix)

    console.info(`\n${renderMatrix(matrix)}\n\n${renderCosts(matrix)}`)
  }
}, 900_000)

afterAll(async () => {
  await Promise.all(containers.map((container) => container.stop()))
  containers.length = 0
})

const matrixFor = (store: StoreName): StoreMatrix => {
  const matrix = measured.get(store)

  if (matrix === undefined) {
    throw new Error(`No matrix was measured for ${store}`)
  }

  return matrix
}

describe.each(STORE_NAMES)('%s under reuse', (store) => {
  it('passes every behaviour on the first suite, whichever strategy is in front of it', () => {
    const broken = matrixFor(store)
      .cells.filter((cell) => cell.firstSuite !== 'passed')
      .map((cell) => `${cell.strategy}/${cell.behaviour}`)

    expect(broken).toEqual([])
  })

  it('produces the second-suite outcome README.md records, cell for cell', () => {
    const expectedTable = expectedMatrix(store, STRATEGY_KEYS[store])
    const differences = matrixFor(store)
      .cells.map((cell) => ({
        cell,
        expected: expectedOutcome(expectedTable, cell.strategy, cell.behaviour),
      }))
      .filter(({ cell, expected }) => cell.secondSuite !== expected)
      .map(
        ({ cell, expected }) =>
          `${cell.strategy}/${cell.behaviour}: README says ${expected}, measured ${cell.secondSuite}` +
          `${cell.detail === null ? '' : ` (${cell.detail})`}`,
      )

    expect(differences).toEqual([])
  })

  it('covers exactly the strategies and behaviours README.md tabulates', () => {
    const expectedTable = expectedMatrix(store, STRATEGY_KEYS[store])
    const matrix = matrixFor(store)

    expect([...new Set(matrix.cells.map((cell) => cell.strategy))]).toEqual([...expectedTable.strategies])
    expect([...new Set(matrix.cells.map((cell) => cell.behaviour))]).toEqual([...expectedTable.behaviours])
  })

  it('leaves at least one strategy with nothing to find', () => {
    expect(completeStrategies(matrixFor(store)).length).toBeGreaterThan(0)
  })
})

describe('the three failure modes', () => {
  it('breaks a Postgres suite on its own assertion when rows are left behind', () => {
    const cell = cellFor(matrixFor('postgres'), 'none', 'counts-rows')

    expect(cell.secondSuite).toBe('failed')
    expect(cell.detail).toContain('found 6')
  })

  it('breaks a Postgres suite in its setup when a unique index is left behind', () => {
    const cell = cellFor(matrixFor('postgres'), 'none', 'rejects-duplicate-email')

    expect(cell.secondSuite).toBe('failed')
    expect(cell.detail).toContain('already registered before it started')
  })

  it('hangs a Kafka suite, rather than failing it, when consumer-group offsets are left behind', () => {
    const cell = cellFor(matrixFor('kafka'), 'none', 'replays-seeded-events')

    expect(cell.secondSuite).toBe('timed-out')
    expect(cell.detail).toContain('received nothing')
  })
})

describe('what each shape of strategy is worth', () => {
  it('leaves the sequence behind when Postgres is reset with a bare TRUNCATE', () => {
    const truncate = cellFor(matrixFor('postgres'), 'truncate', 'first-receipt-id')
    const restart = cellFor(matrixFor('postgres'), 'truncate-restart', 'first-receipt-id')

    expect(truncate.secondSuite).toBe('failed')
    expect(restart.secondSuite).toBe('passed')
  })

  it('hides the keyspace, not the keys, when Redis is namespaced by prefix', () => {
    const matrix = matrixFor('redis')

    expect(cellFor(matrix, 'prefix-per-suite', 'misses-cold-cache').secondSuite).toBe('passed')
    expect(cellFor(matrix, 'prefix-per-suite', 'counts-its-own-keys').secondSuite).toBe('failed')
    expect(cellFor(matrix, 'db-per-suite', 'counts-its-own-keys').secondSuite).toBe('passed')
  })

  it('fixes only the offsets when Kafka is namespaced by consumer group', () => {
    const matrix = matrixFor('kafka')

    expect(cellFor(matrix, 'group-per-suite', 'replays-seeded-events').secondSuite).toBe('passed')
    expect(cellFor(matrix, 'group-per-suite', 'counts-its-own-outbox').secondSuite).toBe('failed')
    expect(cellFor(matrix, 'topic-and-group-per-suite', 'counts-its-own-outbox').secondSuite).toBe('passed')
  })

  it('names a namespace strategy among the complete ones for every store', () => {
    expect(completeStrategies(matrixFor('postgres'))).toContain('schema-per-suite')
    expect(completeStrategies(matrixFor('redis'))).toContain('db-per-suite')
    expect(completeStrategies(matrixFor('kafka'))).toContain('topic-and-group-per-suite')
  })
})
