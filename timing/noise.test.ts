// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { calibrate, falseAlarms } from './noise.ts'
import { runs as corpusRuns } from './corpus.ts'
import { type Run } from './durations.ts'

const steady: readonly Run[] = [
  { 'a.test.ts': 100, 'b.test.ts': 1_000 },
  { 'a.test.ts': 102, 'b.test.ts': 1_010 },
  { 'a.test.ts': 101, 'b.test.ts': 1_005 },
]

describe('calibrate', () => {
  it('reports each file against its own median', () => {
    const measured = calibrate(steady, 0)
    const a = measured.noisiest.find((entry) => entry.file === 'a.test.ts')

    expect(a?.medianMs).toBe(101)
    expect(a?.worstMs).toBe(102)
    expect(a?.absolute).toBe(1)
  })

  it('orders the files by absolute disagreement, worst first', () => {
    expect(calibrate(steady, 0).noisiest.map((entry) => entry.file)).toEqual([
      'b.test.ts',
      'a.test.ts',
    ])
  })

  it('reports the worst relative disagreement only among files above the floor', () => {
    // Three runs, not two: with two samples the median is their mean, so a
    // file that sat at 1ms and spiked to 5ms would be recorded as a 3ms file
    // that spiked to 5 — the spike averaged into the thing it is measured
    // against. Three samples put the median on the quiet value where it
    // belongs.
    const noisyShortFile: readonly Run[] = [
      { 'tiny.test.ts': 1, 'big.test.ts': 1_000 },
      { 'tiny.test.ts': 1, 'big.test.ts': 1_005 },
      { 'tiny.test.ts': 5, 'big.test.ts': 1_010 },
    ]

    // With no floor the 1ms file dominates; above a floor it is excluded.
    expect(calibrate(noisyShortFile, 0).worstRelative).toBeGreaterThan(3)
    expect(calibrate(noisyShortFile, 100).worstRelative).toBeLessThan(0.05)
  })

  // The bug this function had on its first run. Runs of a tree that gained
  // four test files between them differ in their totals because the suite
  // grew, which is not noise — it reported this repository's total floor as
  // 6.0% when the files common to every run disagreed by less than half that.
  it('takes the totals over the files every run measured, not each run’s own list', () => {
    const grew: readonly Run[] = [
      { 'a.test.ts': 100 },
      { 'a.test.ts': 100, 'added.test.ts': 900 },
    ]

    const measured = calibrate(grew, 0)

    expect(measured.files).toBe(1)
    expect(measured.totalMedianMs).toBe(100)
    expect(measured.totalRelative).toBe(0)
  })

  it('considers only the files present in every run', () => {
    const partial: readonly Run[] = [
      { 'a.test.ts': 1, 'b.test.ts': 2 },
      { 'a.test.ts': 1 },
    ]

    expect(calibrate(partial, 0).noisiest.map((entry) => entry.file)).toEqual(['a.test.ts'])
  })

  it('refuses to calibrate from a single run, which contains no noise', () => {
    expect(() => calibrate([{ 'a.test.ts': 1 }], 0)).toThrow(/at least two runs/)
  })

  it('finds the fixture corpus quiet at the total and loud at the shortest file', () => {
    const measured = calibrate(corpusRuns(), 0)

    expect(measured.totalRelative).toBeLessThan(0.05)
    expect(measured.worstRelative).toBeGreaterThan(1)
  })
})

describe('falseAlarms', () => {
  const measured = calibrate(
    [
      { 'steady.test.ts': 1_000, 'jumpy.test.ts': 1_000 },
      { 'steady.test.ts': 1_005, 'jumpy.test.ts': 1_000 },
      { 'steady.test.ts': 1_010, 'jumpy.test.ts': 2_000 },
    ],
    0,
  )

  it('names the files a candidate threshold would wrongly accuse', () => {
    expect(falseAlarms(measured, 0.5, 250, 100).map((entry) => entry.file)).toEqual([
      'jumpy.test.ts',
    ])
  })

  it('finds none once the thresholds clear the measured floor', () => {
    expect(falseAlarms(measured, 1.5, 1_500, 100)).toEqual([])
  })

  it('ignores a file below the floor however far it moved', () => {
    expect(falseAlarms(measured, 0.5, 250, 5_000)).toEqual([])
  })
})
