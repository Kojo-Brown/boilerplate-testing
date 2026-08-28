/**
 * The arithmetic a mutation score is, tested without running one.
 *
 * A gate whose scoring can only be exercised by a three-minute Stryker run is
 * a gate whose edge cases never get tested — the interesting inputs (a module
 * with no mutants, a report from a run that was interrupted, a status this
 * code has no arithmetic for) are all ones a real run does not produce on
 * demand. So `report.ts` is a pure function of a parsed report and every case
 * below is a report literal.
 */

import { describe, expect, it } from 'vitest'

import {
  attributeCoverage,
  MUTANT_STATUSES,
  parseReport,
  ReportFormatError,
  scoreReport,
  survivors,
  tally,
  type Mutant,
  type MutantStatus,
  type MutationReport,
} from './report'

/** A mutant with only the fields a case is about spelled out. */
function mutant(status: MutantStatus, overrides: Partial<Mutant> = {}): Mutant {
  return {
    id: overrides.id ?? '0',
    mutatorName: overrides.mutatorName ?? 'ConditionalExpression',
    status,
    location: overrides.location ?? { start: { line: 1, column: 1 } },
    ...(overrides.replacement === undefined ? {} : { replacement: overrides.replacement }),
    ...(overrides.coveredBy === undefined ? {} : { coveredBy: overrides.coveredBy }),
    ...(overrides.killedBy === undefined ? {} : { killedBy: overrides.killedBy }),
  }
}

const report = (files: Record<string, readonly Mutant[]>): MutationReport => ({
  files: Object.fromEntries(Object.entries(files).map(([file, mutants]) => [file, { mutants }])),
})

// ---------------------------------------------------------------------------
// tally
// ---------------------------------------------------------------------------

describe('tally', () => {
  it('counts a killed mutant as detected', () => {
    expect(tally([mutant('Killed')])).toMatchObject({ killed: 1, detected: 1, score: 100 })
  })

  it('counts a timeout as detected, because a hung mutant is a noticed mutant', () => {
    expect(tally([mutant('Timeout')])).toMatchObject({ timeout: 1, detected: 1, score: 100 })
  })

  it('counts an uncovered mutant against the score, not out of it', () => {
    // The whole reason the gate uses the total rather than the covered score:
    // deleting the only test for a function moves its mutants here, and that
    // has to make the number worse.
    const scored = tally([mutant('Killed'), mutant('NoCoverage')])

    expect(scored).toMatchObject({ noCoverage: 1, valid: 2 })
    expect(scored.score).toBe(50)
  })

  it('counts a survivor against the score', () => {
    expect(tally([mutant('Killed'), mutant('Survived')]).score).toBe(50)
  })

  it('leaves ignored mutants out of the denominator entirely', () => {
    // An ignored mutant is one somebody excluded on purpose. Counting it
    // either way would make a `// Stryker disable` comment move the score.
    const scored = tally([mutant('Killed'), mutant('Ignored')])

    expect(scored).toMatchObject({ ignored: 1, valid: 1 })
    expect(scored.score).toBe(100)
  })

  it('leaves compile and runtime errors out of the denominator', () => {
    const scored = tally([mutant('Killed'), mutant('CompileError'), mutant('RuntimeError')])

    expect(scored).toMatchObject({ compileErrors: 1, runtimeErrors: 1, valid: 1 })
  })

  it('returns a null score rather than 100 when there are no valid mutants', () => {
    // 100 would let an empty module satisfy any floor; `policy.ts` turns the
    // null into a violation instead.
    expect(tally([]).score).toBeNull()
    expect(tally([mutant('Ignored')]).score).toBeNull()
  })

  it('divides detected by valid rather than by every mutant', () => {
    const scored = tally([
      mutant('Killed'),
      mutant('Killed'),
      mutant('Survived'),
      mutant('Ignored'),
    ])

    expect(scored.score).toBeCloseTo(66.67, 2)
  })

  it('has an arithmetic branch for every status it declares', () => {
    // The closed-table rule, applied to statuses: a status added to
    // MUTANT_STATUSES without a home in the tally would silently vanish.
    const counted = MUTANT_STATUSES.filter((status) => status !== 'Pending').map((status) =>
      tally([mutant(status)]),
    )
    const total = counted.reduce(
      (sum, scored) =>
        sum +
        scored.killed +
        scored.timeout +
        scored.survived +
        scored.noCoverage +
        scored.ignored +
        scored.compileErrors +
        scored.runtimeErrors,
      0,
    )

    expect(total).toBe(MUTANT_STATUSES.length - 1)
  })
})

// ---------------------------------------------------------------------------
// scoreReport
// ---------------------------------------------------------------------------

describe('scoreReport', () => {
  it('scores each file separately', () => {
    const scored = scoreReport(
      report({
        'a.ts': [mutant('Killed'), mutant('Killed')],
        'b.ts': [mutant('Killed'), mutant('Survived')],
      }),
    )

    expect(scored.files.map((file) => [file.file, file.score])).toEqual([
      ['a.ts', 100],
      ['b.ts', 50],
    ])
  })

  it('pools every mutant for the total instead of averaging the files', () => {
    // The difference is the point: the mean of 100% and 50% is 75%, and the
    // run's actual score is 75% only when the two files have equal weight.
    const scored = scoreReport(
      report({
        'big.ts': [mutant('Killed'), mutant('Killed'), mutant('Killed'), mutant('Killed')],
        'small.ts': [mutant('Survived')],
      }),
    )

    expect(scored.total.score).toBe(80)
  })

  it('keeps a file with no mutants in the rows so nothing disappears silently', () => {
    const scored = scoreReport(report({ 'empty.ts': [] }))

    expect(scored.files).toHaveLength(1)
    expect(scored.files[0]?.score).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// survivors
// ---------------------------------------------------------------------------

describe('survivors', () => {
  it('lists survived and uncovered mutants and nothing else', () => {
    const listed = survivors(
      report({
        'a.ts': [
          mutant('Killed'),
          mutant('Survived', { location: { start: { line: 4, column: 1 } } }),
          mutant('Timeout'),
          mutant('NoCoverage', { location: { start: { line: 9, column: 1 } } }),
        ],
      }),
    )

    expect(listed.map((found) => [found.line, found.uncovered])).toEqual([
      [9, true],
      [4, false],
    ])
  })

  it('sorts uncovered mutants first, because they are the cheaper fix', () => {
    const listed = survivors(
      report({
        'z.ts': [mutant('Survived', { location: { start: { line: 1, column: 1 } } })],
        'a.ts': [mutant('NoCoverage', { location: { start: { line: 99, column: 1 } } })],
      }),
    )

    expect(listed.map((found) => found.file)).toEqual(['a.ts', 'z.ts'])
  })

  it('carries the replacement so the log says what the change was', () => {
    const [found] = survivors(report({ 'a.ts': [mutant('Survived', { replacement: '<=' })] }))

    expect(found?.replacement).toBe('<=')
  })

  it('reports a null replacement rather than an empty string when there is none', () => {
    const [found] = survivors(report({ 'a.ts': [mutant('Survived')] }))

    expect(found?.replacement).toBeNull()
  })

  it('finds nothing in a report where everything was detected', () => {
    expect(survivors(report({ 'a.ts': [mutant('Killed'), mutant('Timeout')] }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// attributeCoverage
// ---------------------------------------------------------------------------

describe('attributeCoverage', () => {
  const withTests = (files: Record<string, readonly Mutant[]>): MutationReport => ({
    ...report(files),
    testFiles: {
      'one.test.ts': { tests: [{ id: '1', name: 'a' }] },
      'two.test.ts': { tests: [{ id: '2', name: 'b' }] },
    },
  })

  it('counts a mutant once per suite that reaches it, not once per test', () => {
    const withTwoTestsInOneSuite: MutationReport = {
      ...report({ 'a.ts': [mutant('Killed', { coveredBy: ['1', '3'] })] }),
      testFiles: {
        'one.test.ts': {
          tests: [
            { id: '1', name: 'a' },
            { id: '3', name: 'c' },
          ],
        },
      },
    }

    expect(attributeCoverage(withTwoTestsInOneSuite, 'a.ts')).toEqual([
      { suite: 'one.test.ts', covered: 1, sole: 1 },
    ])
  })

  it('credits both suites when two reach the same mutant, and neither solely', () => {
    const scored = attributeCoverage(
      withTests({ 'a.ts': [mutant('Killed', { coveredBy: ['1', '2'] })] }),
      'a.ts',
    )

    expect(scored).toEqual([
      { suite: 'one.test.ts', covered: 1, sole: 0 },
      { suite: 'two.test.ts', covered: 1, sole: 0 },
    ])
  })

  it('marks a mutant only one suite reaches as that suite’s alone', () => {
    // This is the attribution that survives without a second run: whatever
    // else is true, deleting `two.test.ts` loses this mutant.
    const scored = attributeCoverage(
      withTests({
        'a.ts': [
          mutant('Killed', { coveredBy: ['1', '2'] }),
          mutant('Survived', { coveredBy: ['2'] }),
        ],
      }),
      'a.ts',
    )

    expect(scored).toContainEqual({ suite: 'two.test.ts', covered: 2, sole: 1 })
  })

  it('ignores `killedBy`, which names the first killer rather than the killers', () => {
    // A mutant both suites cover but only one is recorded as killing must not
    // make the other look uninvolved: `killedBy` is decided by test ordering.
    const scored = attributeCoverage(
      withTests({ 'a.ts': [mutant('Killed', { coveredBy: ['1', '2'], killedBy: ['1'] })] }),
      'a.ts',
    )

    expect(scored.map((suite) => suite.covered)).toEqual([1, 1])
  })

  it('orders suites by how much of the module they reach', () => {
    const scored = attributeCoverage(
      withTests({
        'a.ts': [
          mutant('Killed', { coveredBy: ['2'] }),
          mutant('Killed', { coveredBy: ['1', '2'] }),
        ],
      }),
      'a.ts',
    )

    expect(scored.map((suite) => suite.suite)).toEqual(['two.test.ts', 'one.test.ts'])
  })

  it('returns nothing for a report with no testFiles section', () => {
    expect(attributeCoverage(report({ 'a.ts': [mutant('Killed')] }), 'a.ts')).toEqual([])
  })

  it('returns nothing for a file the report does not contain', () => {
    expect(attributeCoverage(withTests({ 'a.ts': [mutant('Killed')] }), 'b.ts')).toEqual([])
  })

  it('skips a coveredBy id no test file claims rather than inventing a suite', () => {
    const scored = attributeCoverage(
      withTests({ 'a.ts': [mutant('Killed', { coveredBy: ['1', 'ghost'] })] }),
      'a.ts',
    )

    expect(scored).toEqual([{ suite: 'one.test.ts', covered: 1, sole: 1 }])
  })
})

// ---------------------------------------------------------------------------
// parseReport
// ---------------------------------------------------------------------------

describe('parseReport', () => {
  // A mutant exactly as Stryker's JSON reporter writes one, kept as its own
  // constant so the cases below can vary one field of it without reaching
  // through an index that `noUncheckedIndexedAccess` will not vouch for.
  const rawMutant = {
    id: '1',
    mutatorName: 'EqualityOperator',
    status: 'Killed',
    replacement: '>=',
    coveredBy: ['0'],
    killedBy: ['0'],
    location: { start: { line: 3, column: 5 }, end: { line: 3, column: 7 } },
  }

  const minimal = {
    files: { 'a.ts': { mutants: [rawMutant] } },
    testFiles: { 'a.test.ts': { tests: [{ id: '0', name: 'holds' }] } },
  }

  const withoutKey = (key: string): Record<string, unknown> =>
    Object.fromEntries(Object.entries(rawMutant).filter(([name]) => name !== key))

  it('reads the fields the gate scores over', () => {
    const parsed = parseReport(minimal)

    expect(parsed.files['a.ts']?.mutants[0]).toMatchObject({
      id: '1',
      mutatorName: 'EqualityOperator',
      status: 'Killed',
      replacement: '>=',
      coveredBy: ['0'],
      location: { start: { line: 3, column: 5 } },
    })
  })

  it('reads the testFiles index the attribution needs', () => {
    expect(parseReport(minimal).testFiles?.['a.test.ts']?.tests).toEqual([
      { id: '0', name: 'holds' },
    ])
  })

  it('accepts a report with no testFiles at all', () => {
    expect(parseReport({ files: minimal.files }).testFiles).toBeUndefined()
  })

  it('rejects anything without a files object', () => {
    expect(() => parseReport({})).toThrow(ReportFormatError)
    expect(() => parseReport(null)).toThrow(ReportFormatError)
    expect(() => parseReport('{}')).toThrow(ReportFormatError)
  })

  it('rejects a status it has no arithmetic for, naming the ones it knows', () => {
    const unknown = { files: { 'a.ts': { mutants: [{ ...rawMutant, status: 'Escaped' }] } } }

    expect(() => parseReport(unknown)).toThrow(/Escaped/)
    expect(() => parseReport(unknown)).toThrow(/NoCoverage/)
  })

  it('rejects a Pending mutant, because a partial run has no score', () => {
    const pending = { files: { 'a.ts': { mutants: [{ ...rawMutant, status: 'Pending' }] } } }

    expect(() => parseReport(pending)).toThrow(/did not finish/)
  })

  it('rejects a mutant with no location, which the survivor list needs', () => {
    expect(() => parseReport({ files: { 'a.ts': { mutants: [withoutKey('location')] } } })).toThrow(
      /location/,
    )
  })

  it('rejects a file entry with no mutants array', () => {
    expect(() => parseReport({ files: { 'a.ts': {} } })).toThrow(/mutants/)
  })

  it('rejects a testFiles entry whose tests have no id', () => {
    expect(() =>
      parseReport({ ...minimal, testFiles: { 'a.test.ts': { tests: [{ name: 'x' }] } } }),
    ).toThrow(/id/)
  })

  it('leaves optional fields absent rather than filling them with empties', () => {
    // `exactOptionalPropertyTypes` is on, and a `coveredBy: []` invented for a
    // report that omitted it would be indistinguishable from a real mutant no
    // test covers.
    const bare = {
      files: {
        'a.ts': { mutants: [{ status: 'Survived', location: { start: { line: 1, column: 1 } } }] },
      },
    }

    expect(parseReport(bare).files['a.ts']?.mutants[0]).not.toHaveProperty('coveredBy')
  })
})
