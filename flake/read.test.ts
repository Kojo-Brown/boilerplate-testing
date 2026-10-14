/**
 * The six artifact readers, on fragments of the real formats.
 *
 * Every string in this file is a cutting from an artifact a real run wrote —
 * `runs.test.ts` re-derives the whole table from live runs, and these are the
 * details of each format that a live run cannot be asked to produce twice in
 * the same shape: a `classname` that contains the word `name`, a stdout line
 * belonging to a different test, a JUnit `<error>` where a `<failure>` was
 * expected.
 */

import { describe, expect, it } from 'vitest'

import {
  mergeReadings,
  readPlaywrightJson,
  readVitestAttempts,
  readVitestJson,
  readVitestJunit,
  readVitestStdout,
  viewOf,
} from '@/flake/read'

describe('readVitestJson', () => {
  const source = JSON.stringify({
    testResults: [
      {
        assertionResults: [
          { fullName: 'flaked', status: 'passed', failureMessages: ['one'] },
          { fullName: 'two errors in one go', status: 'failed', failureMessages: ['soft', 'hard'] },
        ],
      },
    ],
  })

  it('counts a passing test’s attempts as its messages plus one', () => {
    expect(viewOf(readVitestJson(source), 'flaked')?.attempts).toBe(2)
  })

  it('counts a failing test’s attempts as its messages, which is the unsound part', () => {
    // One attempt filed both of these. The count is the only one the format
    // offers and it is wrong, which is what `counting: unsound` in the
    // published table records.
    expect(viewOf(readVitestJson(source), 'two errors in one go')?.attempts).toBe(2)
  })

  it('has no word for a flake', () => {
    expect(readVitestJson(source).namesFlakes).toBe(false)
  })
})

describe('readVitestJunit', () => {
  const source = `<testsuites>
    <testsuite name="subject.test.ts">
      <testcase classname="subject.test.ts" name="flaked" time="0.005">
      </testcase>
      <testcase classname="subject.test.ts" name="broken" time="0.002">
        <failure message="attempt 1 fails" type="Error">stack</failure>
        <failure message="attempt 2 fails" type="Error">stack</failure>
      </testcase>
    </testsuite>
  </testsuites>`

  it('reads the test name rather than the classname that contains it', () => {
    // `name="([^"]*)"` matches inside `classname="…"` first, and the symptom is
    // a reporter that looks as though it omitted every test.
    expect(readVitestJunit(source).views.map((view) => view.name)).toEqual(['flaked', 'broken'])
  })

  it('reports a retried test as having passed, with no attempt count at all', () => {
    const view = viewOf(readVitestJunit(source), 'flaked')

    expect(view?.status).toBe('passed')
    expect(view?.attempts).toBeUndefined()
  })

  it('distinguishes no attempt information from one attempt', () => {
    // The distinction is the finding: a JUnit `<testcase>` for a flake is
    // byte-identical to one for a test that passed first time, so the honest
    // answer is "this format does not say" rather than "once".
    expect(viewOf(readVitestJunit(source), 'flaked')?.attempts).toBeUndefined()
    expect(viewOf(readVitestJunit(source), 'broken')?.attempts).toBe(2)
  })

  it('counts Playwright’s <error> elements like Vitest’s <failure> elements', () => {
    const playwright = '<testcase name="x" classname="s.spec.ts"><error message="boom" type="Error">s</error></testcase>'

    expect(viewOf(readVitestJunit(playwright), 'x')?.attempts).toBe(1)
  })

  it('reads a self-closing testcase', () => {
    expect(readVitestJunit('<testcase name="solo" time="0.1"/>').views).toHaveLength(1)
  })
})

describe('readVitestStdout', () => {
  const names = ['flaked', 'stable']

  it('reads the retry marker the default reporter prints', () => {
    const log = ' ❯ subject.test.ts (2 tests | 0 failed)\n   ✓ flaked 9ms (retry x1)\n   ✓ stable 0ms\n'
    const reading = readVitestStdout(log, names)

    expect(viewOf(reading, 'flaked')?.attempts).toBe(2)
    expect(reading.namesFlakes).toBe(true)
  })

  it('finds no attempt count in the verbose reporter’s line, which has no marker', () => {
    const log = ' ✓ subject.test.ts > flaked 6ms\n ✓ subject.test.ts > stable 0ms\n'
    const reading = readVitestStdout(log, names)

    expect(viewOf(reading, 'flaked')?.attempts).toBeUndefined()
    expect(reading.namesFlakes).toBe(false)
  })

  it('names no test at all when the run printed no per-test lines', () => {
    expect(readVitestStdout(' Test Files  1 passed (1)\n      Tests  2 passed (2)\n', names).views).toEqual([])
  })

  it('does not read one test’s marker as another’s', () => {
    const log = '   ✓ flaked 9ms (retry x1)\n   ✓ stable 0ms\n'

    expect(viewOf(readVitestStdout(log, names), 'stable')?.attempts).toBeUndefined()
  })

  it('reads a failing line as a failure', () => {
    const log = '   × flaked 3ms (retry x2)\n'

    expect(viewOf(readVitestStdout(log, names), 'flaked')?.status).toBe('failed')
  })

  it('sees through colour escapes', () => {
    const log = '   \u001B[32m✓\u001B[39m flaked 9ms \u001B[2m(retry x1)\u001B[22m\n'

    expect(viewOf(readVitestStdout(log, names), 'flaked')?.attempts).toBe(2)
  })
})

describe('readPlaywrightJson', () => {
  const source = JSON.stringify({
    stats: { flaky: 1 },
    suites: [
      {
        specs: [
          {
            title: 'flaked',
            tests: [
              {
                status: 'flaky',
                results: [
                  { status: 'failed', errors: [{ message: 'attempt 1 fails' }] },
                  { status: 'passed', errors: [] },
                ],
              },
            ],
          },
        ],
      },
    ],
  })

  it('counts one attempt per results entry', () => {
    expect(viewOf(readPlaywrightJson(source), 'flaked')?.attempts).toBe(2)
  })

  it('reports the runner’s own flaky status', () => {
    expect(viewOf(readPlaywrightJson(source), 'flaked')?.status).toBe('flaky')
  })

  it('has a word for a flake, and a count of them in the stats', () => {
    expect(readPlaywrightJson(source).namesFlakes).toBe(true)
  })

  it('keeps every attempt’s error', () => {
    expect(viewOf(readPlaywrightJson(source), 'flaked')?.errors).toEqual(['attempt 1 fails'])
  })
})

describe('readVitestAttempts', () => {
  const source = [
    '{"run":"r","runner":"vitest","module":"m","name":"flaked","attempt":1,"outcome":"failed","error":"attempt 1 fails"}',
    '{"run":"r","runner":"vitest","module":"m","name":"flaked","attempt":2,"outcome":"passed"}',
    '{"run":"r","runner":"vitest","module":"m","name":"stable","attempt":1,"outcome":"passed"}',
    '{"run":"r","runner":"vitest","module":"m","name":"broken","attempt":1,"outcome":"failed"}',
  ].join('\n')

  it('calls a test that failed and then passed flaky', () => {
    expect(viewOf(readVitestAttempts(source), 'flaked')?.status).toBe('flaky')
  })

  it('calls a test that only ever failed failed', () => {
    expect(viewOf(readVitestAttempts(source), 'broken')?.status).toBe('failed')
  })

  it('counts attempts from the highest attempt number filed', () => {
    expect(viewOf(readVitestAttempts(source), 'flaked')?.attempts).toBe(2)
  })
})

describe('mergeReadings', () => {
  const first = {
    views: [{ name: 'x', status: 'failed' as const, attempts: 1, errors: ['attempt 1 fails'] }],
    namesFlakes: false,
  }
  const second = { views: [{ name: 'x', status: 'passed' as const, attempts: 1, errors: [] }], namesFlakes: false }

  it('adds attempts across the two runs of a rerun', () => {
    expect(viewOf(mergeReadings([first, second]), 'x')?.attempts).toBe(2)
  })

  it('derives a flake from one run disagreeing with the other', () => {
    // Neither artifact says "flaky" anywhere. That the verdict has to be
    // derived by holding two files side by side is the finding about reruns.
    expect(viewOf(mergeReadings([first, second]), 'x')?.status).toBe('flaky')
  })

  it('keeps both runs’ errors', () => {
    expect(viewOf(mergeReadings([first, second]), 'x')?.errors).toEqual(['attempt 1 fails'])
  })

  it('carries a test that only one of the two runs mentions', () => {
    const only = { views: [{ name: 'y', status: 'passed' as const, attempts: 1, errors: [] }], namesFlakes: false }

    expect(mergeReadings([first, only]).views.map((view) => view.name).sort()).toEqual(['x', 'y'])
  })

  it('keeps an unknown attempt count unknown rather than calling it zero', () => {
    const blind = { views: [{ name: 'z', status: 'passed' as const, attempts: undefined, errors: [] }], namesFlakes: false }

    expect(viewOf(mergeReadings([blind, blind]), 'z')?.attempts).toBeUndefined()
  })
})
