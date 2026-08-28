// @vitest-environment node
//
// Reads README.md and the repository's files off disk, so it needs the node
// environment for the same reason `scope.test.ts` does.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { headroom } from './policy'
import { tally, type Mutant } from './report'
import { OVERALL_FLOOR, SCOPE, entryFor } from './scope'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const readme = readFileSync(join(repoRoot, 'mutation/README.md'), 'utf8')

/**
 * One row of the README's measurement table.
 *
 * The table is a measurement with a date on it — the numbers cannot be
 * re-derived without a three-minute run, and pretending otherwise would mean
 * either running Stryker in `pnpm test` or asserting nothing. What *can* be
 * checked is that the row is internally consistent and still agrees with the
 * policy: the score is the quotient it claims to be, the floor is the floor
 * `scope.ts` enforces, and the headroom is what `policy.ts` computes from the
 * two. A floor changed without touching the README fails here.
 */
interface Row {
  readonly module: string
  readonly score: number
  readonly floor: number
  readonly detected: number
  readonly valid: number
  readonly headroom: number
}

const ROW =
  /^\|\s*`([^`]+)`\s*\|\s*([\d.]+)%\s*\|\s*(\d+)%\s*\|\s*(\d+)\/(\d+)\s*\|\s*(\d+)\s*\|/gm

function rows(): Row[] {
  return [...readme.matchAll(ROW)].map((match) => ({
    module: match[1] ?? '',
    score: Number(match[2]),
    floor: Number(match[3]),
    detected: Number(match[4]),
    valid: Number(match[5]),
    headroom: Number(match[6]),
  }))
}

/** A score with the given tally, built the way the gate builds one. */
function scoreOf(detected: number, valid: number) {
  const mutants = (status: Mutant['status'], count: number): Mutant[] =>
    Array.from({ length: count }, () => ({
      id: '0',
      mutatorName: 'ConditionalExpression',
      status,
      location: { start: { line: 1, column: 1 } },
    }))

  return tally([...mutants('Killed', detected), ...mutants('Survived', valid - detected)])
}

describe('the measurement table', () => {
  it('has a row for every scoped module, in table order', () => {
    expect(rows().map((row) => row.module)).toEqual(SCOPE.map((entry) => entry.module))
  })

  it('quotes the floor each module is actually gated on', () => {
    for (const row of rows()) {
      expect(row.floor).toBe(entryFor(row.module)?.floor)
    }
  })

  it('quotes a score that is the quotient beside it', () => {
    // Catches the copy-paste failure this kind of table exists to have: a
    // percentage updated after a re-run and the counts left behind.
    for (const row of rows()) {
      expect(row.score).toBeCloseTo((row.detected / row.valid) * 100, 2)
    }
  })

  it('quotes the headroom the policy computes from that floor', () => {
    for (const row of rows()) {
      expect(row.headroom).toBe(headroom(scoreOf(row.detected, row.valid), row.floor))
    }
  })
})

describe('the totals line', () => {
  const total = /\*\*all scoped modules\*\*\s*\|\s*\*\*([\d.]+)%\*\*\s*\|\s*\*\*(\d+)%\*\*\s*\|\s*(\d+)\/(\d+)\s*\|\s*(\d+)\s*\|/.exec(
    readme,
  )

  it('is present', () => {
    expect(total).not.toBeNull()
  })

  it('quotes the overall floor the gate enforces', () => {
    expect(Number(total?.[2])).toBe(OVERALL_FLOOR)
  })

  it('adds up to the per-module rows rather than being written down separately', () => {
    // The run's score is the pooled quotient, not the mean of the modules —
    // a total that did not add up would be the mean sneaking back in.
    const measured = rows()

    expect(Number(total?.[3])).toBe(measured.reduce((sum, row) => sum + row.detected, 0))
    expect(Number(total?.[4])).toBe(measured.reduce((sum, row) => sum + row.valid, 0))
  })

  it('quotes a total score and headroom consistent with those counts', () => {
    const detected = Number(total?.[3])
    const valid = Number(total?.[4])

    expect(Number(total?.[1])).toBeCloseTo((detected / valid) * 100, 2)
    expect(Number(total?.[5])).toBe(headroom(scoreOf(detected, valid), OVERALL_FLOOR))
  })
})

describe('the README as documentation', () => {
  it('opens with the command a reader is meant to run', () => {
    expect(readme).toContain('pnpm mutation:check')
  })

  it('documents the `--report-only` flag the gate accepts', () => {
    // A flag documented but not implemented is worse than one not documented.
    expect(readme).toContain('--report-only')
    expect(readFileSync(join(repoRoot, 'mutation/check.ts'), 'utf8')).toContain('--report-only')
  })

  it('lists only files that exist', () => {
    const listed = [...readme.matchAll(/^\|\s*`(\w[\w.-]*\.(?:ts|md))`\s*\|/gm)].map(
      (match) => match[1] ?? '',
    )

    expect(listed.length).toBeGreaterThan(4)

    for (const file of listed) {
      expect(existsSync(join(repoRoot, 'mutation', file))).toBe(true)
    }
  })

  it('names every module the scope table gates', () => {
    for (const entry of SCOPE) {
      expect(readme).toContain(entry.module)
    }
  })
})
