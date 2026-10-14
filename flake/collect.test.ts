// @vitest-environment node

/**
 * The collector: a directory of runs in, one ordered list of attempts out.
 *
 * Two of its properties are load-bearing and neither is obvious. Files are
 * read in sorted order, because `passStreak`, `flips` and the dashboard's
 * trend are all order-sensitive and the filesystem's order is not
 * chronological. And a Playwright report takes its run identifier from its
 * file name, because the report does not contain one — so two runs of the same
 * suite would otherwise fold into a single run with twice the attempts.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { collectAttempts, collectVitestNames } from '@/flake/collect'
import { summarise } from '@/flake/history'

let directory = ''

const line = (name: string, attempt: number, outcome: 'passed' | 'failed', run: string): string =>
  JSON.stringify({ run, runner: 'vitest', module: 'm.test.ts', name, attempt, outcome })

const playwrightReport = (status: 'passed' | 'failed'): string =>
  JSON.stringify({
    suites: [
      {
        file: 'e.spec.ts',
        specs: [{ title: 'journey', file: 'e.spec.ts', tests: [{ results: [{ retry: 0, status, errors: [] }] }] }],
      },
    ],
  })

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'flake-collect-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('collectAttempts', () => {
  it('reads every attempts file in the directory', () => {
    writeFileSync(join(directory, '01.jsonl'), `${line('x', 1, 'failed', 'r1')}\n`)
    writeFileSync(join(directory, '02.jsonl'), `${line('x', 1, 'passed', 'r2')}\n`)

    expect(collectAttempts(directory)).toHaveLength(2)
  })

  it('reads them in name order, so the pass streak means what it says', () => {
    writeFileSync(join(directory, '2026-10-12.jsonl'), `${line('x', 1, 'passed', 'r2')}\n`)
    writeFileSync(join(directory, '2026-10-11.jsonl'), `${line('x', 1, 'failed', 'r1')}\n`)

    const [history] = summarise(collectAttempts(directory))

    expect(history?.passStreak).toBe(1)
  })

  it('reads a Playwright report as attempts too', () => {
    writeFileSync(join(directory, 'build-1.json'), playwrightReport('failed'))

    expect(collectAttempts(directory).map((attempt) => attempt.runner)).toEqual(['playwright'])
  })

  it('takes a Playwright report’s run identifier from its file name', () => {
    writeFileSync(join(directory, 'build-1.json'), playwrightReport('failed'))
    writeFileSync(join(directory, 'build-2.json'), playwrightReport('passed'))

    const [history] = summarise(collectAttempts(directory))

    // Two runs, not one run with two attempts: the distinction is the
    // difference between a flaky test and a test that was retried.
    expect(history?.runs).toBe(2)
    expect(history?.flakyRuns).toBe(0)
  })

  it('ignores a file that is neither', () => {
    writeFileSync(join(directory, 'notes.txt'), 'not a report')
    writeFileSync(join(directory, '01.jsonl'), `${line('x', 1, 'passed', 'r1')}\n`)

    expect(collectAttempts(directory)).toHaveLength(1)
  })

  it('reads a directory that does not exist as no attempts', () => {
    expect(collectAttempts(join(directory, 'nowhere'))).toEqual([])
  })
})

describe('collectVitestNames', () => {
  // One listing, shared: each `vitest list` is a process, and the point of the
  // `files` parameter is that a caller never needs more than the files it is
  // asking about.
  const names = collectVitestNames(process.cwd(), ['flake/dashboard.test.ts'])

  it('names a test that exists, keyed by module and full name', () => {
    // The question `flake:check` asks of every registry entry, answered by the
    // collector rather than by a grep — a grep cannot tell a `test()` call
    // from a string in a comment, and cannot see a parameterised title at all.
    expect(names.has('flake/dashboard.test.ts::sparkline > draws nothing for a test with no runs')).toBe(true)
  })

  it('does not name a test that has been renamed away', () => {
    expect(names.has('flake/dashboard.test.ts::a test that never existed')).toBe(false)
  })

  it('names only the files it was asked about', () => {
    expect([...names].every((name) => name.startsWith('flake/dashboard.test.ts::'))).toBe(true)
  })
})
