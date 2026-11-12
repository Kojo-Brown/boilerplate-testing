// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { baselineFrom, expected, missing, unbudgeted } from './baseline.ts'
import { type Run } from './durations.ts'

const runs: readonly Run[] = [
  { 'a.test.ts': 10, 'b.test.ts': 100 },
  { 'a.test.ts': 12, 'b.test.ts': 101 },
  { 'a.test.ts': 11, 'b.test.ts': 300 },
]

describe('baselineFrom', () => {
  it('takes each file to its median across the runs', () => {
    expect(baselineFrom(runs).files).toEqual({ 'a.test.ts': 11, 'b.test.ts': 101 })
  })

  it('records how many runs it was derived from', () => {
    expect(baselineFrom(runs).runs).toBe(3)
  })

  // The distinction the module's doc comment is about: the median of the sums
  // is not the sum of the medians, because different files have their bad luck
  // in different runs. Here the totals are 110, 113 and 311, whose median is
  // 113, while the per-file medians sum to 112.
  it('takes the total from the median of the totals, not the sum of the medians', () => {
    const baseline = baselineFrom(runs)
    const sumOfMedians = Object.values(baseline.files).reduce((sum, ms) => sum + ms, 0)

    expect(baseline.totalMs).toBe(113)
    expect(sumOfMedians).toBe(112)
    expect(baseline.totalMs).not.toBe(sumOfMedians)
  })

  it('accepts a single run, which is the CI case', () => {
    expect(baselineFrom([{ 'a.test.ts': 4 }])).toEqual({
      files: { 'a.test.ts': 4 },
      totalMs: 4,
      runs: 1,
    })
  })

  it('refuses to derive a baseline from no runs at all', () => {
    expect(() => baselineFrom([])).toThrow(/at least one run/)
  })

  it('refuses runs that measured different files, which would understate a median', () => {
    expect(() => baselineFrom([{ 'a.test.ts': 1 }, { 'b.test.ts': 1 }])).toThrow(
      /different set of files/,
    )
  })
})

describe('comparing a run against a baseline', () => {
  const baseline = baselineFrom(runs)

  it('answers a file it knows and undefined for one it does not', () => {
    expect(expected(baseline, 'a.test.ts')).toBe(11)
    expect(expected(baseline, 'c.test.ts')).toBeUndefined()
  })

  it('names the files the run measured that the baseline has no entry for', () => {
    expect(unbudgeted(baseline, { 'a.test.ts': 1, 'c.test.ts': 1 })).toEqual(['c.test.ts'])
  })

  it('names the files the baseline knows that the run did not measure', () => {
    expect(missing(baseline, { 'a.test.ts': 1 })).toEqual(['b.test.ts'])
  })

  it('finds nothing unbudgeted or missing when the run matches the baseline', () => {
    const run = { 'a.test.ts': 1, 'b.test.ts': 1 }

    expect(unbudgeted(baseline, run)).toEqual([])
    expect(missing(baseline, run)).toEqual([])
  })
})
