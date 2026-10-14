/**
 * The two report parsers, against reports built by hand.
 *
 * `runs.test.ts` already feeds these parsers real artifacts from eleven real
 * runs, so what is left for this file is the cases a real run will not produce
 * on demand: a nested `describe`, a report with a test and no results at all,
 * an error object with no message. Those are the shapes that turn a dashboard
 * into a crash at three in the morning.
 */

import { describe, expect, it } from 'vitest'

import { attemptsFromJsonl, attemptsFromPlaywrightJson, attemptsFromVitestJson } from '@/flake/attempts'

describe('attemptsFromVitestJson', () => {
  const report = {
    testResults: [
      {
        name: '/repo/suite/a.test.ts',
        assertionResults: [
          { fullName: 'flaked', status: 'passed', failureMessages: ['first went wrong\n  at x'] },
          { fullName: 'failed', status: 'failed', failureMessages: ['no', 'still no'] },
          { fullName: 'clean', status: 'passed', failureMessages: [] },
        ],
      },
    ],
  }

  it('reads a passing test with failure messages as a flake', () => {
    const attempts = attemptsFromVitestJson(report, 'r1', '/repo').filter((attempt) => attempt.name === 'flaked')

    expect(attempts.map((attempt) => [attempt.attempt, attempt.outcome])).toEqual([
      [1, 'failed'],
      [2, 'passed'],
    ])
  })

  it('reads one failed attempt per message for a test that ended red', () => {
    const attempts = attemptsFromVitestJson(report, 'r1', '/repo').filter((attempt) => attempt.name === 'failed')

    expect(attempts).toHaveLength(2)
    expect(attempts.every((attempt) => attempt.outcome === 'failed')).toBe(true)
  })

  it('keeps the first line of a message and drops the stack', () => {
    const [first] = attemptsFromVitestJson(report, 'r1', '/repo')

    expect(first?.error).toBe('first went wrong')
  })

  it('relativises the module path against the root', () => {
    expect(attemptsFromVitestJson(report, 'r1', '/repo')[0]?.module).toBe('suite/a.test.ts')
  })

  it('leaves an unrecognised path alone rather than mangling it', () => {
    expect(attemptsFromVitestJson(report, 'r1', '/elsewhere')[0]?.module).toBe('/repo/suite/a.test.ts')
  })

  it('skips a test whose status is neither passed nor failed', () => {
    const skipped = { testResults: [{ name: '/repo/a.test.ts', assertionResults: [{ fullName: 'x', status: 'pending' }] }] }

    expect(attemptsFromVitestJson(skipped, 'r1', '/repo')).toEqual([])
  })

  it('reads an empty report as no attempts', () => {
    expect(attemptsFromVitestJson({}, 'r1', '/repo')).toEqual([])
  })
})

describe('attemptsFromPlaywrightJson', () => {
  const report = {
    suites: [
      {
        title: 'suite/b.spec.ts',
        file: 'suite/b.spec.ts',
        specs: [
          {
            title: 'top level',
            file: 'suite/b.spec.ts',
            tests: [
              {
                results: [
                  { retry: 0, status: 'failed', errors: [{ message: 'nope\n at y' }] },
                  { retry: 1, status: 'passed', errors: [] },
                ],
              },
            ],
          },
        ],
        suites: [
          {
            title: 'a group',
            file: 'suite/b.spec.ts',
            specs: [
              {
                title: 'nested',
                file: 'suite/b.spec.ts',
                tests: [{ results: [{ retry: 0, status: 'passed', errors: [] }] }],
              },
            ],
          },
        ],
      },
    ],
  }

  it('reads one attempt per results entry, numbered from the retry index', () => {
    const attempts = attemptsFromPlaywrightJson(report, 'r2').filter((attempt) => attempt.name === 'top level')

    expect(attempts.map((attempt) => [attempt.attempt, attempt.outcome])).toEqual([
      [1, 'failed'],
      [2, 'passed'],
    ])
  })

  it('joins a describe title into the name but leaves the file out of it', () => {
    const names = attemptsFromPlaywrightJson(report, 'r2').map((attempt) => attempt.name)

    expect(names).toContain('a group > nested')
    expect(names.some((name) => name.includes('.spec.ts'))).toBe(false)
  })

  it('puts the file in the module field instead', () => {
    expect(attemptsFromPlaywrightJson(report, 'r2').every((attempt) => attempt.module === 'suite/b.spec.ts')).toBe(true)
  })

  it('carries the failing attempt’s message, first line only', () => {
    expect(attemptsFromPlaywrightJson(report, 'r2')[0]?.error).toBe('nope')
  })

  it('omits the error when an errors entry has no message', () => {
    const odd = {
      suites: [
        {
          file: 'c.spec.ts',
          specs: [{ title: 'x', file: 'c.spec.ts', tests: [{ results: [{ retry: 0, status: 'failed', errors: [{}] }] }] }],
        },
      ],
    }

    expect(Object.hasOwn(attemptsFromPlaywrightJson(odd, 'r2')[0] ?? {}, 'error')).toBe(false)
  })

  it('reads a test with an empty results array as no attempts', () => {
    const empty = { suites: [{ file: 'c.spec.ts', specs: [{ title: 'x', file: 'c.spec.ts', tests: [{ results: [] }] }] }] }

    expect(attemptsFromPlaywrightJson(empty, 'r2')).toEqual([])
  })

  it('stamps every attempt with the run it was given', () => {
    expect(attemptsFromPlaywrightJson(report, 'build-77').every((attempt) => attempt.run === 'build-77')).toBe(true)
  })
})

describe('attemptsFromJsonl', () => {
  it('reads one attempt per line and ignores blank ones', () => {
    const source = '{"run":"a","runner":"vitest","module":"m","name":"n","attempt":1,"outcome":"failed"}\n\n'

    expect(attemptsFromJsonl(source)).toEqual([
      { run: 'a', runner: 'vitest', module: 'm', name: 'n', attempt: 1, outcome: 'failed' },
    ])
  })

  it('reads an empty file as no attempts', () => {
    expect(attemptsFromJsonl('')).toEqual([])
  })
})
