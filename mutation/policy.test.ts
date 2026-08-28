/**
 * The gate's decisions, stated as inputs and outcomes.
 *
 * Every case passes its own scope table rather than the repository's, for the
 * reason `policy.ts` gives: a gate that can only be tested against the real
 * thresholds has to be edited to be tested, and a threshold edited by a test
 * has stopped being a threshold. The real table is asserted about in
 * `scope.test.ts`, where it belongs.
 */

import { describe, expect, it } from 'vitest'

import { evaluate, headroom, requiredDetected } from './policy'
import { scoreReport, type Mutant, type MutantStatus, type MutationReport } from './report'
import { SCOPE, OVERALL_FLOOR, type ScopeEntry } from './scope'

const mutant = (status: MutantStatus): Mutant => ({
  id: '0',
  mutatorName: 'ConditionalExpression',
  status,
  location: { start: { line: 1, column: 1 } },
})

/** A report where each file has `killed` kills out of `valid` valid mutants. */
function report(files: Record<string, [killed: number, valid: number]>): MutationReport {
  return {
    files: Object.fromEntries(
      Object.entries(files).map(([file, [killed, valid]]) => [
        file,
        {
          mutants: [
            ...Array.from({ length: killed }, () => mutant('Killed')),
            ...Array.from({ length: valid - killed }, () => mutant('Survived')),
          ],
        },
      ]),
    ),
  }
}

const entry = (module: string, floor: number): ScopeEntry => ({ module, floor, why: 'a reason' })

const run = (
  files: Record<string, [number, number]>,
  scope: readonly ScopeEntry[],
  overallFloor = 0,
) => evaluate(scoreReport(report(files)), scope, overallFloor)

// ---------------------------------------------------------------------------
// headroom
// ---------------------------------------------------------------------------

describe('headroom', () => {
  const score = (killed: number, valid: number) =>
    scoreReport(report({ 'a.ts': [killed, valid] })).total

  it('counts the mutants a module may lose before its floor binds', () => {
    // 48 of 50 is 96%; a floor of 90% needs 45, so three may go.
    expect(headroom(score(48, 50), 90)).toBe(3)
  })

  it('reports zero for a module already sitting exactly on its floor', () => {
    expect(headroom(score(45, 50), 90)).toBe(0)
  })

  it('reports zero rather than a negative number for a module below its floor', () => {
    expect(headroom(score(40, 50), 90)).toBe(0)
  })

  it('survives the floating-point case where the requirement is a whole number', () => {
    // 90 * 50 / 100 is 45.000000000000004 in binary floating point. Rounding
    // that up would demand 46 kills for a threshold 45 satisfies exactly, and
    // the module would be one mutant short of a floor it already meets.
    expect(requiredDetected(score(45, 50), 90)).toBe(45)
  })

  it('is the whole of a module’s kills when the floor is zero', () => {
    expect(headroom(score(7, 10), 0)).toBe(7)
  })

  it('reports zero for a module with no valid mutants at all', () => {
    expect(headroom(score(0, 0), 90)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// evaluate
// ---------------------------------------------------------------------------

describe('evaluate', () => {
  it('passes a module above its floor', () => {
    expect(run({ 'a.ts': [9, 10] }, [entry('a.ts', 80)]).violations).toEqual([])
  })

  it('passes a module sitting exactly on its floor', () => {
    // A floor is a minimum, not a target to beat. Failing here would make
    // every stated threshold one point stricter than it reads.
    expect(run({ 'a.ts': [8, 10] }, [entry('a.ts', 80)]).violations).toEqual([])
  })

  it('fails a module one mutant below its floor, and says how many it needs', () => {
    const [violation] = run({ 'a.ts': [7, 10] }, [entry('a.ts', 80)]).violations

    expect(violation).toMatchObject({ kind: 'below-floor', file: 'a.ts' })
    expect(violation?.detail).toContain('70.00%')
    expect(violation?.detail).toContain('8 are needed')
  })

  it('fails a file that was mutated but has no floor', () => {
    // The half of the closed table that matters: a module measured and then
    // gated by nothing looks exactly like a module that passed.
    const [violation] = run({ 'a.ts': [10, 10], 'b.ts': [0, 10] }, [entry('a.ts', 80)]).violations

    expect(violation).toMatchObject({ kind: 'unscoped-file', file: 'b.ts' })
  })

  it('fails a scope entry the report has no row for', () => {
    const [violation] = run({ 'a.ts': [10, 10] }, [
      entry('a.ts', 80),
      entry('gone.ts', 80),
    ]).violations

    expect(violation).toMatchObject({ kind: 'unreported-module', file: 'gone.ts' })
  })

  it('fails a scoped module Stryker produced no mutants for', () => {
    // Scoring it 100% would let a file emptied of logic satisfy any floor.
    const [violation] = run({ 'a.ts': [0, 0] }, [entry('a.ts', 80)]).violations

    expect(violation).toMatchObject({ kind: 'no-mutants', file: 'a.ts' })
  })

  it('does not also report a no-mutant module as below its floor', () => {
    const violations = run({ 'a.ts': [0, 0] }, [entry('a.ts', 80)]).violations

    expect(violations.map((violation) => violation.kind)).toEqual(['no-mutants'])
  })

  it('fails a run whose mutants failed to compile or crashed', () => {
    const withErrors: MutationReport = {
      files: { 'a.ts': { mutants: [mutant('Killed'), mutant('RuntimeError')] } },
    }
    const [violation] = evaluate(scoreReport(withErrors), [entry('a.ts', 80)], 0).violations

    expect(violation).toMatchObject({ kind: 'invalid-mutants', file: 'a.ts' })
  })

  it('fails a run below the overall floor even when every module is above its own', () => {
    // The case the per-module floors cannot see: two modules each losing a
    // little, both still inside their own slack.
    const evaluation = run({ 'a.ts': [8, 10], 'b.ts': [8, 10] }, [
      entry('a.ts', 80),
      entry('b.ts', 80),
    ], 85)

    expect(evaluation.violations.map((violation) => violation.kind)).toEqual([
      'overall-below-floor',
    ])
  })

  it('weights the overall score by mutant count rather than by module', () => {
    // 1 of 1 and 8 of 19 is 9 of 20 — 45%, not the 74% a mean over the two
    // modules would report.
    const evaluation = run({ 'a.ts': [1, 1], 'b.ts': [8, 19] }, [
      entry('a.ts', 0),
      entry('b.ts', 0),
    ])

    expect(evaluation.overall.score).toBe(45)
  })

  it('reports the headroom alongside each module it gated', () => {
    const [gated] = run({ 'a.ts': [48, 50] }, [entry('a.ts', 90)]).gated

    expect(gated).toMatchObject({ headroom: 3 })
    expect(gated?.entry.floor).toBe(90)
  })

  it('gates every module in the table, in table order', () => {
    const evaluation = run({ 'b.ts': [1, 1], 'a.ts': [1, 1] }, [entry('a.ts', 0), entry('b.ts', 0)])

    expect(evaluation.gated.map((gated) => gated.entry.module)).toEqual(['a.ts', 'b.ts'])
  })
})

// ---------------------------------------------------------------------------
// The repository's own table
// ---------------------------------------------------------------------------

describe('the declared policy', () => {
  it('states a floor between 0 and 100 for every module', () => {
    for (const scoped of SCOPE) {
      expect(scoped.floor).toBeGreaterThan(0)
      expect(scoped.floor).toBeLessThanOrEqual(100)
    }
  })

  it('names each module once', () => {
    expect(new Set(SCOPE.map((scoped) => scoped.module)).size).toBe(SCOPE.length)
  })

  it('gives every module a reason it is worth the minutes', () => {
    // The scope table's cost is measured in CI minutes, so an entry nobody
    // could defend in a sentence is an entry that should not be there.
    for (const scoped of SCOPE) {
      expect(scoped.why.length).toBeGreaterThan(80)
    }
  })

  it('sets an overall floor inside the range of the module floors', () => {
    // Above the weakest and below the strictest, and both halves matter.
    //
    // Below the strictest, because an overall floor above every module floor
    // would be the binding constraint on every run and the per-module table
    // would be decoration. Above the weakest deliberately: an overall floor at
    // or under the minimum can only fail a run in which some module has
    // already failed on its own, which is the definition of a gate that
    // catches nothing new. It is set where it is precisely so that several
    // modules each drifting inside their own slack can still fail it.
    const floors = SCOPE.map((scoped) => scoped.floor)

    expect(OVERALL_FLOOR).toBeGreaterThan(Math.min(...floors))
    expect(OVERALL_FLOOR).toBeLessThan(Math.max(...floors))
  })
})
