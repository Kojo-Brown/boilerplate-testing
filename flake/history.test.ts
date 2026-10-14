/**
 * The analytics, in front of attempt histories no run of this repository
 * produces.
 *
 * The classifier is the piece worth testing adversarially: every branch of it
 * is a claim that two tests which look similar in a percentage deserve
 * opposite treatment, and the cases that separate them — a test that was fixed
 * halfway through the window, a test with a 100% failure rate and four
 * attempts, a test that alternates — are cases a deterministic suite will
 * never hand it.
 */

import { describe, expect, it } from 'vitest'

import type { Attempt } from '@/flake/attempts'
import { classify, DEFAULT_POLICY, rank, summarise } from '@/flake/history'

const attempt = (overrides: Partial<Attempt> & { name: string }): Attempt => ({
  run: 'r1',
  runner: 'vitest',
  module: 'm.test.ts',
  attempt: 1,
  outcome: 'passed',
  ...overrides,
})

/** `runs` runs of one test, each described as a list of attempt outcomes. */
const historyOf = (name: string, runs: readonly (readonly ('passed' | 'failed')[])[]): readonly Attempt[] =>
  runs.flatMap((outcomes, runIndex) =>
    outcomes.map((outcome, index) =>
      attempt({
        name,
        run: `r${String(runIndex + 1)}`,
        attempt: index + 1,
        outcome,
        ...(outcome === 'failed' ? { error: `boom ${String(runIndex + 1)}` } : {}),
      }),
    ),
  )

describe('summarise', () => {
  it('counts attempts and failures across every run', () => {
    const [history] = summarise(historyOf('x', [['failed', 'passed'], ['passed'], ['failed', 'failed']]))

    expect(history?.attempts).toBe(5)
    expect(history?.failures).toBe(3)
  })

  it('counts runs rather than attempts in the run fields', () => {
    const [history] = summarise(historyOf('x', [['failed', 'passed'], ['passed'], ['passed']]))

    expect(history?.runs).toBe(3)
    expect(history?.passedRuns).toBe(3)
  })

  it('counts a run that passed only after a retry as a flaky run', () => {
    const [history] = summarise(historyOf('x', [['failed', 'passed'], ['passed']]))

    expect(history?.flakyRuns).toBe(1)
  })

  it('does not count a run that ended red as a flaky run', () => {
    const [history] = summarise(historyOf('x', [['failed', 'failed']]))

    expect(history?.flakyRuns).toBe(0)
  })

  it('counts a flip for every pair of consecutive attempts that disagreed', () => {
    const [history] = summarise(historyOf('x', [['failed', 'passed', 'failed', 'passed']]))

    expect(history?.flips).toBe(3)
  })

  it('counts no flips for a test that failed every attempt', () => {
    const [history] = summarise(historyOf('x', [['failed', 'failed', 'failed']]))

    expect(history?.flips).toBe(0)
  })

  it('counts no flips for a test that was fixed once and stayed fixed', () => {
    // A failure rate of 0.5 and one flip. The rate alone would rank it with
    // the genuine flakes; the flip count is what separates "was broken, now
    // fixed" from "unreliable".
    const [history] = summarise(historyOf('x', [['failed'], ['failed'], ['passed'], ['passed']]))

    expect(history?.flips).toBe(1)
  })

  it('measures the pass streak back from the most recent attempt', () => {
    const [history] = summarise(historyOf('x', [['failed'], ['passed'], ['passed'], ['passed']]))

    expect(history?.passStreak).toBe(3)
  })

  it('resets the pass streak on a failure', () => {
    const [history] = summarise(historyOf('x', [['passed'], ['passed'], ['failed']]))

    expect(history?.passStreak).toBe(0)
  })

  it('smooths the failure rate so one failed attempt does not top the ranking', () => {
    const [once] = summarise(historyOf('x', [['failed']]))
    const [often] = summarise(historyOf('y', [Array.from({ length: 20 }, () => 'failed' as const)]))

    expect(once?.failureRate).toBe(1)
    expect(often?.failureRate).toBe(1)
    expect(once?.smoothedRate).toBeLessThan(often?.smoothedRate ?? 0)
  })

  it('keeps the most recent failure’s message', () => {
    const [history] = summarise(historyOf('x', [['failed'], ['failed'], ['passed']]))

    expect(history?.lastError).toBe('boom 2')
  })

  it('records one timeline entry per run, marking the ones that needed a retry', () => {
    const [history] = summarise(historyOf('x', [['passed'], ['failed', 'passed'], ['failed', 'failed']]))

    expect(history?.timeline).toEqual([
      { run: 'r1', ended: 'passed', retried: false },
      { run: 'r2', ended: 'passed', retried: true },
      { run: 'r3', ended: 'failed', retried: true },
    ])
  })

  it('keeps two tests with the same name in different files apart', () => {
    const histories = summarise([
      attempt({ name: 'returns 404', module: 'a.test.ts', outcome: 'failed' }),
      attempt({ name: 'returns 404', module: 'b.test.ts' }),
    ])

    expect(histories).toHaveLength(2)
  })

  it('reads no attempts as no histories', () => {
    expect(summarise([])).toEqual([])
  })
})

describe('classify', () => {
  const counts = (overrides: Partial<Parameters<typeof classify>[0]>): Parameters<typeof classify>[0] => ({
    attempts: 20,
    failures: 4,
    flips: 6,
    passStreak: 2,
    failureRate: 0.2,
    ...overrides,
  })

  it('calls a test that never failed stable', () => {
    expect(classify(counts({ failures: 0, flips: 0, failureRate: 0 }))).toBe('stable')
  })

  it('calls a test that fails sometimes and flips flaky', () => {
    expect(classify(counts({}))).toBe('flaky')
  })

  it('calls a test that fails every attempt broken rather than flaky', () => {
    expect(classify(counts({ failures: 20, flips: 0, failureRate: 1 }))).toBe('broken')
  })

  it('calls a long enough pass streak fixed even while the failure rate is high', () => {
    // `fixed` has to beat `flaky`, or nothing ever leaves quarantine: a test
    // that has passed ten times running still has every one of its old
    // failures in its rate.
    expect(classify(counts({ failures: 10, failureRate: 0.5, passStreak: DEFAULT_POLICY.fixedAfter }))).toBe('fixed')
  })

  it('needs the whole streak, not most of it', () => {
    expect(classify(counts({ passStreak: DEFAULT_POLICY.fixedAfter - 1 }))).toBe('flaky')
  })

  it('calls a failure with too little evidence broken rather than flaky', () => {
    // Guessing `flaky` here would put the test in the quarantine registry,
    // where the automation starts waiting for it to go green. `broken` sends
    // somebody to look at it.
    expect(classify(counts({ attempts: 1, failures: 1, flips: 0, failureRate: 1, passStreak: 0 }))).toBe('broken')
  })

  it('calls a flip with too little evidence flaky, since a flip cannot be a plain failure', () => {
    expect(classify(counts({ attempts: 2, failures: 1, flips: 1, failureRate: 0.5, passStreak: 1 }))).toBe('flaky')
  })

  it('calls a test with failures but no flips broken, however low the rate', () => {
    // All of its failures were consecutive, so it was broken and then fixed —
    // and if the streak were long enough to say so, the branch above would
    // have said `fixed` instead.
    expect(classify(counts({ failures: 2, flips: 0, failureRate: 0.1 }))).toBe('broken')
  })
})

describe('rank', () => {
  it('puts flakes above broken tests, whatever their rates', () => {
    const histories = summarise([
      ...historyOf('broken', Array.from({ length: 6 }, () => ['failed' as const])),
      ...historyOf('flaky', [['failed', 'passed'], ['passed'], ['failed', 'passed'], ['passed'], ['passed']]),
    ])

    expect(rank(histories).map((history) => history.name)).toEqual(['flaky', 'broken'])
  })

  it('orders tests of the same class by smoothed rate, worst first', () => {
    const histories = summarise([
      ...historyOf('rare', [['failed', 'passed'], ['passed'], ['passed'], ['passed'], ['passed'], ['passed']]),
      ...historyOf('often', [['failed', 'passed'], ['failed', 'passed'], ['failed', 'passed'], ['passed']]),
    ])

    expect(rank(histories).map((history) => history.name)).toEqual(['often', 'rare'])
  })

  it('breaks a tie by name, so the table does not reshuffle between runs', () => {
    const histories = summarise([...historyOf('b', [['failed', 'passed'], ['passed']]), ...historyOf('a', [['failed', 'passed'], ['passed']])])

    expect(rank(histories).map((history) => history.name)).toEqual(['a', 'b'])
  })

  it('leaves the input alone', () => {
    const histories = summarise([...historyOf('b', [['failed']]), ...historyOf('a', [['passed']])])
    const before = histories.map((history) => history.name)

    rank(histories)

    expect(histories.map((history) => history.name)).toEqual(before)
  })
})
