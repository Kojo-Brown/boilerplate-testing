/**
 * The leakage matrix, against a real Postgres, checked against `README.md`.
 *
 * The first run of every pair is asserted green before any cell is read. A
 * strategy whose first run already fails is broken rather than leaky, and its
 * second column would be reporting the breakage.
 */

import { describe, expect, it } from 'vitest'

import type { Cell } from './leakage.ts'
import { cellFor, PROBE_KEYS, runLeakage } from './leakage.ts'
import { expectedCell, leakageGrid } from './readme.ts'
import { renderLeakage } from './report.ts'
import { STRATEGY_KEYS } from './strategies.ts'
import { nonceFor, usePostgresServer } from './fixture.ts'

const server = usePostgresServer('leakage')

describe('database isolation: leakage', () => {
  let cells: readonly Cell[]

  beforeAll(async () => {
    cells = await runLeakage(server(), nonceFor('leak'))

    console.info(`\n[dbisolation] leakage (${cells.length} pairs)\n${renderLeakage(cells)}`)
  }, 600_000)

  it('runs every strategy against every probe', () => {
    expect(cells).toHaveLength(STRATEGY_KEYS.length * PROBE_KEYS.length)
  })

  it('has a green first run everywhere', () => {
    const broken = cells.filter((cell) => cell.firstRun !== 'pass')

    expect(broken.map((cell) => `${cell.strategy}/${cell.probe}`)).toEqual([])
  })

  // A row at a time, like the detection matrix and like
  // `containers/residue.container.test.ts`: the diff names every probe that
  // disagreed, which is the whole answer rather than a fifth of it.
  it.each([...STRATEGY_KEYS])('leaks, under %s, exactly what the README says it leaks', (strategy) => {
    const grid = leakageGrid(STRATEGY_KEYS)

    expect(Object.fromEntries(PROBE_KEYS.map((probe) => [probe, cellFor(cells, strategy, probe).secondRun]))).toEqual(
      Object.fromEntries(PROBE_KEYS.map((probe) => [probe, expectedCell(grid, probe, strategy)])),
    )
  })

  // The pair the matrix exists for: identical probes but for one transaction.
  it('has the naive wrapper hold a direct write and leak a committed one', () => {
    expect(cellFor(cells, 'rollback', 'plain-insert').secondRun).toBe('pass')
    expect(cellFor(cells, 'rollback', 'rows').secondRun).toBe('fail')
    // And the savepoint rewriting is what closes it, on the same probe pair.
    expect(cellFor(cells, 'rollback-savepoint', 'rows').secondRun).toBe('pass')
  })

  it('has both families share the sequence blind spot', () => {
    expect(cellFor(cells, 'truncate', 'ids').secondRun).toBe('fail')
    expect(cellFor(cells, 'rollback-savepoint', 'ids').secondRun).toBe('fail')
    expect(cellFor(cells, 'truncate-restart', 'ids').secondRun).toBe('pass')
  })

  it('has only the namespace strategies green on every probe', () => {
    const clean = STRATEGY_KEYS.filter((strategy) =>
      PROBE_KEYS.every((probe) => cellFor(cells, strategy, probe).secondRun === 'pass'),
    )

    expect(clean).toEqual(['schema-per-test', 'template-db'])
  })
})
