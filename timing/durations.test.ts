// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  duration,
  entries,
  files,
  median,
  parseReport,
  quantile,
  spread,
  total,
  type Run,
} from './durations.ts'

const report = (
  results: readonly { name: string; startTime: number; endTime: number }[],
): string => JSON.stringify({ numTotalTests: results.length, testResults: results })

describe('parseReport', () => {
  it('turns a report into per-file durations relative to the root', () => {
    const raw = report([
      { name: '/repo/timing/fixture/large.test.ts', startTime: 1_000, endTime: 1_250 },
      { name: '/repo/timing/fixture/tiny.test.ts', startTime: 1_250, endTime: 1_251 },
    ])

    expect(parseReport(raw, '/repo/timing')).toEqual({
      'fixture/large.test.ts': 250,
      'fixture/tiny.test.ts': 1,
    })
  })

  it('tolerates a root given with a trailing slash', () => {
    const raw = report([{ name: '/repo/a.test.ts', startTime: 0, endTime: 5 }])

    expect(parseReport(raw, '/repo/')).toEqual({ 'a.test.ts': 5 })
  })

  it('leaves a path outside the root absolute rather than mangling it', () => {
    const raw = report([{ name: '/elsewhere/a.test.ts', startTime: 0, endTime: 5 }])

    expect(parseReport(raw, '/repo')).toEqual({ '/elsewhere/a.test.ts': 5 })
  })

  // The bug that produced this function's strictness. `fixture.config.ts`
  // once had a relative `include` and no `root`, so Vitest resolved it
  // against `process.cwd()`, collected nothing, and exited 0 with an empty
  // report. A gate that accepted it would have called every budget satisfied.
  it('rejects a report with no test files in it', () => {
    expect(() => parseReport(report([]), '/repo')).toThrow(/collected nothing/)
  })

  it('rejects a report that is not an object', () => {
    expect(() => parseReport('[]', '/repo')).toThrow(/no testResults array/)
  })

  it('rejects a report with no testResults array', () => {
    expect(() => parseReport('{}', '/repo')).toThrow(/no testResults array/)
  })

  it('rejects an entry with no name', () => {
    const raw = JSON.stringify({ testResults: [{ startTime: 0, endTime: 1 }] })

    expect(() => parseReport(raw, '/repo')).toThrow(/no name/)
  })

  it('rejects an entry with no timestamps', () => {
    const raw = JSON.stringify({ testResults: [{ name: 'a.test.ts' }] })

    expect(() => parseReport(raw, '/repo')).toThrow(/no timestamps/)
  })

  it('rejects an entry whose timestamps run backwards', () => {
    const raw = report([{ name: 'a.test.ts', startTime: 10, endTime: 4 }])

    expect(() => parseReport(raw, '/repo')).toThrow(/not a duration/)
  })
})

describe('run arithmetic', () => {
  const run: Run = { 'b.test.ts': 20, 'a.test.ts': 5 }

  it('sorts the files so every table and diff has one order', () => {
    expect(files(run)).toEqual(['a.test.ts', 'b.test.ts'])
  })

  it('sums the durations into a total', () => {
    expect(total(run)).toBe(25)
  })

  it('answers a file it measured and undefined for one it did not', () => {
    expect(duration(run, 'a.test.ts')).toBe(5)
    expect(duration(run, 'missing.test.ts')).toBeUndefined()
  })

  it('reads a file whose duration is zero as zero rather than as absent', () => {
    expect(duration({ 'a.test.ts': 0 }, 'a.test.ts')).toBe(0)
  })

  it('pairs each file with its duration in sorted order', () => {
    expect(entries(run)).toEqual([
      { file: 'a.test.ts', ms: 5 },
      { file: 'b.test.ts', ms: 20 },
    ])
  })
})

describe('statistics', () => {
  it('takes the middle value of an odd-length sample', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  it('averages the two middle values of an even-length sample', () => {
    expect(median([1, 2, 4, 8])).toBe(3)
  })

  // The reason the baseline is a median: one unlucky run must not move it.
  it('ignores an outlier that would move a mean', () => {
    expect(median([10, 10, 10, 10, 1_000])).toBe(10)
  })

  it('refuses a median of nothing', () => {
    expect(() => median([])).toThrow(/median of nothing/)
  })

  it('takes a quantile by nearest rank', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2)
    expect(quantile([1, 2, 3, 4], 1)).toBe(4)
    expect(quantile([1, 2, 3, 4], 0)).toBe(1)
  })

  it('refuses a quantile outside 0 to 1', () => {
    expect(() => quantile([1], 1.5)).toThrow(/not a quantile/)
  })

  it('refuses a quantile of nothing', () => {
    expect(() => quantile([], 0.5)).toThrow(/quantile of nothing/)
  })

  it('reports the spread as how far the worst run sits above the median', () => {
    expect(spread([10, 10, 20])).toBe(1)
  })

  it('reports no spread when every run agreed', () => {
    expect(spread([7, 7, 7])).toBe(0)
  })

  it('refuses a spread around a zero median, which has no ratio', () => {
    expect(() => spread([0, 0, 5])).toThrow(/zero median/)
  })
})
