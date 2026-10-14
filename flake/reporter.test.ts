/**
 * The reporter's reasoning, in front of test cases no real run produces.
 *
 * `expandAttempts` turns one finished test into one record per attempt, and
 * every branch of it is a claim about what Vitest guarantees: that
 * `retryCount` counts retries, that a passing test's last attempt is the one
 * that passed, and that errors accumulate in order. A real run can only ever
 * exercise the combinations that run happens to produce, so the diagnostics
 * here are hand-built — including impossible ones, which is the only way to
 * find out whether a branch fires for the reason it claims to.
 */

import { describe, expect, it } from 'vitest'

import { expandAttempts, fullNameOf, type ReportedTestCase } from '@/flake/reporter'

const testCase = (overrides: {
  name?: string
  fullName?: string
  parent?: { name?: string; parent?: unknown }
  moduleId?: string
  state?: string
  errors?: readonly { message?: string }[]
  retryCount?: number
  flaky?: boolean
  noDiagnostic?: boolean
}): ReportedTestCase => ({
  name: overrides.name ?? 'a test',
  module: { moduleId: overrides.moduleId ?? '/repo/suite/thing.test.ts' },
  parent: overrides.parent,
  ...(overrides.fullName === undefined ? {} : { fullName: overrides.fullName }),
  result: () => ({ state: overrides.state ?? 'passed', errors: overrides.errors }),
  diagnostic: () =>
    overrides.noDiagnostic === true
      ? undefined
      : { retryCount: overrides.retryCount ?? 0, flaky: overrides.flaky ?? false },
})

const context = { run: 'r1', root: '/repo' }

describe('expandAttempts', () => {
  it('files one record per attempt, numbered from one', () => {
    const attempts = expandAttempts(testCase({ state: 'passed', retryCount: 2, errors: [{ message: 'a' }, { message: 'b' }] }), context)

    expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3])
  })

  it('marks every attempt before the last as failed when the test ended up passing', () => {
    const attempts = expandAttempts(testCase({ state: 'passed', retryCount: 1, errors: [{ message: 'first' }] }), context)

    expect(attempts.map((attempt) => attempt.outcome)).toEqual(['failed', 'passed'])
  })

  it('marks every attempt as failed when the test ended up failing', () => {
    const attempts = expandAttempts(
      testCase({ state: 'failed', retryCount: 2, errors: [{ message: '1' }, { message: '2' }, { message: '3' }] }),
      context,
    )

    expect(attempts.map((attempt) => attempt.outcome)).toEqual(['failed', 'failed', 'failed'])
  })

  it('files a single passing attempt for a test that passed first time', () => {
    expect(expandAttempts(testCase({ state: 'passed' }), context)).toEqual([
      { run: 'r1', runner: 'vitest', module: 'suite/thing.test.ts', name: 'a test', attempt: 1, outcome: 'passed' },
    ])
  })

  it('relativises the module path against the root it is given', () => {
    const [attempt] = expandAttempts(testCase({ moduleId: '/repo/deep/nest/x.test.ts' }), context)

    expect(attempt?.module).toBe('deep/nest/x.test.ts')
  })

  it('pairs each failed attempt with its own error when the counts line up', () => {
    const attempts = expandAttempts(
      testCase({ state: 'failed', retryCount: 1, errors: [{ message: 'attempt one\n  at x' }, { message: 'attempt two' }] }),
      context,
    )

    expect(attempts.map((attempt) => attempt.error)).toEqual(['attempt one', 'attempt two'])
  })

  it('keeps only the last attempt’s error when one attempt filed several', () => {
    // Two soft assertions plus a throw, over two attempts: six errors, three
    // of which belong to the attempt that ended the test. Guessing a pairing
    // here is how a dashboard comes to attribute one attempt's failure to
    // another, so every attempt but the last is left without a message.
    const attempts = expandAttempts(
      testCase({
        state: 'failed',
        retryCount: 1,
        errors: [{ message: 'a1 soft' }, { message: 'a1 hard' }, { message: 'a2 soft' }, { message: 'a2 hard' }],
      }),
      context,
    )

    expect(attempts.map((attempt) => attempt.error)).toEqual([undefined, 'a2 hard'])
  })

  it('counts attempts from retryCount even when the error count disagrees with it', () => {
    const attempts = expandAttempts(
      testCase({ state: 'failed', retryCount: 2, errors: Array.from({ length: 9 }, () => ({ message: 'x' })) }),
      context,
    )

    expect(attempts).toHaveLength(3)
  })

  it('treats a missing diagnostic as a single attempt rather than none', () => {
    expect(expandAttempts(testCase({ state: 'failed', noDiagnostic: true }), context)).toHaveLength(1)
  })

  it('ignores the flaky flag entirely, so a disagreement with retryCount cannot change the count', () => {
    // `TestDiagnostic.flaky` is documented as "if test passed on a second
    // retry" and is exactly `retryCount > 0 && passed`. Deriving the attempts
    // from it as well would mean two sources of truth for one number.
    const honest = expandAttempts(testCase({ state: 'passed', retryCount: 1, flaky: true, errors: [{ message: 'e' }] }), context)
    const lying = expandAttempts(testCase({ state: 'passed', retryCount: 1, flaky: false, errors: [{ message: 'e' }] }), context)

    expect(lying).toEqual(honest)
  })

  it('files nothing for a skipped test', () => {
    // A skipped test has made no attempt, and a record saying otherwise would
    // put a quarantined test's skip into the denominator of its own flake rate.
    expect(expandAttempts(testCase({ state: 'skipped' }), context)).toEqual([])
  })

  it('omits the error field rather than setting it to undefined', () => {
    const [attempt] = expandAttempts(testCase({ state: 'passed' }), context)

    expect(Object.hasOwn(attempt ?? {}, 'error')).toBe(false)
  })
})

describe('fullNameOf', () => {
  it('prefers the runner’s own fullName when it has one', () => {
    expect(fullNameOf(testCase({ name: 'leaf', fullName: 'outer > inner > leaf' }))).toBe('outer > inner > leaf')
  })

  it('walks the describe ancestry when fullName is absent', () => {
    expect(
      fullNameOf(testCase({ name: 'leaf', parent: { name: 'inner', parent: { name: 'outer', parent: undefined } } })),
    ).toBe('outer > inner > leaf')
  })

  it('stops at the file, whose suite has no name', () => {
    expect(fullNameOf(testCase({ name: 'leaf', parent: { name: '', parent: undefined } }))).toBe('leaf')
  })

  it('falls back to the ancestry when fullName is present but empty', () => {
    expect(fullNameOf(testCase({ name: 'leaf', fullName: '', parent: { name: 'outer' } }))).toBe('outer > leaf')
  })
})
