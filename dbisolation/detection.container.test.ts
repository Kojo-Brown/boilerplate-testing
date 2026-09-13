/**
 * The detection matrix, against a real Postgres, checked against `README.md`.
 *
 * The whole matrix is computed once in `beforeAll` — 88 suite runs, each
 * creating and dropping its own database — and the tests read the result. Each
 * (strategy, fault) pair is a test so a failure names the cell rather than the
 * table.
 */

import { describe, expect, it } from 'vitest'

import { FAULTS } from './faults.ts'
import { BEHAVIOURS } from './behaviours.ts'
import type { Matrix } from './matrix.ts'
import { runMatrix, RUN_COUNT } from './matrix.ts'
import { detectionGrid, expectedCell, usabilityGrid } from './readme.ts'
import { renderDetection, renderUsability } from './report.ts'
import { STRATEGIES, STRATEGY_KEYS } from './strategies.ts'
import { nonceFor, usePostgresServer } from './fixture.ts'

const server = usePostgresServer('detection')

describe('database isolation: detection', () => {
  let matrix: Matrix

  beforeAll(async () => {
    matrix = await runMatrix(server(), nonceFor('det'))

    console.info(`\n[dbisolation] detection (${matrix.runs.length} suite runs)\n${renderDetection(matrix.reports)}`)
    console.info(`\n[dbisolation] usability\n${renderUsability(matrix.reports)}`)
  }, 600_000)

  it('runs a control and one faulted suite for every strategy', () => {
    expect(matrix.runs).toHaveLength(RUN_COUNT)
    expect(matrix.reports).toHaveLength(STRATEGIES.length)
  })

  it('gives every behaviour a verdict in every run', () => {
    for (const run of matrix.runs) {
      expect(run.results.map((result) => result.behaviour)).toEqual(BEHAVIOURS.map((behaviour) => behaviour.key))
    }
  })

  // One test per strategy rather than per cell, which is how
  // `containers/residue.container.test.ts` reports its matrix. A whole row
  // compared at once gives an object diff naming every disagreeing cell
  // together — which is the question a reader has anyway, and is why
  // `report.ts` prints the table — rather than eighty near-identical failures
  // to reassemble.
  it.each([...STRATEGY_KEYS])('detects, under %s, what the README says it detects', (strategy) => {
    const report = matrix.reports.find((candidate) => candidate.strategy === strategy)
    const grid = detectionGrid(STRATEGY_KEYS)

    expect(report, `no report for ${strategy}`).toBeDefined()
    expect(Object.fromEntries(FAULTS.map((fault) => [fault, report?.detection.get(fault)]))).toEqual(
      Object.fromEntries(FAULTS.map((fault) => [fault, expectedCell(grid, fault, strategy)])),
    )
  })

  it.each([...STRATEGY_KEYS])('runs, under %s, the behaviours the README says it can', (strategy) => {
    const report = matrix.reports.find((candidate) => candidate.strategy === strategy)
    const grid = usabilityGrid(STRATEGY_KEYS)
    const observed = (behaviour: string): string =>
      report?.falseAlarms.includes(behaviour) === true ? 'unusable' : 'runs'

    expect(Object.fromEntries(BEHAVIOURS.map((b) => [b.key, observed(b.key)]))).toEqual(
      Object.fromEntries(BEHAVIOURS.map((b) => [b.key, expectedCell(grid, b.key, strategy)])),
    )
  })

  // The two findings the matrix exists for, asserted as claims rather than left
  // for a reader to count out of the grid.
  it('costs the savepoint strategy five faults and three behaviours', () => {
    const report = matrix.reports.find((candidate) => candidate.strategy === 'rollback-savepoint')
    const missed = [...(report?.detection ?? [])].filter(([, verdict]) => verdict === 'missed')

    // Four of the five are the deferred-constraint and other-connection faults
    // the strategy structurally cannot see. The fifth, MIGRATION_IN_TX, is one
    // both rollback columns lose for a different reason: holding a transaction
    // open makes CREATE INDEX CONCURRENTLY unrunnable either way.
    expect(missed.map(([fault]) => fault).sort()).toEqual(
      ['DUPLICATE_REF', 'MIGRATION_IN_TX', 'NEVER_COMMITS', 'NOTIFY_MISSING', 'ORPHAN_LINE'].sort(),
    )
    expect([...(report?.falseAlarms ?? [])].sort()).toEqual(['durability', 'migration', 'notification'].sort())
  })

  it('has the naive wrapper detect more than the savepoint one, because it is not isolating', () => {
    const caught = (strategy: string): number =>
      [...(matrix.reports.find((report) => report.strategy === strategy)?.detection.values() ?? [])].filter(
        (verdict) => verdict === 'caught',
      ).length

    expect(caught('rollback')).toBeGreaterThan(caught('rollback-savepoint'))
  })
})
